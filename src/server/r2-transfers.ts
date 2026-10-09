import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  R2TransferRuntime,
  type TransferStorageOperation,
} from '../application/r2-transfer-runtime.js';
import { type ActorContext, authorize } from '../domain/contracts.js';
import type { R2UploadJob, R2UploadSourceFingerprint } from '../domain/integration-types.js';
import { normalizeR2ObjectKey } from '../domain/r2-storage-policy.js';
import { assertUploadSourceBinding } from '../domain/r2-transfer-policy.js';
import type {
  ExternalDefinition,
  ExternalFacts,
  ExternalOperations,
} from './external-operations.js';
import type { FileResources } from './file-resources.js';
import {
  fields,
  HttpFailure,
  identifier,
  type JsonObject,
  json,
  object,
  type RequestContext,
} from './http.js';
import type { IntegrationSettings } from './integration-settings.js';
import type { JobDefinition, JobRegistry, PublicJob } from './jobs.js';
import { r2InternalPrefix, verifyR2ConditionalCompletion } from './r2-conditions.js';
import type { R2OperationName, R2Port } from './r2-gateway.js';
import type { Staging } from './staging.js';
import { atomicJson, SerialQueue } from './storage.js';
import { sourceFingerprint, verifiedSourcePart } from './transfer-source.js';

