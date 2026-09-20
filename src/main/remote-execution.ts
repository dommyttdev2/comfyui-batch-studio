import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionEvidence, ExecutionEvidenceKind, ExecutionRun } from '../shared/types.js';
import {
  clearCurrentGenerationTiming,
  markGenerationCompleted,
  markGenerationStarted,
} from '../shared/execution-progress.js';
import { exists, readJson } from './fs-utils.js';
import { enumerateSceneBranches, sliceSceneBranchGraph } from './local-execution.js';
import {
  getExecutionRun,
  mutateExecutionRun,
  recordExecutionEvidence,
  validatedExecutionEvidence,
} from './execution-run.js';
import { readProjectMeta } from './project-meta.js';
import type { R2Manager } from './r2-manager.js';
import { R2_SINGLE_PUT_LIMIT } from './r2-manager.js';
import { RemoteWorkerRequestError, type WorkerEvent } from './remote-worker.js';
import type { ApiGraph } from './workflow-api.js';
import type { RemoteControlPlane } from './remote-control-plane.js';
import { executionArchiveTimestampJst } from './execution-output.js';

type RemoteSequenceState = {
  version?: number;
  runId?: string;
  status?: 'running' | 'interrupting' | 'paused' | 'interrupted' | 'completed' | 'failed';
  current?: {
    branchId?: string | null;
    leafId?: string | null;
    index?: number;
    promptId?: string | null;
  };
  completed?: Record<string, number>;
  overallCompleted?: number;
  overallTotal?: number;
  promptIds?: string[];
  artifact?: { outputPrefix?: string; capturedAt?: string };
  error?: { code?: string; message?: string } | null;
};
type WorkerSequenceResponse = { state?: RemoteSequenceState; alreadyRunning?: boolean };
type PackageEvidence = {
  artifactCount: number;
  size: number;
  sha256: string;
  manifestSha256: string;
  manifestJson: string;
  outputPrefix: string;
  archiveFileName: string;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class ArtifactPipelineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ArtifactPipelineError';
  }
}
function asResponse(value: unknown): WorkerSequenceResponse {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as WorkerSequenceResponse)
    : {};
}
function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
function safeProjectPart(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+|\.+$/g, '') || 'project';
}
function sha256Text(value: string) {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}
async function manifestMatches(file: string, manifestJson: string) {
  try {
    return (await readFile(file, 'utf8')) === manifestJson;
  } catch {
    return false;
  }
}
function latestEvidence(
  run: ExecutionRun,
  kind: ExecutionEvidenceKind,
  scope?: string,
): ExecutionEvidence | null {
  const rows = validatedExecutionEvidence(run).valid.filter(
    (item) => item.kind === kind && (!scope || item.scope === scope),
  );
  return rows.at(-1) ?? null;
}
async function sha256File(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function localMatches(file: string, size: number, sha256: string) {
  if (!(await exists(file))) return false;
  const info = await stat(file);
  if (info.size !== size) return false;
  return (await sha256File(file)) === sha256;
}
async function pauseForStop(root: string, runId: string) {
  return mutateExecutionRun(root, runId, (run) => {
    run.lifecycle = 'PAUSED';
    run.controls.scheduling = 'STOPPED';
    run.current.promptId = null;
    clearCurrentGenerationTiming(run);
  });
}

function applyRemoteProgressEvent(
  run: ExecutionRun,
  event: Extract<WorkerEvent, { type: 'progress' }>,
) {
  const overall = Number(event.overallCompleted);
  if (Number.isFinite(overall))
    run.progress.overall.completed = Math.max(0, Math.min(run.progress.overall.total, overall));
  const current =
    event.current && typeof event.current === 'object' && !Array.isArray(event.current)
      ? (event.current as Record<string, unknown>)
      : null;
  const branchId = typeof current?.branchId === 'string' ? current.branchId : null;
  const leafId = typeof current?.leafId === 'string' ? current.leafId : null;
  const promptId =
    typeof current?.promptId === 'string'
      ? current.promptId
      : typeof event.promptId === 'string'
        ? event.promptId
        : null;
  run.current = { branchId, leafId, promptId };
  if (promptId && !run.promptIds.includes(promptId)) run.promptIds.push(promptId);
  if (event.stage === 'prompt_submitted') markGenerationStarted(run, promptId);
  if (event.stage === 'prompt_terminal') {
    if (event.terminal === 'success') markGenerationCompleted(run);
    else clearCurrentGenerationTiming(run);
  }
  if (
    event.stage === 'scheduling_stopped' ||
    event.stage === 'interrupt_requested' ||
    event.stage === 'sequence_completed'
  )
    clearCurrentGenerationTiming(run);
  if (branchId) {
    const branch = run.progress.branches.find((item) => item.branchId === branchId);
    if (branch) {
      const index = Number(current?.index);
      if (
        event.stage === 'prompt_terminal' &&
        event.terminal === 'success' &&
        Number.isFinite(index)
      )
        branch.completed = Math.max(branch.completed, Math.min(branch.total, index));
      branch.state = branch.completed >= branch.total ? 'completed' : 'running';
    }
  }
  if (event.stage === 'sequence_completed')
    for (const branch of run.progress.branches)
      if (branch.completed >= branch.total) branch.state = 'completed';
}

function applyRemoteState(run: ExecutionRun, state: RemoteSequenceState) {
  const completed = state.completed ?? {},
    beforeOverall = run.progress.overall.completed;
  for (const branch of run.progress.branches) {
    const next = Math.max(
      0,
      Math.min(branch.total, Number(completed[branch.branchId] ?? branch.completed)),
    );
    branch.completed = next;
    branch.state =
      next >= branch.total
        ? 'completed'
        : state.current?.branchId === branch.branchId
          ? 'running'
          : branch.state === 'failed'
            ? 'failed'
            : 'pending';
  }
  const nextOverall = Math.max(
    0,
    Math.min(
      run.progress.overall.total,
      Number(state.overallCompleted ?? run.progress.overall.completed),
    ),
  );
  if (nextOverall > beforeOverall && run.progress.generationTiming?.currentStartedAt)
    markGenerationCompleted(run);
  run.progress.overall.completed = nextOverall;
  const promptId = state.current?.promptId ?? null;
  run.current = {
    branchId: state.current?.branchId ?? null,
    leafId: state.current?.leafId ?? null,
    promptId,
  };
  if (promptId && promptId !== run.progress.generationTiming?.currentPromptId)
    markGenerationStarted(run, promptId);
  if (!promptId && state.status && state.status !== 'running' && state.status !== 'interrupting')
    clearCurrentGenerationTiming(run);
  for (const id of state.promptIds ?? [])
    if (id && !run.promptIds.includes(id)) run.promptIds.push(id);
}

export class RemoteExecutionService {
  private readonly workers = new Map<string, Promise<void>>();
  private readonly discardingRuns = new Set<string>();
  constructor(
    private readonly remote: RemoteControlPlane,
    private readonly r2: R2Manager,
    private readonly onSettled?: (root: string, runId: string) => Promise<void>,
  ) {}
  start(root: string, runId: string): Promise<void> {
    const existing = this.workers.get(runId);
    if (existing) return existing;
    const task = this.execute(root, runId)
      .catch(async (error) => {
        const current = await getExecutionRun(root, runId);
        if (current?.lifecycle === 'DISCARDED') return;
        await mutateExecutionRun(root, runId, (run) => {
          if (run.lifecycle === 'DISCARDED') return;
          const code =
            error instanceof ArtifactPipelineError ? error.code : 'REMOTE_EXECUTION_FAILED';
          const failure = {
            code,
            message: safeError(error),
            phase: run.phase,
            at: new Date().toISOString(),
            retryable: true,
          };
          run.error = failure;
          run.errorHistory.push(failure);
          run.lifecycle = 'FAILED';
          run.controls.scheduling = 'STOPPED';
          clearCurrentGenerationTiming(run);
        });
      })
      .finally(async () => {
        const discarding = this.discardingRuns.has(runId);
        try {
          if (!discarding) await this.onSettled?.(root, runId);
        } finally {
          if (!discarding) this.remote.disconnect(root, runId);
          this.workers.delete(runId);
        }
      });
    this.workers.set(runId, task);
    return task;
  }
  beginDiscard(runId: string) {
    this.discardingRuns.add(runId);
  }
  endDiscard(runId: string) {
    this.discardingRuns.delete(runId);
  }
  async waitForSettled(runId: string) {
    const task = this.workers.get(runId);
    if (task) await task.catch(() => {});
  }
  async stopScheduling(root: string, runId: string) {
    await this.remote.requestWorker(root, runId, 'stop_scene_sequence');
    return true;
  }
  async forceInterrupt(root: string, runId: string) {
    const response = await this.remote.requestWorker(root, runId, 'force_interrupt_sequence', {
      comfyEndpoint: 'http://127.0.0.1:8188',
    });
    const result = asResponse(response.response) as WorkerSequenceResponse & {
      interrupted?: boolean;
    };
    if (result.interrupted)
      await mutateExecutionRun(root, runId, (run) => {
        run.controls.interrupt = 'INTERRUPTED';
      });
    return Boolean(result.interrupted);
  }
  private async syncState(root: string, runId: string, state: RemoteSequenceState) {
    return mutateExecutionRun(root, runId, (run) => {
      applyRemoteState(run, state);
    });
  }
  private async waitExisting(root: string, runId: string) {
    for (;;) {
      const status = await this.remote.reconcile(root, runId);
      const state =
        asResponse(status.response).state ??
        ((status.response as any)?.state as RemoteSequenceState | undefined);
      if (state) await this.syncState(root, runId, state);
      if (state?.status && state.status !== 'running' && state.status !== 'interrupting')
        return state;
      await sleep(750);
    }
  }
  private async runGeneration(root: string, runId: string, run: ExecutionRun) {
    let currentRun = await getExecutionRun(root, runId);
    if (!currentRun || currentRun.lifecycle !== 'RUNNING') return false;
    if (currentRun.controls.scheduling !== 'ACTIVE') {
      await pauseForStop(root, runId);
      return false;
    }
    const graph = await readJson<ApiGraph>(path.join(root, run.snapshot.workflow.apiPath));
    const workflow = await readJson<unknown>(path.join(root, run.snapshot.workflow.uiPath));
    if (!graph || !workflow) throw new Error('Execution workflow snapshot files are missing.');
    const bindings = enumerateSceneBranches(graph, run);
    const branches = bindings.map((binding) => ({
      branchId: binding.branchId,
      leafIds: binding.leafIds,
      expandNodeId: binding.expandNodeId,
      graph: sliceSceneBranchGraph(graph, binding.expandNodeId),
    }));
    const outputPrefix = `BatchStudio/${safeProjectPart(run.projectId)}/${runId}`;
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'WORKFLOW_PREPARING';
      current.error = null;
    });
    currentRun = await getExecutionRun(root, runId);
    if (!currentRun || currentRun.lifecycle !== 'RUNNING') return false;
    if (currentRun.controls.scheduling !== 'ACTIVE') {
      await pauseForStop(root, runId);
      return false;
    }
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'EXECUTING';
    });
    currentRun = await getExecutionRun(root, runId);
    if (!currentRun || currentRun.lifecycle !== 'RUNNING') return false;
    if (currentRun.controls.scheduling !== 'ACTIVE') {
      await pauseForStop(root, runId);
      return false;
    }
    let response = asResponse(
      (
        await this.remote.requestWorker(
          root,
          runId,
          'run_scene_sequence',
          {
            runId,
            projectId: run.projectId,
            outputPrefix,
            comfyEndpoint: 'http://127.0.0.1:8188',
            workflow,
            branches,
          },
          async (event) => {
            if (event.type !== 'progress') return;
            await mutateExecutionRun(root, runId, (current) => {
              if (current.lifecycle === 'RUNNING') applyRemoteProgressEvent(current, event);
            });
          },
        )
      ).response,
    );
    let state = response.state;
    if (response.alreadyRunning) state = await this.waitExisting(root, runId);
    if (!state) {
      const reconciled = await this.remote.reconcile(root, runId);
      state = (reconciled.response as any)?.state as RemoteSequenceState | undefined;
    }
    if (!state) throw new Error('Remote Worker returned no sequence state.');
    currentRun = await getExecutionRun(root, runId);
    if (!currentRun || currentRun.lifecycle !== 'RUNNING') return false;
    await this.syncState(root, runId, state);
    if (state.status === 'paused') {
      await mutateExecutionRun(root, runId, (current) => {
        current.lifecycle = 'PAUSED';
        current.controls.scheduling = 'STOPPED';
        current.current.promptId = null;
        clearCurrentGenerationTiming(current);
      });
      return false;
    }
    if (state.status === 'interrupted') {
      await mutateExecutionRun(root, runId, (current) => {
        current.lifecycle = 'INTERRUPTED';
        current.controls.scheduling = 'STOPPED';
        current.controls.interrupt = 'INTERRUPTED';
        current.current.promptId = null;
        clearCurrentGenerationTiming(current);
      });
      return false;
    }
    if (state.status === 'failed')
      throw new Error(state.error?.message || state.error?.code || 'Remote sequence failed.');
    if (state.status !== 'completed')
      throw new Error(`Remote sequence ended in unexpected state: ${state.status ?? 'unknown'}`);
    const latest = await getExecutionRun(root, runId);
    if (!latest) return false;
    const completed = Number(state.overallCompleted ?? latest.progress.overall.completed),
      expected = latest.progress.overall.total;
    if (completed !== expected)
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_COUNT_MISMATCH',
        `Remote generation completed ${completed} artifacts but ${expected} were expected.`,
      );
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'EXECUTION_COMPLETED';
    });
    if (!latestEvidence(latest, 'EXECUTION_COMPLETED', 'remote-generation')) {
      await recordExecutionEvidence(root, runId, {
        kind: 'EXECUTION_COMPLETED',
        scope: 'remote-generation',
        data: {
          images: completed,
          expectedImages: expected,
          outputPrefix: state.artifact?.outputPrefix ?? outputPrefix,
          baselineCapturedAt: state.artifact?.capturedAt ?? null,
        },
      });
    }
    return true;
  }
  private packageFromEvidence(evidence: ExecutionEvidence | null): PackageEvidence | null {
    if (!evidence) return null;
    const artifactCount = Number(evidence.data.artifactCount),
      size = Number(evidence.data.size),
      sha256 = String(evidence.data.sha256 ?? ''),
      manifestSha256 = String(evidence.data.manifestSha256 ?? ''),
      manifestJson = String(evidence.data.manifestJson ?? ''),
      outputPrefix = String(evidence.data.outputPrefix ?? '');
    const archiveFileName = String(
      evidence.data.archiveFileName ?? `${executionArchiveTimestampJst(evidence.recordedAt)}.zip`,
    );
    if (
      !Number.isSafeInteger(artifactCount) ||
      artifactCount < 0 ||
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !/^[0-9a-f]{64}$/i.test(sha256) ||
      !/^[0-9a-f]{64}$/i.test(manifestSha256) ||
      !manifestJson ||
      sha256Text(manifestJson) !== manifestSha256.toLowerCase() ||
      !/^[0-9]{8}_[0-9]{6}\.zip$/.test(archiveFileName) ||
      !outputPrefix
    )
      return null;
    return {
      artifactCount,
      size,
      sha256: sha256.toLowerCase(),
      manifestSha256: manifestSha256.toLowerCase(),
      manifestJson,
      outputPrefix,
      archiveFileName,
    };
  }
  private async ensurePackage(root: string, runId: string) {
    let run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run was not found.');
    const existing = this.packageFromEvidence(
      latestEvidence(run, 'PACKAGE_VERIFIED', 'remote-package'),
    );
    if (existing) return existing;
    const execution = latestEvidence(run, 'EXECUTION_COMPLETED', 'remote-generation');
    if (!execution)
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_GENERATION_EVIDENCE_MISSING',
        'Remote generation evidence is missing.',
      );
    const expected = run.progress.overall.total,
      completed = Number(execution.data.images);
    if (completed !== expected)
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_COUNT_MISMATCH',
        `Expected ${expected} generated artifacts but execution evidence reports ${completed}.`,
      );
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'ARTIFACTS_COLLECTING';
    });
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'ARTIFACTS_PACKAGING';
    });
    const archiveFileName = `${executionArchiveTimestampJst(new Date())}.zip`;
    const response = await this.remote.requestWorker(root, runId, 'package_artifacts', {
      runId,
      expectedCount: expected,
      archiveFileName,
    });
    const value = response.response as any,
      artifactCount = Number(value?.artifactCount),
      size = Number(value?.package?.size),
      sha256 = String(value?.package?.sha256 ?? ''),
      manifestSha256 = String(value?.manifestSha256 ?? ''),
      manifestJson = String(value?.manifestJson ?? ''),
      outputPrefix = String(execution.data.outputPrefix ?? '');
    if (artifactCount !== expected)
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_COUNT_MISMATCH',
        `Expected ${expected} packaged artifacts but found ${artifactCount}.`,
      );
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      !/^[0-9a-f]{64}$/i.test(sha256) ||
      !/^[0-9a-f]{64}$/i.test(manifestSha256) ||
      !manifestJson ||
      sha256Text(manifestJson) !== manifestSha256.toLowerCase()
    )
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_PACKAGE_INVALID',
        'Remote Worker returned invalid package evidence.',
      );
    let manifest: any;
    try {
      manifest = JSON.parse(manifestJson);
    } catch {
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_MANIFEST_INVALID',
        'Remote Worker returned invalid artifact manifest JSON.',
      );
    }
    if (
      manifest?.artifactCount !== artifactCount ||
      manifest?.package?.fileName !== archiveFileName ||
      manifest?.package?.size !== size ||
      String(manifest?.package?.sha256 ?? '').toLowerCase() !== sha256.toLowerCase()
    )
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_MANIFEST_INVALID',
        'Remote artifact manifest does not match the verified package.',
      );
    await recordExecutionEvidence(root, runId, {
      kind: 'PACKAGE_VERIFIED',
      scope: 'remote-package',
      data: {
        artifactCount,
        expectedArtifactCount: expected,
        size,
        sha256: sha256.toLowerCase(),
        manifestSha256: manifestSha256.toLowerCase(),
        manifestJson,
        archiveFileName,
        outputPrefix,
      },
    });
    return {
      artifactCount,
      size,
      sha256: sha256.toLowerCase(),
      manifestSha256: manifestSha256.toLowerCase(),
      manifestJson,
      archiveFileName,
      outputPrefix,
    };
  }
  private async putWithFreshUrl(
    root: string,
    runId: string,
    offset: number,
    length: number,
    urlFactory: () => Promise<{ url: string; headers?: Record<string, string> }>,
  ) {
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const signed = await urlFactory();
      try {
        return await this.remote.requestWorker(root, runId, 'upload_artifact_package', {
          url: signed.url,
          headers: signed.headers ?? {},
          offset,
          length,
        });
      } catch (error) {
        last = error;
        const retryable =
          error instanceof RemoteWorkerRequestError &&
          (/^R2_UPLOAD_HTTP_(401|403|408|429|5\d\d)$/.test(error.code) ||
            error.code === 'R2_UPLOAD_NETWORK');
        if (!retryable || attempt === 2) throw error;
      }
    }
    throw last;
  }
  private async uploadPackage(
    root: string,
    runId: string,
    pkg: PackageEvidence,
    bucket: string,
    key: string,
  ) {
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'R2_UPLOAD_URL_ISSUED';
    });
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'R2_UPLOADING';
    });
    let mode: 'single' | 'multipart' = 'single';
    if (pkg.size <= R2_SINGLE_PUT_LIMIT) {
      await this.putWithFreshUrl(root, runId, 0, pkg.size, async () => {
        const signed = await this.r2.putUrlInfo(bucket, key, 900, 'application/zip'),
          headers: Record<string, string> = signed.contentType
            ? { 'content-type': signed.contentType }
            : {};
        return { url: signed.url, headers };
      });
    } else {
      mode = 'multipart';
      const session = await this.r2.beginExecutionMultipart(bucket, key, pkg.size, pkg.sha256),
        parts: Array<{ PartNumber: number; ETag: string }> = [];
      try {
        for (let partNumber = 1; partNumber <= session.partCount; partNumber++) {
          const offset = (partNumber - 1) * session.partSize,
            length = Math.min(session.partSize, pkg.size - offset);
          const sent = await this.putWithFreshUrl(root, runId, offset, length, () =>
            this.r2.executionMultipartPartUrl(bucket, key, session.uploadId, partNumber, 900),
          );
          const etag = String((sent.response as any)?.etag ?? '');
          if (!etag)
            throw new ArtifactPipelineError(
              'R2_MULTIPART_ETAG_MISSING',
              `R2 multipart part ${partNumber} returned no ETag.`,
            );
          parts.push({ PartNumber: partNumber, ETag: etag });
        }
        await this.r2.completeExecutionMultipart(bucket, key, session.uploadId, parts);
      } catch (error) {
        await this.r2.abortExecutionMultipart(bucket, key, session.uploadId).catch(() => {});
        throw error;
      }
    }
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'R2_UPLOADED';
    });
    const metadata = await this.r2.objectMetadata(bucket, key);
    if (metadata.size !== pkg.size)
      throw new ArtifactPipelineError(
        'R2_OBJECT_VERIFY_FAILED',
        `R2 object verification failed (size mismatch).`,
      );
    await recordExecutionEvidence(root, runId, {
      kind: 'R2_OBJECT_VERIFIED',
      scope: 'remote-package',
      data: { bucket, key, size: pkg.size, uploadMode: mode },
    });
  }
  private async ensureR2Object(root: string, runId: string, pkg: PackageEvidence) {
    const run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run was not found.');
    const meta = await readProjectMeta(root),
      bucket =
        (process.env.BATCH_STUDIO_R2_BUCKET ?? '').trim() ||
        (meta?.settings.r2Bucket?.trim() ?? '');
    if (!bucket)
      throw new ArtifactPipelineError(
        'R2_BUCKET_REQUIRED',
        'Remote artifact retrieval requires an R2 bucket.',
      );
    const key = `batch-studio/executions/${safeProjectPart(run.projectId)}/${runId}/artifacts.zip`;
    const evidence = latestEvidence(run, 'R2_OBJECT_VERIFIED', 'remote-package');
    // Evidence records a past verification, not the current existence of an R2 object.
    // Even if the verification was not persisted, a previously uploaded object may be reusable.
    if (await this.r2.objectExists(bucket, key)) {
      const remote = await this.r2.objectMetadata(bucket, key);
      if (
        remote.size === pkg.size &&
        (!remote.sha256 || remote.sha256.toLowerCase() === pkg.sha256)
      )
        return { bucket, key };
    }
    try {
      await this.uploadPackage(root, runId, pkg, bucket, key);
    } catch (error) {
      if (latestEvidence(run, 'CLEANUP_COMPLETED', 'remote-artifacts'))
        throw new ArtifactPipelineError(
          'REMOTE_ARTIFACT_RECOVERY_UNAVAILABLE',
          `The local ZIP is missing or damaged, the R2 package is unavailable, and the Remote package could not be restored: ${safeError(error)}. Restore the saved ZIP from a backup; no local artifacts were removed.`,
        );
      throw error;
    }
    return { bucket, key };
  }
  private async ensureLocalFile(
    root: string,
    runId: string,
    pkg: PackageEvidence,
    bucket: string,
    key: string,
  ) {
    let run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run was not found.');
    const meta = await readProjectMeta(root),
      base = meta?.settings.artifactOutputPath?.trim() || root,
      dir = path.join(base, 'remote_output', runId),
      finalPath = path.join(dir, pkg.archiveFileName),
      partPath = finalPath + '.part',
      manifestPath = path.join(dir, 'manifest.json'),
      manifestPart = manifestPath + '.part';
    const existing = latestEvidence(run, 'LOCAL_FILE_VERIFIED', 'remote-package');
    // Always validate the actual bytes; saved LOCAL_FILE_VERIFIED evidence alone
    // cannot establish that a ZIP or its manifest still exists.
    if (
      (await localMatches(finalPath, pkg.size, pkg.sha256)) &&
      (await manifestMatches(manifestPath, pkg.manifestJson))
    ) {
      if (
        !existing ||
        Number(existing.data.size) !== pkg.size ||
        String(existing.data.sha256) !== pkg.sha256 ||
        String(existing.data.path ?? '') !== finalPath ||
        String(existing.data.manifestPath ?? '') !== manifestPath
      )
        await recordExecutionEvidence(root, runId, {
          kind: 'LOCAL_FILE_VERIFIED',
          scope: 'remote-package',
          data: {
            path: finalPath,
            manifestPath,
            size: pkg.size,
            sha256: pkg.sha256,
            manifestSha256: pkg.manifestSha256,
            artifactCount: pkg.artifactCount,
            archiveFileName: pkg.archiveFileName,
          },
        });
      return finalPath;
    }
    await mkdir(dir, { recursive: true });
    if (!(await localMatches(finalPath, pkg.size, pkg.sha256))) {
      // Do not remove the existing local ZIP until a replacement is fully verified.
      await rm(partPath, { force: true }).catch(() => {});
      await mutateExecutionRun(root, runId, (current) => {
        current.phase = 'LOCAL_DOWNLOADING';
      });
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await this.r2.downloadExecutionObject(bucket, key, partPath);
          last = null;
          break;
        } catch (error) {
          last = error;
          await rm(partPath, { force: true }).catch(() => {});
          if (attempt < 2) await sleep(250 * (attempt + 1));
        }
      }
      if (last) throw last;
      await mutateExecutionRun(root, runId, (current) => {
        current.phase = 'LOCAL_VERIFYING';
      });
      const info = await stat(partPath),
        digest = await sha256File(partPath);
      if (info.size !== pkg.size || digest !== pkg.sha256) {
        await rm(partPath, { force: true }).catch(() => {});
        throw new ArtifactPipelineError(
          'REMOTE_ARTIFACT_HASH_MISMATCH',
          'Downloaded artifact package SHA-256 does not match the Remote package.',
        );
      }
      await rm(finalPath, { force: true });
      await rename(partPath, finalPath);
    } else
      await mutateExecutionRun(root, runId, (current) => {
        current.phase = 'LOCAL_VERIFYING';
      });
    await rm(manifestPart, { force: true }).catch(() => {});
    await writeFile(manifestPart, pkg.manifestJson, 'utf8');
    if (sha256Text(await readFile(manifestPart, 'utf8')) !== pkg.manifestSha256) {
      await rm(manifestPart, { force: true }).catch(() => {});
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_MANIFEST_HASH_MISMATCH',
        'Local artifact manifest SHA-256 does not match the Remote manifest.',
      );
    }
    await rename(manifestPart, manifestPath);
    await recordExecutionEvidence(root, runId, {
      kind: 'LOCAL_FILE_VERIFIED',
      scope: 'remote-package',
      data: {
        path: finalPath,
        manifestPath,
        size: pkg.size,
        sha256: pkg.sha256,
        manifestSha256: pkg.manifestSha256,
        artifactCount: pkg.artifactCount,
        archiveFileName: pkg.archiveFileName,
      },
    });
    return finalPath;
  }
  private async cleanup(root: string, runId: string, bucket: string, key: string) {
    let run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run was not found.');
    if (latestEvidence(run, 'CLEANUP_COMPLETED', 'remote-artifacts')) return;
    const expectedKey = `batch-studio/executions/${safeProjectPart(run.projectId)}/${runId}/artifacts.zip`;
    if (!bucket || key !== expectedKey)
      throw new ArtifactPipelineError(
        'REMOTE_ARTIFACT_CLEANUP_SCOPE_INVALID',
        'Refusing cleanup outside this Execution Run artifact namespace.',
      );
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'REMOTE_CLEANUP';
    });
    try {
      await this.remote.requestWorker(root, runId, 'cleanup_artifacts');
    } catch (error) {
      throw new ArtifactPipelineError('REMOTE_ARTIFACT_CLEANUP_FAILED', safeError(error));
    }
    try {
      if (await this.r2.objectExists(bucket, key)) await this.r2.deleteExecutionObject(bucket, key);
    } catch (error) {
      throw new ArtifactPipelineError('R2_ARTIFACT_CLEANUP_FAILED', safeError(error));
    }
    await recordExecutionEvidence(root, runId, {
      kind: 'CLEANUP_COMPLETED',
      scope: 'remote-artifacts',
      data: { remote: true, r2: true },
    });
  }
  async discardArtifacts(root: string, runId: string) {
    const run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run was not found.');
    let remoteCleanupAttempted = false,
      remoteCleanupSucceeded = false,
      r2CleanupAttempted = false,
      r2CleanupSucceeded = false;
    if (
      run.executionTarget === 'remote' &&
      run.lifecycle === 'RUNNING' &&
      run.phase === 'EXECUTING'
    ) {
      remoteCleanupAttempted = true;
      try {
        await this.remote.requestWorker(root, runId, 'cleanup_artifacts');
        remoteCleanupSucceeded = true;
      } catch {}
    }
    const evidence = latestEvidence(run, 'R2_OBJECT_VERIFIED', 'remote-package');
    const meta = await readProjectMeta(root);
    const bucket =
      (typeof evidence?.data.bucket === 'string' && evidence.data.bucket) ||
      (process.env.BATCH_STUDIO_R2_BUCKET ?? '').trim() ||
      (meta?.settings.r2Bucket?.trim() ?? '');
    const key =
      (typeof evidence?.data.key === 'string' && evidence.data.key) ||
      `batch-studio/executions/${safeProjectPart(run.projectId)}/${runId}/artifacts.zip`;
    if (bucket) {
      r2CleanupAttempted = true;
      if (await this.r2.objectExists(bucket, key)) {
        await this.r2.deleteExecutionObject(bucket, key);
      }
      r2CleanupSucceeded = true;
    }
    return {
      remoteCleanupAttempted,
      remoteCleanupSucceeded,
      r2CleanupAttempted,
      r2CleanupSucceeded,
    };
  }

  private async collectArtifacts(root: string, runId: string) {
    const pkg = await this.ensurePackage(root, runId);
    let run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run was not found.');
    const meta = await readProjectMeta(root),
      base = meta?.settings.artifactOutputPath?.trim() || root,
      finalPath = path.join(base, 'remote_output', runId, pkg.archiveFileName),
      uploaded = latestEvidence(run, 'R2_OBJECT_VERIFIED', 'remote-package'),
      bucket =
        (process.env.BATCH_STUDIO_R2_BUCKET ?? '').trim() ||
        (meta?.settings.r2Bucket?.trim() ?? '') ||
        String(uploaded?.data.bucket ?? ''),
      key = `batch-studio/executions/${safeProjectPart(run.projectId)}/${runId}/artifacts.zip`,
      cleaned = Boolean(latestEvidence(run, 'CLEANUP_COMPLETED', 'remote-artifacts'));

    // A verified local ZIP is the final artifact. It remains valid after the
    // transport object and Remote worker package have been deliberately deleted.
    if (await localMatches(finalPath, pkg.size, pkg.sha256)) {
      await this.ensureLocalFile(root, runId, pkg, bucket, key);
      if (!cleaned) {
        if (!bucket)
          throw new ArtifactPipelineError(
            'R2_BUCKET_REQUIRED',
            'Remote artifact cleanup requires the original R2 bucket.',
          );
        await this.cleanup(root, runId, bucket, key);
      }
    } else {
      if (!bucket && cleaned)
        throw new ArtifactPipelineError(
          'REMOTE_ARTIFACT_RECOVERY_UNAVAILABLE',
          'The local ZIP is missing or damaged and transport cleanup already completed. Restore the ZIP from a backup.',
        );
      // Revalidate R2 independently of old evidence before attempting a download.
      // When it has been cleaned, re-upload only if the Remote package survives.
      const object = await this.ensureR2Object(root, runId, pkg);
      await this.ensureLocalFile(root, runId, pkg, object.bucket, object.key);
      await this.cleanup(root, runId, object.bucket, object.key);
    }
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'COMPLETED';
      current.lifecycle = 'COMPLETED';
      current.completedAt = new Date().toISOString();
      current.current = { branchId: null, leafId: null, promptId: null };
      current.controls.scheduling = 'STOPPED';
    });
  }
  private async execute(root: string, runId: string) {
    let run = await getExecutionRun(root, runId);
    if (!run || run.executionTarget !== 'remote' || run.lifecycle !== 'RUNNING') return;
    if (!latestEvidence(run, 'EXECUTION_COMPLETED', 'remote-generation')) {
      const completed = await this.runGeneration(root, runId, run);
      if (!completed) return;
    }
    run = await getExecutionRun(root, runId);
    if (!run || run.lifecycle !== 'RUNNING') return;
    await this.collectArtifacts(root, runId);
  }
}
