import path from 'node:path';
import type { ExecutionEvidence, ExecutionModelProgress, ModelsArtifact } from '../shared/types.js';
import { readJson } from './fs-utils.js';
import {
  getExecutionRun,
  mutateExecutionRun,
  recordExecutionEvidence,
  validatedExecutionEvidence,
} from './execution-run.js';
import { joinR2ModelKey, requiredRemoteModels } from './model-placement-paths.js';
import { readProjectMeta } from './project-meta.js';
import type { R2Manager } from './r2-manager.js';
import type { RemoteControlPlane } from './remote-control-plane.js';
import { RemoteWorkerRequestError } from './remote-worker.js';

const MIN_MODEL_URL_EXPIRY_SECONDS = 6 * 60 * 60;
const MAX_MODEL_URL_EXPIRY_SECONDS = 7 * 24 * 60 * 60;
const MODEL_URL_RETRIES = 3;
const MODEL_STAGE_CONCURRENCY = 4;

type R2Meta = { key: string; size: number; sha256: string | null; etag: string };
type WorkerModelResult = {
  exists?: boolean;
  valid?: boolean;
  size?: number;
  sha256?: string | null;
  reason?: string;
  reused?: boolean;
};

function cleanPrefix(value: string) {
  return value.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}
function modelUrlExpiry(size: number) {
  const estimatedTransferSeconds = Math.ceil(Math.max(0, size) / (1024 * 1024));
  return Math.min(
    MAX_MODEL_URL_EXPIRY_SECONDS,
    Math.max(MIN_MODEL_URL_EXPIRY_SECONDS, estimatedTransferSeconds + 2 * 60 * 60),
  );
}
function safeErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/([?&](?:X-Amz-[^=]+|Signature|sig|token)=)[^&\s]+/gi, '$1[redacted]');
}
function workerResult(value: unknown): WorkerModelResult {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as WorkerModelResult)
    : {};
}
function retryableDownloadError(error: unknown) {
  if (!(error instanceof RemoteWorkerRequestError)) return false;
  return (
    error.code === 'MODEL_DOWNLOAD_NETWORK' ||
    error.code === 'MODEL_DOWNLOAD_TIMEOUT' ||
    /^MODEL_DOWNLOAD_HTTP_(401|403|408|429|5\d\d)$/.test(error.code)
  );
}
function evidenceForModel(
  evidence: ExecutionEvidence[],
  ref: string,
  objectKey: string,
  destination: string,
) {
  return (
    [...evidence]
      .reverse()
      .find(
        (item) =>
          item.kind === 'MODEL_VERIFIED' &&
          item.scope === ref &&
          String(item.data.objectKey ?? '') === objectKey &&
          String(item.data.destination ?? '') === destination,
      ) ?? null
  );
}
function samePrimitive(a: unknown, b: unknown) {
  return String(a ?? '') === String(b ?? '');
}
async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let cursor = 0,
    firstError: unknown = null;
  const runner = async () => {
    for (;;) {
      if (firstError) return;
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await worker(items[index]);
      } catch (error) {
        firstError ??= error;
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runner()));
  if (firstError) throw firstError;
}

export class RemoteModelStager {
  constructor(
    private readonly r2: R2Manager,
    private readonly remote: RemoteControlPlane,
  ) {}

  private async assertRunActive(root: string, runId: string) {
    const run = await getExecutionRun(root, runId);
    if (!run || run.lifecycle !== 'RUNNING')
      throw new Error(`Execution Run ${runId} is not running.`);
  }

  private async r2Location(root: string) {
    const meta = await readProjectMeta(root);
    const bucket =
      (process.env.BATCH_STUDIO_R2_BUCKET ?? '').trim() || (meta?.settings.r2Bucket?.trim() ?? '');
    const prefix = cleanPrefix(
      (process.env.BATCH_STUDIO_R2_MODEL_PREFIX ?? '').trim() ||
        (meta?.settings.r2ModelPrefix?.trim() ?? ''),
    );
    if (!bucket) throw new Error('REMOTE_MODEL_R2_BUCKET_REQUIRED: R2 bucket is not configured.');
    return { bucket, prefix };
  }

  private async setModelProgress(
    root: string,
    runId: string,
    ref: string,
    patch: Partial<ExecutionModelProgress>,
  ) {
    await mutateExecutionRun(root, runId, (run) => {
      const model = run.progress.models.find((item) => item.ref === ref);
      if (model) Object.assign(model, patch);
    });
  }