type Target = {
  id: string;
  userId: string;
  projectId: string;
  sourceKind: 'staging' | 'server-file';
  sourceId: string;
  name: string;
  size: number;
  sha256: string;
  sourceFingerprint: string;
  account: string;
  bucket: string;
  prefix: string;
  key: string;
};
type Phase = 'reserved' | 'active' | 'paused' | 'complete' | 'cancelled' | 'failed' | 'uncertain';
type Intent = {
  id: string;
  operation: string;
  key: string;
  uploadId: string | null;
  partNumber: number | null;
  partSize: number | null;
  md5: string | null;
  state: 'pending' | 'accepted' | 'uncertain';
  etag: string | null;
};
type Record = {
  id: string;
  targetId: string;
  receiptId: string;
  jobId: string;
  phase: Phase;
  core: R2UploadJob | null;
  intents: Intent[];
};
type Store = { schema: 'web-r2-transfers/1'; targets: Target[]; records: Record[] };
type Active = {
  core: R2TransferRuntime;
  actor: ActorContext;
  abort: AbortController;
  cancelRequested: boolean;
  cancelSignal: AbortSignal;
  settle: (state: 'succeeded' | 'failed' | 'cancelled' | 'uncertain') => void;
  progress: (value: number) => Promise<void>;
};
const digest = (raw: unknown) => createHash('sha256').update(JSON.stringify(raw)).digest('hex');
function admin(actor: ActorContext) {
  if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
}
function bucket(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(raw))
    throw new HttpFailure(400, 'INVALID_BUCKET');
  return raw;
}
function checkedKey(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw) > 1024 || /[\0\r\n]/.test(raw))
    throw new HttpFailure(400, 'INVALID_KEY');
  const key = normalizeR2ObjectKey(raw);
  if (key.startsWith(r2InternalPrefix)) throw new HttpFailure(400, 'RESERVED_KEY');
  return key;
}
function sha(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw))
    throw new HttpFailure(400, 'INVALID_INPUT');
  return raw;
}
function size(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0 || (raw as number) > 100 * 1024 ** 3)
    throw new HttpFailure(400, 'INVALID_INPUT');
  return raw as number;
}
function target(raw: unknown): Target {
  const t = object(raw);
  fields(t, [
    'id',
    'userId',
    'projectId',
    'sourceKind',
    'sourceId',
    'name',
    'size',
    'sha256',
    'sourceFingerprint',
    'account',
    'bucket',
    'prefix',
    'key',
  ]);
  if (
    !['staging', 'server-file'].includes(t.sourceKind as string) ||
    typeof t.name !== 'string' ||
    !t.name ||
    t.name !== path.basename(t.name) ||
    t.name.includes('\\') ||
    typeof t.prefix !== 'string' ||
    (t.prefix && checkedKey(t.prefix) !== t.prefix) ||
    typeof t.account !== 'string' ||
    !/^[a-f0-9]{32}$/.test(t.account)
  )
    throw new HttpFailure(400, 'INVALID_INPUT');
  const result = {
    id: identifier(t.id),
    userId: identifier(t.userId),
    projectId: identifier(t.projectId),
    sourceKind: t.sourceKind as Target['sourceKind'],
    sourceId: identifier(t.sourceId),
    name: t.name,
    size: size(t.size),
    sha256: sha(t.sha256),
    sourceFingerprint: sha(t.sourceFingerprint),
    account: t.account,
    bucket: bucket(t.bucket),
    prefix: t.prefix,
    key: checkedKey(t.key),
  };
  if (result.key !== (result.prefix ? result.prefix + '/' : '') + result.name)
    throw new HttpFailure(400, 'INVALID_INPUT');
  return result;
}
export class R2Transfers {
  private readonly file: string;
  private readonly queue = new SerialQueue();
  private initialized = false;
  private fault = false;
  private value: Store = { schema: 'web-r2-transfers/1', targets: [], records: [] };
  private readonly active = new Map<string, Active>();
  private readonly continuations = new Set<string>();
  constructor(
    dataDir: string,
    private readonly settings: IntegrationSettings,
    private readonly jobs: JobRegistry,
    private readonly operations: ExternalOperations,
    private readonly staging: Staging,
    private readonly files: FileResources,
    private readonly port: R2Port,
    private readonly invalidateIndex: () => Promise<void>,
    private readonly reauthorize: (actor: ActorContext) => Promise<ActorContext>,
  ) {
    this.file = path.join(dataDir, 'r2-transfers.json');
  }
  private async save(next: Store) {
    if (this.fault || Buffer.byteLength(JSON.stringify(next)) > 16 * 1024 * 1024)
      throw new HttpFailure(503, 'TRANSFER_STORE_UNAVAILABLE');
    try {
      await atomicJson(this.file, next);
      this.value = next;
    } catch (error) {
      this.fault = true;
      throw error;
    }
  }
  private update(id: string, change: (record: Record) => void) {
    return this.queue.run(async () => {
      const next = structuredClone(this.value),
        record = next.records.find((r) => r.id === id);
      if (!record) throw new HttpFailure(404, 'NOT_FOUND');
      change(record);
      await this.save(next);
      return structuredClone(record);
    });
  }
  async initialize() {
    let info;
    try {
      info = await lstat(this.file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.initialized = true;
        return;
      }
      throw new HttpFailure(503, 'TRANSFER_STORE_UNAVAILABLE');
    }
    try {
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 16 * 1024 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error();
      const raw = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(raw, ['schema', 'targets', 'records']);
      if (
        raw.schema !== 'web-r2-transfers/1' ||
        !Array.isArray(raw.targets) ||
        raw.targets.length > 512 ||
        !Array.isArray(raw.records) ||
        raw.records.length > 128
      )
        throw new Error();
      this.value = {
        schema: 'web-r2-transfers/1',
        targets: raw.targets.map(target),
        records: raw.records.map((value) => this.record(value)),
      };
      if (
        new Set(this.value.targets.map((t) => t.id)).size !== this.value.targets.length ||
        new Set(this.value.records.map((r) => r.id)).size !== this.value.records.length ||
        new Set(this.value.records.map((r) => r.jobId)).size !== this.value.records.length ||
        new Set(this.value.records.map((r) => r.receiptId)).size !== this.value.records.length
      )
        throw new Error();
      for (const record of this.value.records) {
        const t = this.value.targets.find((t) => t.id === record.targetId);
        if (!t) throw new Error();
        if (
          record.core &&
          (record.core.filePath !== t.sourceId ||
            record.core.fileName !== t.name ||
            record.core.size !== t.size ||
            record.core.bucket !== t.bucket ||
            record.core.key !== t.key ||
            record.core.sourceFingerprint?.sha256 !== t.sha256)
        )
          throw new Error();
        if (
          record.intents.some(
            (i) =>
              i.key !== t.key &&
              !i.key.startsWith(r2InternalPrefix + 'probes/' + record.receiptId + '-'),
          )
        )
          throw new Error();
        if (['reserved', 'active', 'paused'].includes(record.phase)) {
          record.phase = 'uncertain';
          for (const intent of record.intents)
            if (intent.state === 'pending') intent.state = 'uncertain';
        }
      }
      await this.save(this.value);
      this.initialized = true;
    } catch {
      throw new HttpFailure(503, 'TRANSFER_STORE_UNAVAILABLE');
    }
  }
  private record(raw: unknown): Record {
    const r = object(raw);
    fields(r, ['id', 'targetId', 'receiptId', 'jobId', 'phase', 'core', 'intents']);
    if (
      !['reserved', 'active', 'paused', 'complete', 'cancelled', 'failed', 'uncertain'].includes(
        r.phase as string,
      ) ||
      !Array.isArray(r.intents) ||
      r.intents.length > 32
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    const record = {
      id: identifier(r.id),
      targetId: identifier(r.targetId),
      receiptId: identifier(r.receiptId),
      jobId: identifier(r.jobId),
      phase: r.phase as Phase,
      core: r.core === null ? null : this.core(r.core),
      intents: r.intents.map((raw) => {
        const i = object(raw);
        fields(i, [
          'id',
          'operation',
          'key',
          'uploadId',
          'partNumber',
          'partSize',
          'md5',
          'state',
          'etag',
        ]);
        if (
          typeof i.operation !== 'string' ||
          ![
            'CreateMultipartUpload',
            'UploadPart',
            'CompleteMultipartUpload',
            'AbortMultipartUpload',
            'PutObject',
            'DeleteObject',
          ].includes(i.operation) ||
          typeof i.key !== 'string' ||
          !['pending', 'accepted', 'uncertain'].includes(i.state as string) ||
          (i.uploadId !== null && (typeof i.uploadId !== 'string' || i.uploadId.length > 2048)) ||
          (i.etag !== null && (typeof i.etag !== 'string' || i.etag.length > 256)) ||
          (i.md5 !== null && (typeof i.md5 !== 'string' || !/^[a-f0-9]{32}$/.test(i.md5))) ||
          (i.partNumber !== null &&
            (!Number.isSafeInteger(i.partNumber) ||
              (i.partNumber as number) < 1 ||
              (i.partNumber as number) > 10000)) ||
          (i.partSize !== null &&
            (!Number.isSafeInteger(i.partSize) ||
              (i.partSize as number) < 0 ||
              (i.partSize as number) > 32 * 1024 * 1024))
        )
          throw new HttpFailure(400, 'INVALID_INPUT');
        return { ...i, id: identifier(i.id) } as Intent;
      }),
    };
    if (
      (record.core && record.core.id !== record.jobId) ||
      new Set(record.intents.map((i) => i.id)).size !== record.intents.length
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    return record;
  }
  private core(raw: unknown): R2UploadJob {
    const c = object(raw);
    fields(c, [
      'id',
      'kind',
      'filePath',
      'fileName',
      'bucket',
      'key',
      'size',
      'contentType',
      'uploadId',
      'partSize',
      'completedParts',
      'status',
      'transferredBytes',
      'error',
      'createdAt',
      'sourceFingerprint',
      'hashProgressBytes',
      'startedAt',
      'initialTransferredBytes',
      'completedAt',
    ]);
    identifier(c.id);
    identifier(c.filePath);
    if (
      c.kind !== 'upload' ||
      typeof c.fileName !== 'string' ||
      c.fileName !== path.basename(c.fileName) ||
      c.contentType !== 'application/octet-stream' ||
      !['paused', 'uploading', 'complete', 'failed', 'cancelled'].includes(c.status as string) ||
      !Number.isSafeInteger(c.partSize) ||
      (c.partSize as number) < 1 ||
      (c.partSize as number) > 32 * 1024 * 1024 ||
      (c.uploadId !== null &&
        (typeof c.uploadId !== 'string' || !c.uploadId || c.uploadId.length > 2048)) ||
      !Number.isSafeInteger(c.transferredBytes) ||
      (c.transferredBytes as number) < 0 ||
      (c.transferredBytes as number) > size(c.size) ||
      typeof c.error !== 'string' ||
      c.error.length > 256 ||
      typeof c.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(c.createdAt))
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    bucket(c.bucket);
    checkedKey(c.key);
    const parts = object(c.completedParts);
    for (const [key, value] of Object.entries(parts))
      if (
        !/^[1-9]\d{0,4}$/.test(key) ||
        Number(key) > Math.ceil((c.size as number) / (c.partSize as number)) ||
        typeof value !== 'string' ||
        value.length > 256
      )
        throw new HttpFailure(400, 'INVALID_INPUT');
    const fp = object(c.sourceFingerprint);
    fields(fp, ['size', 'mtimeMs', 'ctimeMs', 'dev', 'ino', 'sha256', 'partSha256']);
    if (
      fp.size !== c.size ||
      !Array.isArray(fp.partSha256) ||
      fp.partSha256.length !== Math.ceil((c.size as number) / (c.partSize as number))
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    sha(fp.sha256);
    fp.partSha256.forEach(sha);
    for (const key of ['mtimeMs', 'ctimeMs', 'dev', 'ino'])
      if (typeof fp[key] !== 'number' || !Number.isFinite(fp[key]))
        throw new HttpFailure(400, 'INVALID_INPUT');
    return c as unknown as R2UploadJob;
  }
  private owned(actor: ActorContext, id: string) {
    admin(actor);
    if (!this.initialized || this.fault) throw new HttpFailure(503, 'TRANSFER_STORE_UNAVAILABLE');
    const t = this.value.targets.find((t) => t.id === identifier(id));
    if (!t || t.userId !== actor.userId) throw new HttpFailure(404, 'NOT_FOUND');
    authorize(actor, t.projectId, 'execute');
    if (t.sourceFingerprint !== this.settings.resolve('r2').fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
    return t;
  }
  private get(id: string) {
    const r = this.value.records.find((r) => r.id === identifier(id));
    if (!r) throw new HttpFailure(404, 'NOT_FOUND');
    return r;
  }
  private async source(actor: ActorContext, t: Target, jobId?: string) {
    const who = await this.reauthorize(actor);
    this.owned(who, t.id);
    if (t.sourceKind === 'staging') {
      const resource = jobId
        ? await this.staging.source(who, t.sourceId, jobId)
        : await this.staging.previewSource(who, t.sourceId);
      return { ...resource, name: t.name };
    }
    const resource = await this.files.source(who, t.sourceId, t.projectId);
    return { ...resource, name: path.basename(resource.file) };
  }
  async createTarget(actor: ActorContext, input: JsonObject) {
    admin(actor);
    fields(input, ['projectId', 'sourceKind', 'sourceId', 'bucket', 'prefix']);
    const projectId = identifier(input.projectId);
    authorize(actor, projectId, 'execute');
    const config = this.settings.resolve('r2');
    if (!['staging', 'server-file'].includes(input.sourceKind as string))
      throw new HttpFailure(400, 'INVALID_INPUT');
    const resource =
      input.sourceKind === 'staging'
        ? await this.staging.previewSource(actor, identifier(input.sourceId))
        : await this.files.source(actor, identifier(input.sourceId), projectId);
    const name = 'name' in resource ? (resource.name as string) : path.basename(resource.file);
    const prefix = input.prefix === '' ? '' : checkedKey(input.prefix);
    const t = target({
      id: randomUUID(),
      userId: actor.userId,
      projectId,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId,
      name,
      size: resource.size,
      sha256: resource.sha256,
      sourceFingerprint: config.fingerprint,
      account: config.account,
      bucket: input.bucket,
      prefix,
      key: (prefix ? prefix + '/' : '') + name,
    });
    return this.queue.run(async () => {
      if (this.settings.resolve('r2').fingerprint !== config.fingerprint)
        throw new HttpFailure(409, 'SETTINGS_CHANGED');
      if (this.value.targets.length >= 512) throw new HttpFailure(503, 'TRANSFER_CAPACITY');
      const next = structuredClone(this.value);
      next.targets.push(t);
      await this.save(next);
      return { targetId: t.id, operation: 'upload-object' };
    });
  }
  private async inspect(actor: ActorContext, id: string): Promise<ExternalFacts> {
    const t = this.owned(actor, id),
      source = await this.source(actor, t);
    if (source.size !== t.size || source.sha256 !== t.sha256)
      throw new HttpFailure(409, 'SOURCE_CHANGED');
    await sourceFingerprint(source.file, t.sha256, 16 * 1024 * 1024);
    try {
      await this.port.send('HeadObject', { Bucket: t.bucket, Key: t.key });
      throw new HttpFailure(409, 'DESTINATION_EXISTS');
    } catch (error) {
      if ((error as any)?.$metadata?.httpStatusCode !== 404) throw error;
    }
    this.owned(actor, id);
    const summary = {
      projectId: t.projectId,
      sourceId: t.sourceId,
      name: t.name,
      size: t.size,
      sha256: t.sha256,
      bucket: t.bucket,
      key: t.key,
      conditionalCheck: '一時objectでmultipartの上書き拒否を検証します。',
    };
    return {
      revision: this.settings.resolve('r2').revision,
      fingerprint: digest({ source: t.sourceFingerprint, summary }),
      summary,
    };
  }
  readonly externalDefinition: ExternalDefinition = {
    project: (id) => {
      const t = this.value.targets.find((t) => t.id === id);
      if (!t) throw new HttpFailure(404, 'NOT_FOUND');
      return t.projectId;
    },
    scope: (id) => {
      const t = this.value.targets.find((t) => t.id === id);
      if (!t) throw new HttpFailure(404, 'NOT_FOUND');
      return 'r2:' + digest({ account: t.account, bucket: t.bucket });
    },
    inspect: (actor, id) => this.inspect(actor, id),
    execute: (actor, id, receipt, facts) => this.execute(actor, id, receipt, facts),
    resume: (actor, id, receipt, facts) => this.continueReceipt(actor, id, receipt, facts),
    reconcile: (actor, receipt, id) => this.reconcileReceipt(actor, id, receipt),
  };
  private async execute(actor: ActorContext, id: string, receipt: string, facts: ExternalFacts) {
    const t = this.owned(actor, id),
      current = await this.inspect(actor, id);
    if (current.fingerprint !== facts.fingerprint) return { state: 'failed' as const };
    const record = await this.queue.run(async () => {
      if (
        this.value.records.filter((r) =>
          ['reserved', 'active', 'paused', 'uncertain'].includes(r.phase),
        ).length >= 3 ||
        this.value.records.length >= 128
      )
        throw new HttpFailure(503, 'TRANSFER_CAPACITY');
      const next = structuredClone(this.value),
        r: Record = {
          id: randomUUID(),
          targetId: id,
          receiptId: receipt,
          jobId: randomUUID(),
          phase: 'reserved',
          core: null,
          intents: [],
        };
      next.records.push(r);
      await this.save(next);
      return r;
    });
    const reserved = await this.jobs.reserve(
      actor,
      t.projectId,
      'r2-transfer',
      receipt,
      { recordId: record.id },
      {
        stage: 'r2-' + digest({ account: t.account, bucket: t.bucket }).slice(0, 24),
        provider: 'r2',
        turnId: t.id,
      },
    );
    await this.update(record.id, (r) => {
      r.jobId = reserved.job.id;
    });
    await this.jobs.activate(actor, reserved.job.id, { recordId: record.id });
    return this.waitJob(actor, record.id);
  }
  private async waitJob(actor: ActorContext, id: string) {
    for (;;) {
      const r = this.get(id),
        job = this.jobs.get(actor, r.jobId);
      if (['succeeded', 'failed', 'cancelled', 'uncertain'].includes(job.state)) {
        await this.jobs.waitIdle(job.id);
        return {
          state:
            job.state === 'succeeded'
              ? ('succeeded' as const)
              : job.state === 'uncertain'
                ? ('uncertain' as const)
                : ('failed' as const),
          result: { jobId: job.id, transferId: r.id, jobState: job.state },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  readonly definition: JobDefinition = {
    globalExclusive: true,
    validate: (input) => {
      fields(input, ['recordId']);
      const r = this.get(identifier(input.recordId));
      if (!['reserved', 'paused'].includes(r.phase))
        throw new HttpFailure(409, 'TRANSFER_ALREADY_ACTIVE');
    },
    reserve: async (job, actor, input) => {
      const r = this.get(identifier(input.recordId)),
        t = this.owned(actor, r.targetId);
      if (job.projectId !== t.projectId || job.id !== r.jobId)
        throw new HttpFailure(403, 'FORBIDDEN');
      if (t.sourceKind === 'staging') await this.staging.pin(actor, t.sourceId, job.id);
      return { release: () => this.releaseSource(r) };
    },
    run: (context) => this.run(context),
    interrupt: async (job, input) => {
      const id = identifier(input.recordId),
        active = this.active.get(id);
      active?.abort.abort();
      if (active) await active.core.pauseUpload(job.id).catch(() => {});
      await this.update(id, (r) => {
        r.phase = 'uncertain';
      });
      active?.settle('uncertain');
    },
    reconcile: async (job, input) => {
      const r = this.get(identifier(input.recordId)),
        t = this.value.targets.find((t) => t.id === r.targetId)!;
      const actor = await this.reauthorize({
        userId: t.userId,
        sessionId: 'server-job',
        requestId: job.id,
        projectIds: [],
        permissions: [],
      });
      const state = await this.proof(actor, r);
      if (state === 'complete') {
        await this.releaseSource(r);
        return { state: 'succeeded' };
      }
      return { state: 'uncertain' };
    },
  };
  private async releaseSource(r: Record) {
    const t = this.value.targets.find((t) => t.id === r.targetId)!;
    if (t.sourceKind === 'staging') await this.staging.release(t.sourceId, r.jobId);
  }
  private async run(context: Parameters<JobDefinition['run']>[0]) {
    const id = identifier(context.input.recordId),
      r = this.get(id),
      t = this.owned(context.actor, r.targetId);
    let settle!: (state: 'succeeded' | 'failed' | 'cancelled' | 'uncertain') => void;
    const done = new Promise<'succeeded' | 'failed' | 'cancelled' | 'uncertain'>((resolve) => {
      settle = resolve;
    });
    const active: Active = {
      core: null!,
      actor: context.actor,
      abort: new AbortController(),
      cancelRequested: context.signal.aborted,
      cancelSignal: context.signal,
      settle,
      progress: context.progress,
    };
    active.core = this.runtime(id, active);
    this.active.set(id, active);
    const cancel = () => {
      active.cancelRequested = true;
      if (this.get(id).core)
        void active.core.cancelUpload(context.job.id).catch(async () => {
          await this.update(id, (r) => {
            r.phase = 'uncertain';
          });
          settle('uncertain');
        });
    };
    context.signal.addEventListener('abort', cancel, { once: true });
    try {
      if (active.cancelRequested && !r.core) {
        await this.update(id, (r) => {
          r.phase = 'cancelled';
        });
        return { state: 'cancelled' as const };
      }
      await this.update(id, (r) => {
        r.phase = 'active';
      });
      if (!r.core) {
        await this.invalidateIndex();
        if (t.size > 0)
          await verifyR2ConditionalCompletion(this.boundPort(id, active), t.bucket, r.receiptId);
        const source = await this.source(context.actor, t, r.jobId);
        if (active.cancelRequested) {
          await this.update(id, (r) => {
            r.phase = 'cancelled';
          });
          return { state: 'cancelled' as const };
        }
        await sourceFingerprint(source.file, t.sha256, 16 * 1024 * 1024, active.cancelSignal);
        await active.core.beginUpload(t.bucket, t.prefix, t.sourceId, false, false);
      }
      if (active.cancelRequested) await active.core.cancelUpload(r.jobId);
      else await active.core.resumeUpload(r.jobId);
      const state = await done;
      await active.core.drainUpload(r.jobId);
      const phase = this.get(id).phase;
      return {
        state:
          phase === 'uncertain'
            ? ('uncertain' as const)
            : phase === 'failed'
              ? ('failed' as const)
              : state,
      };
    } catch {
      const unknown = this.get(id).intents.some(
        (i) => i.state === 'uncertain' || i.state === 'pending',
      );
      await this.update(id, (r) => {
        r.phase = unknown ? 'uncertain' : context.signal.aborted ? 'cancelled' : 'failed';
      });
      return {
        state: unknown
          ? ('uncertain' as const)
          : context.signal.aborted
            ? ('cancelled' as const)
            : ('failed' as const),
      };
    } finally {
      context.signal.removeEventListener('abort', cancel);
      this.active.delete(id);
    }
  }
  private runtime(id: string, active: Active) {
    let first = true;
    return new R2TransferRuntime({
      jobs: async () => {
        const r = this.get(id);
        return r.core ? [structuredClone(r.core)] : [];
      },
      save: async (core) => {
        const clean = structuredClone(core);
        clean.error = clean.error ? 'TRANSFER_REQUIRES_RECONCILIATION' : '';
        this.core(clean);
        const r = await this.update(id, (r) => {
          r.core = clean;
          r.intents = r.intents.filter(
            (i) =>
              !(
                i.state === 'accepted' &&
                ((i.operation === 'CreateMultipartUpload' && i.uploadId === core.uploadId) ||
                  (i.operation === 'UploadPart' &&
                    i.etag === core.completedParts[String(i.partNumber)]) ||
                  (i.operation === 'CompleteMultipartUpload' && core.status === 'complete') ||
                  (i.operation === 'PutObject' && core.status === 'complete') ||
                  (i.operation === 'AbortMultipartUpload' && core.status === 'cancelled'))
              ),
          );
          if (r.phase !== 'uncertain')
            r.phase = core.status === 'uploading' ? 'active' : core.status;
        });
        await active.progress(
          core.size ? core.transferredBytes / core.size : core.status === 'complete' ? 1 : 0,
        );
        if (r.phase === 'uncertain') active.settle('uncertain');
        else if (core.status === 'complete') active.settle('succeeded');
        else if (core.status === 'cancelled') active.settle('cancelled');
        else if (core.status === 'failed') active.settle('failed');
      },
      request: (operation, input) => this.request(id, active, operation, input),
      exists: async () => {
        const r = this.get(id),
          t = this.value.targets.find((t) => t.id === r.targetId)!;
        await this.source(active.actor, t, r.jobId);
        return true;
      },
      stat: async () => ({
        size: this.value.targets.find((t) => t.id === this.get(id).targetId)!.size,
      }),
      basename: () => this.value.targets.find((t) => t.id === this.get(id).targetId)!.name,
      fingerprint: async (_id, partSize) => {
        const r = this.get(id),
          t = this.value.targets.find((t) => t.id === r.targetId)!,
          source = await this.source(active.actor, t, r.jobId);
        if (r.phase === 'uncertain') throw new HttpFailure(409, 'TRANSFER_UNCERTAIN');
        return sourceFingerprint(source.file, t.sha256, partSize, active.cancelSignal);
      },
      readVerifiedPart: async (_id, start, length, baseline, number) => {
        const r = this.get(id),
          t = this.value.targets.find((t) => t.id === r.targetId)!,
          source = await this.source(active.actor, t, r.jobId);
        if (r.phase === 'uncertain' || active.abort.signal.aborted)
          throw new HttpFailure(409, 'TRANSFER_UNCERTAIN');
        return verifiedSourcePart(
          source.file,
          start,
          length,
          baseline,
          number,
          active.cancelSignal,
        );
      },
      now: () => new Date().toISOString(),
      nextId: () => {
        if (first) {
          first = false;
          return this.get(id).jobId;
        }
        return randomUUID();
      },
      sleep: async () => {
        throw new HttpFailure(409, 'TRANSFER_RETRY_REQUIRES_RECONCILIATION');
      },
      syncIndex: () => this.invalidateIndex(),
      failure: () => {
        active.settle('uncertain');
      },
    });
  }
  private boundPort(id: string, active: Active): R2Port {
    return {
      send: (name, input) => this.request(id, active, name, input),
      signed: async () => {
        throw new HttpFailure(400, 'INVALID_INPUT');
      },
    };
  }
  private async request(
    id: string,
    active: Active,
    operation: R2OperationName | TransferStorageOperation,
    input: JsonObject,
  ) {
    const r = this.get(id),
      t = this.owned(await this.reauthorize(active.actor), r.targetId);
    if (r.phase === 'uncertain' || active.abort.signal.aborted)
      throw new HttpFailure(409, 'TRANSFER_UNCERTAIN');
    if (
      input.Bucket !== t.bucket ||
      typeof input.Key !== 'string' ||
      (input.Key !== t.key &&
        !input.Key.startsWith(r2InternalPrefix + 'probes/' + r.receiptId + '-'))
    )
      throw new HttpFailure(400, 'TRANSFER_OPERATION_REJECTED');
    if (operation === 'HeadObject' || operation === 'ListParts')
      return this.port.send(operation, input, active.abort.signal);
    if (
      ![
        'CreateMultipartUpload',
        'UploadPart',
        'CompleteMultipartUpload',
        'AbortMultipartUpload',
        'PutObject',
        'DeleteObject',
      ].includes(operation)
    )
      throw new HttpFailure(400, 'TRANSFER_OPERATION_REJECTED');
    const own = input.Key === t.key;
    if (own && (operation === 'CreateMultipartUpload' || operation === 'PutObject')) {
      input = {
        ...input,
        Metadata: { 'batch-operation': r.receiptId, 'batch-sha256': t.sha256 },
        ...(operation === 'PutObject' ? { IfNoneMatch: '*' } : {}),
      };
    }
    if (own && operation === 'CompleteMultipartUpload') input = { ...input, IfNoneMatch: '*' };
    const intent: Intent = {
      id: randomUUID(),
      operation,
      key: String(input.Key),
      uploadId: typeof input.UploadId === 'string' ? input.UploadId : null,
      partNumber: typeof input.PartNumber === 'number' ? input.PartNumber : null,
      partSize: typeof input.ContentLength === 'number' ? input.ContentLength : null,
      md5:
        operation === 'UploadPart'
          ? createHash('md5')
              .update(input.Body as Uint8Array)
              .digest('hex')
          : null,
      state: 'pending',
      etag: null,
    };
    await this.update(id, (r) => {
      if (r.intents.length >= 32) throw new HttpFailure(503, 'TRANSFER_INTENT_CAPACITY');
      r.intents.push(intent);
    });
    try {
      const response = await this.port.send(operation, input, active.abort.signal);
      await this.update(id, (r) => {
        const stored = r.intents.find((i) => i.id === intent.id)!;
        stored.state = 'accepted';
        stored.etag = typeof response.ETag === 'string' ? response.ETag : null;
        if (operation === 'CreateMultipartUpload')
          stored.uploadId = typeof response.UploadId === 'string' ? response.UploadId : null;
        if (!own) r.intents = r.intents.filter((i) => i.id !== intent.id);
      });
      return response;
    } catch (error) {
      const status = (error as any)?.$metadata?.httpStatusCode;
      await this.update(id, (r) => {
        const stored = r.intents.find((i) => i.id === intent.id)!;
        if ([400, 401, 403, 404, 409, 412].includes(status)) {
          r.intents = r.intents.filter((i) => i.id !== intent.id);
        } else {
          stored.state = 'uncertain';
          r.phase = 'uncertain';
        }
      });
      throw error;
    }
  }
  private async proof(
    actor: ActorContext,
    r: Record,
  ): Promise<'complete' | 'paused' | 'uncertain'> {
    const t = this.owned(actor, r.targetId);
    try {
      const head = await this.port.send('HeadObject', { Bucket: t.bucket, Key: t.key });
      if (
        head.ContentLength === t.size &&
        head.Metadata?.['batch-operation'] === r.receiptId &&
        head.Metadata?.['batch-sha256'] === t.sha256
      ) {
        await this.update(r.id, (next) => {
          next.phase = 'complete';
          if (next.core) {
            next.core.status = 'complete';
            next.core.transferredBytes = t.size;
          }
          next.intents = [];
        });
        return 'complete';
      }
      return 'uncertain';
    } catch (error) {
      if ((error as any)?.$metadata?.httpStatusCode !== 404) throw error;
    }
    const core = r.core;
    if (
      !core?.uploadId ||
      r.intents.some((i) => i.key !== t.key || !['UploadPart'].includes(i.operation))
    )
      return 'uncertain';
    const source = await this.source(actor, t, r.jobId);
    const fp = await sourceFingerprint(source.file, t.sha256, core.partSize);
    assertUploadSourceBinding(core.sourceFingerprint!, fp);
    const found = new Map<number, { etag: string; size: number }>();
    let marker: number | undefined;
    const seen = new Set<number>();
    for (let page = 0; ; page++) {
      if (page >= 10) throw new HttpFailure(502, 'R2_PAGE_LIMIT');
      const result = await this.port.send('ListParts', {
        Bucket: t.bucket,
        Key: t.key,
        UploadId: core.uploadId,
        MaxParts: 1000,
        ...(marker ? { PartNumberMarker: marker } : {}),
      });
      if (!Array.isArray(result.Parts) || result.Parts.length > 1000)
        throw new HttpFailure(502, 'R2_PROTOCOL');
      for (const part of result.Parts) {
        if (
          !Number.isSafeInteger(part.PartNumber) ||
          part.PartNumber < 1 ||
          part.PartNumber > Math.ceil(t.size / core.partSize) ||
          found.has(part.PartNumber) ||
          typeof part.ETag !== 'string' ||
          !Number.isSafeInteger(part.Size)
        )
          throw new HttpFailure(502, 'R2_PROTOCOL');
        found.set(part.PartNumber, { etag: part.ETag, size: part.Size });
      }
      if (!result.IsTruncated) break;
      if (
        !Number.isSafeInteger(result.NextPartNumberMarker) ||
        result.NextPartNumberMarker < 1 ||
        seen.has(result.NextPartNumberMarker)
      )
        throw new HttpFailure(502, 'R2_PROTOCOL');
      marker = result.NextPartNumberMarker;
      seen.add(marker!);
    }
    const parts = { ...core.completedParts };
    for (const [number, part] of found) {
      const length = Math.min(core.partSize, t.size - (number - 1) * core.partSize);
      if (part.size !== length) throw new HttpFailure(409, 'REMOTE_PART_CHANGED');
      const pending = r.intents.find(
        (i) => i.operation === 'UploadPart' && i.partNumber === number,
      );
      if (pending) {
        if (!pending.md5 || part.etag !== '"' + pending.md5 + '"' || pending.partSize !== length)
          return 'uncertain';
        parts[String(number)] = part.etag;
      } else if (parts[String(number)] !== part.etag) return 'uncertain';
    }
    if (
      Object.keys(parts).some((n) => !found.has(Number(n))) ||
      r.intents.some((i) => !found.has(i.partNumber!))
    )
      return 'uncertain';
    this.owned(actor, t.id);
    await this.update(r.id, (next) => {
      next.phase = 'paused';
      next.core!.completedParts = parts;
      next.core!.transferredBytes = Object.keys(parts).reduce(
        (bytes, n) => bytes + Math.min(core.partSize, t.size - (Number(n) - 1) * core.partSize),
        0,
      );
      next.core!.status = 'paused';
      next.core!.error = '';
      next.intents = [];
    });
    return 'paused';
  }
  private async continueReceipt(
    actor: ActorContext,
    id: string,
    receipt: string,
    _facts: ExternalFacts,
  ) {
    const t = this.owned(actor, id),
      r = this.value.records.find((r) => r.targetId === id && r.receiptId === receipt);
    if (!r || this.active.has(r.id)) throw new HttpFailure(409, 'TRANSFER_ALREADY_ACTIVE');
    this.continuations.add(r.id);
    try {
      await this.jobs.resume(actor, r.jobId, async () => {
        if ((await this.proof(actor, r)) !== 'paused')
          throw new HttpFailure(409, 'TRANSFER_UNCERTAIN');
        if (t.projectId !== this.jobs.get(actor, r.jobId).projectId)
          throw new HttpFailure(403, 'FORBIDDEN');
      });
      return this.waitJob(actor, r.id);
    } finally {
      this.continuations.delete(r.id);
    }
  }
  private async reconcileReceipt(actor: ActorContext, id: string, receipt: string) {
    this.owned(actor, id);
    const r = this.value.records.find((r) => r.targetId === id && r.receiptId === receipt);
    if (!r) return { state: 'uncertain' as const };
    const outcome = await this.jobs.reconcile(actor, r.jobId);
    return {
      state: outcome.state === 'succeeded' ? ('succeeded' as const) : ('uncertain' as const),
      result: { jobId: r.jobId, transferId: r.id },
    };
  }
  async route(context: RequestContext): Promise<boolean> {
    const base = '/api/v1/integrations/r2/transfers';
    if (context.url.pathname !== base && !context.url.pathname.startsWith(base + '/')) return false;
    const { actor, input, url, request, response } = context;
    admin(actor);
    if (url.searchParams.size) throw new HttpFailure(400, 'INVALID_INPUT');
    if (request.method === 'GET' && url.pathname === base) {
      json(response, 200, {
        transfers: this.value.records
          .filter((r) => {
            const t = this.value.targets.find((t) => t.id === r.targetId)!;
            return t.userId === actor.userId && actor.projectIds.includes(t.projectId);
          })
          .map((r) => {
            const t = this.value.targets.find((t) => t.id === r.targetId)!;
            return {
              id: r.id,
              targetId: t.id,
              receiptId: r.receiptId,
              jobId: r.jobId,
              projectId: t.projectId,
              bucket: t.bucket,
              key: t.key,
              name: t.name,
              size: t.size,
              transferredBytes: r.core?.transferredBytes ?? 0,
              state: r.phase,
              canPause: r.phase === 'active' && r.core !== null,
              canResume: r.phase === 'paused' || r.phase === 'uncertain',
              canCancel: r.phase === 'active' || r.phase === 'paused',
            };
          }),
      });
      return true;
    }
    if (request.method === 'POST' && url.pathname === base + '/targets') {
      json(response, 201, await this.createTarget(actor, input));
      return true;
    }
    const match = /^\/([a-zA-Z0-9_-]+)\/(pause|resume|cancel|reconcile)$/.exec(
      url.pathname.slice(base.length),
    );
    if (request.method !== 'POST' || !match) throw new HttpFailure(404, 'NOT_FOUND');
    const r = this.get(match[1]),
      t = this.owned(actor, r.targetId),
      active = this.active.get(r.id);
    if (match[2] === 'pause') {
      fields(input, []);
      if (!active || !r.core) throw new HttpFailure(409, 'TRANSFER_STARTING');
      await active.core.pauseUpload(r.jobId);
      json(response, 200, { state: this.get(r.id).phase });
      return true;
    }
    if (match[2] === 'cancel') {
      fields(input, []);
      if (!active) throw new HttpFailure(409, 'RECONCILIATION_REQUIRED');
      await this.jobs.cancel(actor, r.jobId);
      json(response, 202, { state: 'cancelling' });
      return true;
    }
    if (match[2] === 'reconcile') {
      fields(input, []);
      json(response, 200, await this.operations.reconcile(actor, r.receiptId));
      return true;
    }
    fields(input, ['binding']);
    const bound = object(input.binding);
    if (bound.projectId !== t.projectId) throw new HttpFailure(403, 'FORBIDDEN');
    await this.operations.validateBinding(actor, bound);
    if (active) {
      if (r.phase !== 'paused') throw new HttpFailure(409, 'TRANSFER_ALREADY_ACTIVE');
      if ((await this.proof(actor, r)) !== 'paused')
        throw new HttpFailure(409, 'TRANSFER_UNCERTAIN');
      await this.update(r.id, (r) => {
        r.phase = 'active';
      });
      await active.core.resumeUpload(r.jobId);
      json(response, 202, { jobId: r.jobId });
      return true;
    }
    const binding = object(input.binding);
    if (binding.projectId !== t.projectId) throw new HttpFailure(403, 'FORBIDDEN');
    json(response, 202, await this.operations.resume(actor, r.receiptId, binding));
    return true;
  }
  drain() {
    return this.queue.drain();
  }
}
