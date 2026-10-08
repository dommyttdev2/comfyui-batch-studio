import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentUseCases, type AgentPort, type AgentScope } from '../application/agent-use-cases.js';
import { AgentTaskUseCases } from '../application/agent-task-use-cases.js';
import { AgentPreferencesUseCases } from '../application/agent-preferences-use-cases.js';
import type { AgentCliAdapter } from '../application/agent-cli-port.js';
import type { CatalogRepository } from '../application/project-ports.js';
import { selectAvailableAgentModel } from '../domain/agent-model-policy.js';
import { type ActorContext, authorize, BusinessError } from '../domain/contracts.js';
import type { AgentTaskRequest } from '../domain/agent-runtime-types.js';
import { fields, HttpFailure, object, type JsonObject } from './http.js';
import { JobRegistry, type JobDefinition, type PublicJob } from './jobs.js';
import { AgentStore, agentScopeKey, type AgentRecord } from './agent-store.js';
import { knownImportFailure } from './agent-artifacts.js';
import type { DiskProjects } from './project-repository.js';

export interface AgentRuntimeOptions {
  directory: string;
  assertIsolation?(): Promise<void>;
  configuredProviders?: readonly ('codex' | 'grok')[];
  terminate?(scope: AgentScope, jobId: string): Promise<void>;
  adapter(scope: AgentScope, jobId?: string): AgentCliAdapter;
  stopped?(scope: AgentScope, jobId: string): Promise<boolean>;
}
const digest = { text: (v: string) => createHash('sha256').update(v).digest('hex') };
const outcome = (job: PublicJob) => ({
  id: job.id,
  status: (
    {
      reserved: 'reserved',
      running: 'running',
      cancelling: 'running',
      succeeded: 'completed',
      failed: 'failed',
      cancelled: 'cancelled',
      uncertain: 'unknown',
    } as const
  )[job.state],
});
function jobScope(job: PublicJob): AgentScope {
  return {
    projectId: job.projectId,
    stage: job.stage as AgentScope['stage'],
    provider: job.provider as AgentScope['provider'],
  };
}
export class AgentRuntime {
  readonly store: AgentStore;
  readonly preferences: AgentPreferencesUseCases;
  readonly definition: JobDefinition;
  reconcileArtifact?: (job: PublicJob) => Promise<'succeeded' | 'failed' | 'uncertain'>;
  captureArtifact?: (
    actor: ActorContext,
    scope: AgentScope,
    job: PublicJob,
  ) => Promise<AgentRecord['artifact']>;
  importArtifact?: (actor: ActorContext, scope: AgentScope, jobId: string) => Promise<unknown>;
  private active = new Map<string, AgentCliAdapter>();
  private pending = new Map<string, Promise<unknown>>();
  private fenced = new Set<string>();
  constructor(
    dataDir: string,
    readonly projects: DiskProjects,
    readonly catalogs: CatalogRepository,
    readonly jobs: JobRegistry,
    private options?: AgentRuntimeOptions,
    private currentActor: (actor: ActorContext) => Promise<ActorContext> = async (actor) => actor,
  ) {
    this.store = new AgentStore(dataDir);
    this.preferences = new AgentPreferencesUseCases(
      projects,
      { now: Date.now },
      { modelCapabilities: (scope) => this.capabilities(scope) },
    );
    this.definition = {
      validate: (input) => this.validate(input),
      run: (context) => this.tracked(context),
      interrupt: async (job) => {
        this.fenced.add(job.id);
        await this.active.get(job.id)?.shutdown();
        await this.pending.get(job.id);
      },
      reconcile: async (job) => {
        if (!this.options?.stopped || !(await this.options.stopped(jobScope(job), job.id)))
          return { state: 'uncertain' };
        const record = await this.recordForReconcile(job.id);
        if (record === 'uncertain' && this.reconcileArtifact) {
          const completed = this.store.reconciliationRecord(job.id);
          if (completed?.state === 'completed' && completed.artifact)
            return { state: await this.reconcileArtifact(job) };
        }
        return {
          state:
            record === 'completed'
              ? 'succeeded'
              : record === 'failed'
                ? 'failed'
                : record === 'cancelled'
                  ? 'cancelled'
                  : 'uncertain',
        };
      },
    };
  }
  async abandon(actor: ActorContext, scope: AgentScope, id: string) {
    authorize(actor, scope.projectId, 'admin');
    if (!this.options?.terminate)
      throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Container termination unavailable.');
    return this.jobs.abandon(actor, id, async () => {
      await this.options!.terminate!(scope, id);
      if (!this.options?.stopped || !(await this.options.stopped(scope, id)))
        throw new BusinessError('RUNTIME_UNCERTAIN', 'Container stop unverified.');
      const r = this.store.reconciliationRecord(id);
      if (r) await this.store.abandonRecord(actor, scope, id);
    });
  }
  private async recordForReconcile(id: string) {
    return this.store.completion(id);
  }
  async initialize() {
    await this.store.initialize();
    if (this.options) {
      if (!path.isAbsolute(this.options.directory))
        throw new Error('Absolute runtime directory required.');
      await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    }
  }
  private driver(scope: AgentScope, id?: string) {
    if (!this.options)
      throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'CLI runtime not configured.');
    return this.options.adapter(scope, id);
  }
  async availability(scope: AgentScope) {
    if (
      !this.options ||
      (this.options.configuredProviders &&
        !this.options.configuredProviders.includes(scope.provider))
    )
      return {
        provider: scope.provider,
        state: 'missing',
        version: null,
        message: 'CLI runtime not configured.',
      };
    await this.options?.assertIsolation?.();
    return this.driver(scope).checkAvailability();
  }
  async models(scope: AgentScope) {
    await this.options?.assertIsolation?.();
    return this.driver(scope).getModels!();
  }
  async capabilities(scope: AgentScope) {
    const models = await this.models(scope);
    return { models: models.models, defaultModelId: models.selection.model };
  }
  private validate(input: JsonObject) {
    fields(input, [
      'kind',
      'text',
      'sessionId',
      'model',
      'projectRevision',
      'attachments',
      'taskStage',
      'userText',
      'prepared',
    ]);
    if (
      !['chat', 'task'].includes(String(input.kind)) ||
      typeof input.text !== 'string' ||
      Buffer.byteLength(input.text) > 750_000 ||
      (input.sessionId !== null && typeof input.sessionId !== 'string')
    )
      throw new HttpFailure(400, 'INVALID_AGENT_INPUT');
    if (input.prepared !== undefined && input.prepared !== true)
      throw new HttpFailure(400, 'INVALID_AGENT_INPUT');
  }
  bind(actor: ActorContext) {
    const port: AgentPort = {
      modelCapabilities: (scope) => this.capabilities(scope),
      reserve: async (scope, key, input) => {
        const turnId = digest.text(agentScopeKey(actor.userId, scope) + ':' + key);
        const result = await this.jobs.reserve(
          actor,
          scope.projectId,
          'agent',
          key,
          input as unknown as JsonObject,
          { stage: scope.stage, provider: scope.provider, turnId },
        );
        return { job: outcome(result.job), acquired: result.acquired };
      },
      available: async (scope) => (await this.availability(scope)).state === 'available',
      launch: async (scope, id, input) => {
        const original = this.jobs.reservationInput(actor, id);
        const taskStage =
          input.kind === 'task' ? String(object(JSON.parse(String(original.text))).stage) : null;
        const prepared = {
          ...input,
          model: input.model ?? null,
          projectRevision: input.projectRevision ?? null,
          attachments: input.attachments ?? [],
          taskStage,
          userText: String(original.text),
          prepared: true,
        };
        return outcome(await this.jobs.activate(actor, id, prepared));
      },
      fail: async (_scope, id) => this.jobs.rejectReservation(actor, id, 'failed'),
      markUnknown: async (_scope, id) => this.jobs.rejectReservation(actor, id, 'uncertain'),
      stop: async (scope, id) => {
        const job = this.jobs.get(actor, id);
        if (
          job.projectId !== scope.projectId ||
          job.stage !== scope.stage ||
          job.provider !== scope.provider
        )
          throw new BusinessError('FORBIDDEN', 'Agent scope differs.');
        return outcome(await this.jobs.cancel(actor, id));
      },
      history: async (scope) => this.store.history(actor, scope).messages,
    };
    const chat = new AgentUseCases(port, async (actor, scope, id) => {
      if (id) this.store.resolve(actor, scope, id);
      const preference = await this.preferences.read(actor, scope);
      return preference.model
        ? selectAvailableAgentModel(preference.model, await this.capabilities(scope))
        : undefined;
    });
    const tasks = new AgentTaskUseCases(this.projects, this.catalogs, port, digest);
    return { port, chat, tasks };
  }
  private async tracked(context: Parameters<JobDefinition['run']>[0]) {
    const work = this.run(context);
    this.pending.set(context.job.id, work);
    try {
      return await work;
    } finally {
      this.pending.delete(context.job.id);
    }
  }
  private async run(
    context: Parameters<JobDefinition['run']>[0],
  ): Promise<{ state: 'succeeded' | 'failed' | 'cancelled' | 'uncertain' }> {
    const { job, input, signal, progress } = context;
    const scope = jobScope(job);
    let actor = context.actor;
    let adapter: AgentCliAdapter | undefined;
    let prepared = false;
    let cliCompleted = false;
    let completion = Promise.resolve();
    let streamBytes = 0;
    let eventFailure: unknown;
    let last = 0;
    try {
      if (input.prepared !== true) throw new Error('Agent preparation absent.');
      await this.options?.assertIsolation?.();
      actor = await this.currentActor(actor);
      authorize(actor, job.projectId, 'execute');
      const record = await this.store.begin(
        actor,
        scope,
        job.id,
        input.sessionId as string | null,
        String(input.userText),
        input.taskStage as string | null,
        input.projectRevision as number | null,
      );
      const base = await realpath(this.options!.directory);
      const work = path.join(base, job.id);
      await mkdir(work, { recursive: false, mode: 0o700 });
      await mkdir(path.join(work, 'input'));
      await mkdir(path.join(work, 'output'));
      for (const raw of input.attachments as JsonObject[]) {
        const a = object(raw);
        if (
          typeof a.name !== 'string' ||
          !/^[a-z_]+\.(json|md)$/.test(a.name) ||
          typeof a.content !== 'string' ||
          a.sha256 !== digest.text(a.content) ||
          Buffer.byteLength(a.content) > 12_000_000
        )
          throw new Error('Invalid task attachment.');
        await writeFile(path.join(work, 'input', a.name), a.content, { mode: 0o600 });
      }
      adapter = this.driver(scope, job.id);
      this.active.set(job.id, adapter);
      const stop = () => {
        void adapter!.shutdown().catch((error) => {
          eventFailure = error;
        });
      };
      signal.addEventListener('abort', stop, { once: true });
      prepared = true;
      try {
        if (signal.aborted || this.fenced.has(job.id))
          throw new Error('Agent cancelled before start.');
        const sink: Parameters<AgentCliAdapter['startTask']>[1] = (event) => {
          if (this.fenced.has(job.id)) throw new Error('Agent output fenced.');
          if (event.type === 'message.delta' || event.type === 'message.completed') {
            streamBytes += Buffer.byteLength(event.text);
            if (streamBytes > 2 * 1024 * 1024) throw new Error('Agent stream limit.');
          }
          completion = completion
            .then(async () => {
              if (this.fenced.has(job.id) || eventFailure) throw new Error('Agent output fenced.');
              await this.store.update(actor, scope, job.id, event);
              if (Date.now() - last > 100) {
                last = Date.now();
                await progress(0);
              }
            })
            .catch((error) => {
              eventFailure = error;
            });
        };
        const stage = (input.taskStage ??
          (scope.stage === 'story'
            ? 'story-initial'
            : scope.stage === 'promptPlan'
              ? 'prompt-plan'
              : scope.stage)) as AgentTaskRequest['taskStage'];
        const task: AgentTaskRequest = {
          context: {
            root: agentScopeKey(actor.userId, scope) + ':' + record.conversationId,
            stage: scope.stage === 'promptPlan' ? 'prompt-plan' : scope.stage,
          },
          taskStage: stage,
          prompt: String(input.text),
          extra:
            'Reference files are in /workspace/input. Return artifact files only in /workspace/output. Never read credentials.',
          workspace: {
            workspaceId: job.id,
            directory: work,
            inputDirectory: path.join(work, 'input'),
          },
          ...(input.model ? { model: input.model as AgentTaskRequest['model'] } : {}),
        };
        const turn = record.cliSessionId
          ? await adapter.resumeTask(record.cliSessionId, task, sink)
          : await adapter.startTask(task, sink);
        if (signal.aborted || this.fenced.has(job.id)) await adapter.stop(turn.turnId);
        await adapter.waitForCompletion(turn.turnId);
        cliCompleted = true;
        await completion;
        if (eventFailure) throw eventFailure;
        if (this.fenced.has(job.id)) return { state: 'uncertain' };
        const artifact =
          !signal.aborted && this.captureArtifact
            ? await this.captureArtifact(actor, scope, job)
            : null;
        await this.store.finish(
          actor,
          scope,
          job.id,
          signal.aborted ? 'cancelled' : 'completed',
          artifact,
        );
        if (artifact && this.importArtifact) {
          try {
            await this.importArtifact(actor, scope, job.id);
          } catch (error) {
            if (!knownImportFailure(error)) return { state: 'uncertain' };
            await this.store.importResult(
              actor,
              scope,
              job.id,
              error instanceof BusinessError || error instanceof HttpFailure
                ? error.code
                : 'INTERNAL_ERROR',
            );
            return { state: 'failed' };
          }
        }
        return { state: signal.aborted ? 'cancelled' : 'succeeded' };
      } finally {
        signal.removeEventListener('abort', stop);
      }
    } catch {
      await completion;
      if (this.fenced.has(job.id)) return { state: 'uncertain' };
      if (signal.aborted && adapter) {
        try {
          await adapter.shutdown();
          await this.store.finish(actor, scope, job.id, 'cancelled');
          return { state: 'cancelled' };
        } catch {
          return { state: 'uncertain' };
        }
      }
      try {
        await this.store.finish(
          actor,
          scope,
          job.id,
          cliCompleted ? 'failed' : prepared ? 'uncertain' : 'failed',
        );
      } catch {}
      return { state: cliCompleted ? 'failed' : prepared ? 'uncertain' : 'failed' };
    } finally {
      this.active.delete(job.id);
    }
  }
}