  private async recordVerified(
    root: string,
    runId: string,
    item: {
      ref: string;
      fileName: string;
      kind: ExecutionModelProgress['kind'];
      objectKey: string;
      destination: string;
    },
    meta: R2Meta,
    result: WorkerModelResult,
    reused: boolean,
    existing: ExecutionEvidence | null,
  ) {
    const sha256 =
      typeof result.sha256 === 'string' && result.sha256 ? result.sha256.toLowerCase() : null;
    const size = Number(result.size ?? meta.size);
    if (
      existing &&
      samePrimitive(existing.data.size, size) &&
      samePrimitive(existing.data.sha256, sha256) &&
      samePrimitive(existing.data.objectEtag, meta.etag) &&
      existing.data.sourceVerified === true
    )
      return;
    await recordExecutionEvidence(root, runId, {
      kind: 'MODEL_VERIFIED',
      scope: item.ref,
      data: {
        fileName: item.fileName,
        kind: item.kind,
        objectKey: item.objectKey,
        destination: item.destination,
        size,
        sha256,
        reused,
        objectEtag: meta.etag || null,
        sourceVerified: true,
      },
    });
  }

  async stage(root: string, runId: string) {
    await this.assertRunActive(root, runId);
    const run = await getExecutionRun(root, runId);
    if (!run || run.executionTarget !== 'remote')
      throw new Error('Remote Execution Run is required for model staging.');
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'REMOTE_MODELS_CHECKING';
      current.error = null;
    });
    await this.assertRunActive(root, runId);
    await this.remote.requestWorker(root, runId, 'model_environment');

    const models = await readJson<ModelsArtifact>(path.join(root, 'models.json'));
    if (!models) throw new Error('REMOTE_MODELS_MISSING: models.json is missing.');
    const { bucket, prefix } = await this.r2Location(root);
    const required = requiredRemoteModels(models);
    await this.r2.syncObjectIndex();
    const resolved = await Promise.all(
      required.map(async (item) => {
        const objectKey = await this.r2.resolveModelObjectKey(bucket, item.relativePath, prefix);
        if (!objectKey)
          throw new Error(
            `REMOTE_MODEL_R2_OBJECT_MISSING: ${joinR2ModelKey(prefix, item.relativePath)}`,
          );
        const meta = await this.r2.objectMetadata(bucket, objectKey);
        return { ...item, objectKey, destination: `models/${item.relativePath}`, meta };
      }),
    );

    await mutateExecutionRun(root, runId, (current) => {
      const previous = new Map((current.progress.models ?? []).map((item) => [item.ref, item]));
      current.progress.models = resolved.map((item) => {
        const old = previous.get(item.ref);
        return {
          ref: item.ref,
          fileName: item.fileName,
          kind: item.kind,
          objectKey: item.objectKey,
          destination: item.destination,
          state: old?.state === 'ready' ? 'ready' : 'pending',
          transferredBytes: old?.transferredBytes ?? 0,
          totalBytes: item.meta.size,
          reused: old?.reused ?? false,
          sha256: old?.sha256 ?? null,
          error: null,
        };
      });
    });

    const refreshed = await getExecutionRun(root, runId);
    if (!refreshed) throw new Error('Execution Run disappeared during remote model staging.');
    const validated = validatedExecutionEvidence(refreshed).valid;

    await runConcurrent(resolved, MODEL_STAGE_CONCURRENCY, async (item) => {
      await this.assertRunActive(root, runId);
      const existingEvidence = evidenceForModel(
        validated,
        item.ref,
        item.objectKey,
        item.destination,
      );
      if (existingEvidence) {
        const previousSize = Number(existingEvidence.data.size ?? -1),
          previousEtag = String(existingEvidence.data.objectEtag ?? '');
        if (previousSize >= 0 && previousSize !== item.meta.size)
          throw new Error(`R2_MODEL_CHANGED_DURING_RUN: ${item.fileName} size changed.`);
        if (previousEtag && item.meta.etag && previousEtag !== item.meta.etag)
          throw new Error(`R2_MODEL_CHANGED_DURING_RUN: ${item.fileName} ETag changed.`);
      }
      const evidenceSha =
        typeof existingEvidence?.data.sha256 === 'string' && existingEvidence.data.sha256
          ? existingEvidence.data.sha256
          : null;
      if (item.meta.sha256 && evidenceSha && item.meta.sha256 !== evidenceSha)
        throw new Error(`R2_MODEL_CHANGED_DURING_RUN: ${item.fileName} SHA-256 changed.`);
      // Historic evidence without a verified source binding may only have hashed the
      // pre-existing Remote file. Do not treat that self-reported hash as R2 identity.
      const sourceEvidenceTrusted =
        existingEvidence?.data.sourceVerified === true &&
        Boolean(item.meta.etag) &&
        item.meta.etag === existingEvidence.data.objectEtag &&
        Number(existingEvidence.data.size) === item.meta.size;
      const expectedSha = item.meta.sha256 ?? (sourceEvidenceTrusted ? evidenceSha : null);
      const mustDownloadFromSource = !expectedSha;

      await this.setModelProgress(root, runId, item.ref, {
        state: 'checking',
        transferredBytes: 0,
        totalBytes: item.meta.size,
        error: null,
      });
      await this.assertRunActive(root, runId);
      const inspected = workerResult(
        (
          await this.remote.requestWorker(root, runId, 'inspect_model', {
            path: item.relativePath,
            expectedSize: item.meta.size,
            expectedSha256: expectedSha,
            computeSha256: true,
          })
        ).response,
      );
      if (
        inspected.valid &&
        expectedSha &&
        typeof inspected.sha256 === 'string' &&
        inspected.sha256.toLowerCase() === expectedSha.toLowerCase()
      ) {
        const sha256 = inspected.sha256.toLowerCase();
        await this.setModelProgress(root, runId, item.ref, {
          state: existingEvidence ? 'skipped' : 'ready',
          transferredBytes: item.meta.size,
          totalBytes: item.meta.size,
          reused: true,
          sha256,
          error: null,
        });
        await this.recordVerified(root, runId, item, item.meta, inspected, true, existingEvidence);
        return;
      }

      await this.assertRunActive(root, runId);
      await mutateExecutionRun(root, runId, (current) => {
        current.phase = 'REMOTE_MODELS_DOWNLOADING';
      });
      let staged: WorkerModelResult | null = null,
        lastError: unknown = null;
      for (let attempt = 1; attempt <= MODEL_URL_RETRIES; attempt++) {
        await this.assertRunActive(root, runId);
        const download = await this.r2.downloadInfo(
          bucket,
          item.objectKey,
          modelUrlExpiry(item.meta.size),
        );
        await this.setModelProgress(root, runId, item.ref, {
          state: 'downloading',
          transferredBytes: 0,
          totalBytes: item.meta.size,
          reused: false,
          error: null,
        });
        try {
          const response = await this.remote.requestWorker(root, runId, 'stage_model', {
            path: item.relativePath,
            url: download.url,
            expectedSize: item.meta.size,
            expectedSha256: expectedSha,
            forceDownload: mustDownloadFromSource,
          });
          staged = workerResult(response.response);
          const progressEvents = response.events.filter(
            (event) => event.type === 'progress' && event.stage === 'model_downloading',
          );
          const transferred = Math.max(
            0,
            ...progressEvents.map((event) => Number((event as any).transferredBytes ?? 0)),
            Number(staged.size ?? 0),
          );
          await this.setModelProgress(root, runId, item.ref, {
            transferredBytes: Math.min(item.meta.size, transferred),
          });
          break;
        } catch (error) {
          lastError = error;
          if (attempt >= MODEL_URL_RETRIES || !retryableDownloadError(error)) break;
        }
      }
      if (!staged?.valid) {
        const message = safeErrorMessage(lastError ?? new Error('Remote model staging failed.'));
        await this.setModelProgress(root, runId, item.ref, { state: 'failed', error: message });
        throw new Error(`REMOTE_MODEL_STAGING_FAILED: ${item.fileName}: ${message}`);
      }
      const sha256 = typeof staged.sha256 === 'string' ? staged.sha256.toLowerCase() : null;
      if (!sha256 || !/^[0-9a-f]{64}$/.test(sha256))
        throw new Error(`MODEL_HASH_MISSING: ${item.fileName} was not verified after staging.`);
      if (expectedSha && sha256 !== expectedSha.toLowerCase())
        throw new Error(
          `MODEL_HASH_MISMATCH: ${item.fileName} differs from the verified R2 source.`,
        );
      if (mustDownloadFromSource && staged.reused)
        throw new Error(
          `MODEL_SOURCE_VERIFICATION_FAILED: ${item.fileName} was not freshly downloaded.`,
        );
      const latestObject = await this.r2.objectMetadata(bucket, item.objectKey);
      if (
        latestObject.size !== item.meta.size ||
        latestObject.etag !== item.meta.etag ||
        (latestObject.sha256 && latestObject.sha256.toLowerCase() !== sha256)
      )
        throw new Error(`R2_MODEL_CHANGED_DURING_RUN: ${item.fileName} changed during download.`);
      await this.setModelProgress(root, runId, item.ref, {
        state: 'ready',
        transferredBytes: item.meta.size,
        totalBytes: item.meta.size,
        reused: Boolean(staged.reused),
        sha256,
        error: null,
      });
      await this.recordVerified(
        root,
        runId,
        item,
        item.meta,
        staged,
        Boolean(staged.reused),
        existingEvidence,
      );
    });

    await this.assertRunActive(root, runId);
    const completed = await getExecutionRun(root, runId);
    const currentEvidence = completed ? validatedExecutionEvidence(completed).valid : [];
    if (
      !currentEvidence.some(
        (item) => item.kind === 'MODELS_VERIFIED' && item.scope === 'remote-models',
      )
    ) {
      await recordExecutionEvidence(root, runId, {
        kind: 'MODELS_VERIFIED',
        scope: 'remote-models',
        data: { count: resolved.length },
      });
    }
    return mutateExecutionRun(root, runId, (current) => {
      current.phase = 'REMOTE_MODELS_READY';
    });
  }
}
