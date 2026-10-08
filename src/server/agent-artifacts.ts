import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { ActorContext } from '../domain/contracts.js';
import { authorize, BusinessError } from '../domain/contracts.js';
import { expectedArtifact, type ArtifactStage } from '../domain/agent-artifact-policy.js';
import type { AgentScope } from '../application/agent-use-cases.js';
import type { AgentJobArtifactSource, ProjectUseCases } from '../application/project-use-cases.js';
import type { AgentRecord } from './agent-store.js';
import type { AgentRuntime } from './agent-runtime.js';
import { HttpFailure } from './http.js';
import type { PublicJob } from './jobs.js';
export async function readAgentArtifact(directory: string, jobId: string, name: string) {
  if (!/^[a-f0-9-]{36}$/.test(jobId) || !/^[a-z_]+\.(json|md)$/.test(name))
    throw new HttpFailure(422, 'INVALID_AGENT_OUTPUT');
  const root = await realpath(directory),
    output = path.join(root, jobId, 'output'),
    file = path.join(output, name);
  if ((await realpath(output)) !== output || (await realpath(file)) !== file)
    throw new HttpFailure(422, 'INVALID_AGENT_OUTPUT');
  const before = await lstat(file);
  if (
    !before.isFile() ||
    before.isSymbolicLink() ||
    before.nlink !== 1 ||
    before.size < 1 ||
    before.size > 10_000_000
  )
    throw new HttpFailure(422, 'INVALID_AGENT_OUTPUT');
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.ino !== before.ino ||
      info.dev !== before.dev ||
      info.nlink !== 1 ||
      info.size !== before.size
    )
      throw new HttpFailure(422, 'INVALID_AGENT_OUTPUT');
    const data = Buffer.alloc(info.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const { bytesRead } = await handle.read(data, offset, data.length - offset, offset);
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    if (offset !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs)
      throw new HttpFailure(422, 'INVALID_AGENT_OUTPUT');
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(data.subarray(0, offset));
    const sha256 = createHash('sha256').update(raw).digest('hex');
    return { raw, name, size: offset, sha256 };
  } finally {
    await handle.close();
  }
}
export class AgentArtifacts implements AgentJobArtifactSource {
  constructor(
    private runtime: AgentRuntime,
    private projects: ProjectUseCases,
    private directory: string,
    private revalidate: (actor: ActorContext) => Promise<ActorContext> = async (actor) => actor,
    private outputGuard: (record: AgentRecord, raw: string) => Promise<void> = async () => {},
  ) {}
  async capture(actor: ActorContext, scope: AgentScope, job: PublicJob) {
    const record = this.runtime.store.record(actor, scope, job.id);
    if (!record.taskStage || record.taskStage === 'story-initial') return null;
    if (!record.cliSessionId || !record.turnId) throw new HttpFailure(409, 'AGENT_TURN_UNCERTAIN');
    const name = expectedArtifact(record.taskStage as ArtifactStage);
    if (!name) throw new HttpFailure(422, 'INVALID_AGENT_OUTPUT');
    const result = await readAgentArtifact(this.directory, job.id, name);
    await this.outputGuard(record, result.raw);
    return { name: result.name, sha256: result.sha256, size: result.size };
  }
  async read(actor: ActorContext, projectId: string, jobId: string) {
    const job = this.runtime.jobs.get(actor, jobId);
    if (job.kind !== 'agent' || job.projectId !== projectId)
      throw new HttpFailure(403, 'FORBIDDEN');
    const scope = {
      projectId,
      stage: job.stage as AgentScope['stage'],
      provider: job.provider as AgentScope['provider'],
    };
    const record = this.runtime.store.record(actor, scope, jobId);
    if (
      record.state !== 'completed' ||
      !record.artifact ||
      !record.cliSessionId ||
      !record.turnId ||
      record.projectRevision === null ||
      !record.taskStage
    )
      throw new HttpFailure(409, 'AGENT_ARTIFACT_UNAVAILABLE');
    const file = await readAgentArtifact(this.directory, jobId, record.artifact.name);
    if (file.sha256 !== record.artifact.sha256 || file.size !== record.artifact.size)
      throw new HttpFailure(422, 'AGENT_ARTIFACT_CHANGED');
    await this.outputGuard(record, file.raw);
    return {
      jobId,
      userId: record.userId,
      projectId,
      provider: record.scope.provider,
      stage: record.taskStage as ArtifactStage,
      projectRevision: record.projectRevision,
      completed: true as const,
      raw: file.raw,
      sha256: file.sha256,
    };
  }
  async ingest(actor: ActorContext, scope: AgentScope, jobId: string) {
    actor = await this.revalidate(actor);
    authorize(actor, scope.projectId, 'edit');
    authorize(actor, scope.projectId, 'execute');
    const record = this.runtime.store.record(actor, scope, jobId);
    if (!record.artifact || record.projectRevision === null)
      throw new HttpFailure(409, 'AGENT_ARTIFACT_UNAVAILABLE');
    const input = {
      jobId,
      expectedRevision: record.projectRevision,
      sha256: record.artifact.sha256,
    };
    try {
      const result = await this.runtime.projects.execute(
        actor,
        scope.projectId,
        'agent-import-' + jobId,
        input,
        () =>
          this.projects.importAgentJobArtifact(
            actor,
            { projectId: scope.projectId, jobId, expectedRevision: record.projectRevision! },
            this,
          ),
      );
      await this.runtime.store.importResult(actor, scope, jobId, null);
      return result;
    } catch (error) {
      await this.runtime.store.importResult(
        actor,
        scope,
        jobId,
        error instanceof BusinessError || error instanceof HttpFailure
          ? error.code
          : 'INTERNAL_ERROR',
      );
      throw error;
    }
  }
}
