import type { R2UploadJob, R2UploadSourceFingerprint } from '../domain/integration-types.js';
import { normalizeR2ObjectKey, objectName } from '../domain/r2-storage-policy.js';
import { utf8Size } from '../domain/text-policy.js';
import {
  SOURCE_CHANGED,
  sourceChanged,
  assertUploadSourceBinding,
} from '../domain/r2-transfer-policy.js';
const MIB = 1024 * 1024,
  DEFAULT_PART = 16 * MIB,
  MAX_PARTS = 10000,
  FIVE_GIB = 5 * 1024 * 1024 * 1024,
  UPLOAD_CONCURRENCY = 3,
  UPLOAD_RETRIES = 3;
export type TransferStorageOperation =
  | 'HeadObject'
  | 'CopyObject'
  | 'CreateMultipartUpload'
  | 'UploadPartCopy'
  | 'CompleteMultipartUpload'
  | 'DeleteObject'
  | 'AbortMultipartUpload'
  | 'UploadPart'
  | 'PutObject';
interface StorageRequest {
  operation: TransferStorageOperation;
  input: Record<string, unknown>;
}
interface TransferClient {
  send(request: StorageRequest): Promise<any>;
}
function storageRequest(
  operation: TransferStorageOperation,
  input: Record<string, unknown>,
): StorageRequest {
  return { operation, input };
}
export interface R2TransferPorts {
  jobs(): Promise<R2UploadJob[]>;
  save(job: R2UploadJob): Promise<void>;
  request(operation: TransferStorageOperation, input: Record<string, unknown>): Promise<any>;
  exists(resourceId: string): Promise<boolean>;
  stat(resourceId: string): Promise<{ size: number }>;
  basename(resourceId: string): string;
  fingerprint(resourceId: string, partSize: number): Promise<R2UploadSourceFingerprint>;
  readVerifiedPart(
    resourceId: string,
    start: number,
    length: number,
    baseline: R2UploadSourceFingerprint,
    partNumber: number,
  ): Promise<Uint8Array>;
  now(): string;
  nextId(): string;
  sleep(ms: number): Promise<void>;
  syncIndex(): void;
}
interface UploadControl {
  paused: boolean;
  cancelled: boolean;
  completing: boolean;
  generation: string;
}
function statusCode(error: any) {
  return Number(error?.$metadata?.httpStatusCode ?? 0);
}
function partSize(size: number) {
  const required = Math.max(DEFAULT_PART, Math.ceil(Math.max(size, 1) / MAX_PARTS));
  return Math.ceil(required / MIB) * MIB;
}
function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}

export class R2TransferRuntime {
  private controls = new Map<string, UploadControl>();
  private readonly startingUploads = new Map<string, Promise<R2UploadJob>>();
  private readonly activeUploads = new Map<string, Promise<void>>();
  private readonly cancellingUploads = new Map<string, Promise<R2UploadJob | undefined>>();
  private readonly cancellationRequested = new Set<string>();
  private activeMoveJobs = new Set<string>();
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(private readonly ports: R2TransferPorts) {}
  private async clientFor(): Promise<TransferClient> {
    return { send: (request) => this.ports.request(request.operation, request.input) };
  }
  private async assertSourceFingerprint(
    resourceId: string,
    expected: R2UploadSourceFingerprint,
    partSize: number,
  ) {
    assertUploadSourceBinding(expected, await this.ports.fingerprint(resourceId, partSize));
  }
  async move(bucket: string, sourceKey: string, destinationKey: string, overwrite = false) {
    const destination = normalizeR2ObjectKey(destinationKey);
    if (!sourceKey || sourceKey === destination)
      throw new Error('移動元と異なる移動先を指定してください。');
    const client = await this.clientFor();
    if (!overwrite) {
      try {
        await client.send(storageRequest('HeadObject', { Bucket: bucket, Key: destination }));
        throw new Error('移動先に同名のファイルが存在します。');
      } catch (e: any) {
        if (e instanceof Error && e.message.includes('同名')) throw e;
        if (statusCode(e) !== 404 && e?.name !== 'NotFound') throw e;
      }
    }
    const head = await client.send(
      storageRequest('HeadObject', { Bucket: bucket, Key: sourceKey }),
    );
    const size = Number(head.ContentLength ?? 0),
      now = this.ports.now();
    const job: any = {
      id: this.ports.nextId(),
      kind: 'move',
      bucket,
      key: destination,
      filePath: '',
      fileName: objectName(destination),
      sourceKey,
      destinationKey: destination,
      size,
      contentType: 'application/octet-stream',
      uploadId: null,
      partSize: 0,
      completedParts: {},
      status: 'uploading',
      transferredBytes: 0,
      error: '',
      createdAt: now,
      startedAt: now,
      initialTransferredBytes: 0,
    };
    await this.saveUpload(job);
    this.activeMoveJobs.add(job.id);
    void this.runMove(job, sourceKey, destination, size);
    return job;
  }
  private async runMove(job: any, sourceKey: string, destinationKey: string, size: number) {
    const client = await this.clientFor(),
      copySource = `${job.bucket}/${encodeKey(sourceKey)}`;
    let multipartUploadId: string | null = null;
    try {
      if (size <= FIVE_GIB) {
        await client.send(
          storageRequest('CopyObject', {
            Bucket: job.bucket,
            Key: destinationKey,
            CopySource: copySource,
          }),
        );
        job.transferredBytes = size;
        await this.saveUpload(job);
      } else {
        const chunk = Math.max(64 * MIB, partSize(size));
        const create = await client.send(
          storageRequest('CreateMultipartUpload', { Bucket: job.bucket, Key: destinationKey }),
        );
        multipartUploadId = create.UploadId ?? null;
        if (!multipartUploadId) throw new Error('Multipart copyを開始できませんでした。');
        const parts = [] as Array<{ ETag?: string; PartNumber: number }>;
        for (let start = 0, n = 1; start < size; start += chunk, n++) {
          const end = Math.min(size - 1, start + chunk - 1);
          const p = await client.send(
            storageRequest('UploadPartCopy', {
              Bucket: job.bucket,
              Key: destinationKey,
              UploadId: multipartUploadId,
              PartNumber: n,
              CopySource: copySource,
              CopySourceRange: `bytes=${start}-${end}`,
            }),
          );
          parts.push({ PartNumber: n, ETag: p.CopyPartResult?.ETag });
          job.transferredBytes = Math.min(size, end + 1);
          await this.saveUpload(job);
        }
        await client.send(
          storageRequest('CompleteMultipartUpload', {
            Bucket: job.bucket,
            Key: destinationKey,
            UploadId: multipartUploadId,
            MultipartUpload: { Parts: parts },
          }),
        );
      }
      await client.send(storageRequest('DeleteObject', { Bucket: job.bucket, Key: sourceKey }));
      job.status = 'complete';
      job.transferredBytes = size;
      job.completedAt = this.ports.now();
      await this.saveUpload(job);
      this.ports.syncIndex();
    } catch (e) {
      if (multipartUploadId)
        await client
          .send(
            storageRequest('AbortMultipartUpload', {
              Bucket: job.bucket,
              Key: destinationKey,
              UploadId: multipartUploadId,
            }),
          )
          .catch(() => {});
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      job.completedAt = this.ports.now();
      await this.saveUpload(job);
    } finally {
      this.activeMoveJobs.delete(job.id);
    }
  }
  private async uploadState() {
    return { schemaVersion: 1 as const, jobs: await this.ports.jobs() };
  }
  private async saveUploadNow(job: R2UploadJob) {
    await this.ports.save(job);
  }
  private async saveUpload(job: R2UploadJob) {
    // Capture the state at enqueue time: later worker mutations must not
    // rewrite an earlier save with an unintended newer status.
    const snapshot = JSON.parse(JSON.stringify(job)) as R2UploadJob;
    const task = this.saveQueue.then(() => this.saveUploadNow(snapshot));
    this.saveQueue = task.catch(() => {});
    return task;
  }
  async uploads() {
    const s = await this.uploadState();
    return s.jobs.map((j: any) =>
      j.kind === 'move' && j.status === 'uploading' && !this.activeMoveJobs.has(j.id)
        ? {
            ...j,
            status: 'failed' as const,
            error: 'アプリ再起動により移動処理が中断されました。状態を確認して再実行してください。',
          }
        : j.kind !== 'move' && j.status === 'uploading' && !this.controls.has(j.id)
          ? { ...j, status: 'paused' as const }
          : j,
    );
  }
  async beginUpload(bucket: string, prefix: string, filePath: string, overwrite = false) {
    if (!(await this.ports.exists(filePath)))
      throw new Error('アップロード元ファイルが見つかりません。');
    const st = await this.ports.stat(filePath),
      sourceFingerprint = await this.ports.fingerprint(filePath, partSize(st.size)),
      name = this.ports.basename(filePath),
      key = `${prefix.replace(/^\/+|\/+$/g, '')}${prefix ? '/' : ''}${name}`;
    if (utf8Size(key) > 1024) throw new Error('オブジェクト名が1,024バイトを超えています。');
    const client = await this.clientFor();
    if (!overwrite) {
      try {
        await client.send(storageRequest('HeadObject', { Bucket: bucket, Key: key }));
        throw new Error('同名のファイルが存在します。');
      } catch (e: any) {
        if (e instanceof Error && e.message.includes('同名')) throw e;
        if (statusCode(e) !== 404 && e?.name !== 'NotFound') throw e;
      }
    }
    let uploadId: string | null = null;
    if (st.size > 0) {
      const r = await client.send(
        storageRequest('CreateMultipartUpload', {
          Bucket: bucket,
          Key: key,
          ContentType: 'application/octet-stream',
        }),
      );
      uploadId = r.UploadId ?? null;
      if (!uploadId) throw new Error('Multipart uploadを開始できませんでした。');
    }
    const job: any = {
      id: this.ports.nextId(),
      kind: 'upload',
      bucket,
      key,
      filePath,
      fileName: name,
      size: st.size,
      sourceFingerprint,
      hashProgressBytes: st.size,
      contentType: 'application/octet-stream',
      uploadId,
      partSize: partSize(st.size),
      completedParts: {},
      status: 'paused',
      transferredBytes: 0,
      error: '',
      createdAt: this.ports.now(),
    };
    await this.saveUpload(job);
    void this.resumeUpload(job.id);
    return job;
  }
  async resumeUpload(id: string): Promise<R2UploadJob> {
    const inFlight = this.startingUploads.get(id);
    if (inFlight) return inFlight;
    if (this.cancellationRequested.has(id))
      throw new Error('このアップロードはキャンセル処理中です。');
    const active = this.controls.get(id);
    if (active) {
      const state = await this.uploadState();
      const job = state.jobs.find((item) => item.id === id);
      if (!job) throw new Error('アップロードセッションが見つかりません。');
      return job;
    }
    const control: UploadControl = {
      paused: false,
      cancelled: false,
      completing: false,
      generation: this.ports.nextId(),
    };
    // Register synchronously before the first await. Both IPC duplicate Resume
    // and concurrent Pause/Cancel now reference the same worker control.
    this.controls.set(id, control);
    const starter = this.startUpload(id, control).finally(() => {
      if (this.startingUploads.get(id) === starter) this.startingUploads.delete(id);
    });
    this.startingUploads.set(id, starter);
    return starter;
  }
  private async startUpload(id: string, control: UploadControl): Promise<R2UploadJob> {
    try {
      const state = await this.uploadState(),
        job = state.jobs.find((item) => item.id === id);
      if (!job) throw new Error('アップロードセッションが見つかりません。');
      if (job.kind === 'move') throw new Error('移動ジョブは再開操作できません。');
      if (job.status === 'complete' || job.status === 'cancelled') return job;
      if (!(await this.ports.exists(job.filePath))) throw new Error('元ファイルが見つかりません。');
      if (!job.sourceFingerprint) throw sourceChanged('元ファイルの内容ハッシュがありません');
      await this.assertSourceFingerprint(job.filePath, job.sourceFingerprint, job.partSize);
      job.hashProgressBytes = job.size;
      if (control.cancelled || control.paused) return job;
      job.status = 'uploading';
      job.error = '';
      job.startedAt = this.ports.now();
      job.initialTransferredBytes = job.transferredBytes;
      await this.saveUpload(job);
      const worker = this.runUpload(job, control).finally(() => {
        if (this.activeUploads.get(id) === worker) this.activeUploads.delete(id);
        if (this.controls.get(id) === control) this.controls.delete(id);
      });
      this.activeUploads.set(id, worker);
      return job;
    } catch (error) {
      if (this.controls.get(id) === control) this.controls.delete(id);
      throw error;
    } finally {
      // No worker was started for terminal/invalid jobs.
      if (!this.activeUploads.has(id) && this.controls.get(id) === control)
        this.controls.delete(id);
    }
  }
  private async uploadPartWithRetry(
    job: any,
    number: number,
    client: TransferClient,
    control: UploadControl,
  ) {
    const start = (number - 1) * job.partSize,
      end = Math.min(job.size - 1, start + job.partSize - 1),
      length = end - start + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
      if (control.cancelled || control.paused) return false;
      try {
        const r = await client.send(
          storageRequest('UploadPart', {
            Bucket: job.bucket,
            Key: job.key,
            UploadId: job.uploadId ?? undefined,
            PartNumber: number,
            Body: await this.ports.readVerifiedPart(
              job.filePath,
              start,
              length,
              job.sourceFingerprint,
              number,
            ),
            ContentLength: length,
          }),
        );
        if (!r.ETag) throw new Error(`Part ${number} のETagを取得できませんでした。`);
        job.completedParts[String(number)] = r.ETag;
        job.transferredBytes = Math.min(
          job.size,
          Object.keys(job.completedParts).reduce((total, key) => {
            const n = Number(key),
              partStart = (n - 1) * job.partSize,
              partEnd = Math.min(job.size, partStart + job.partSize);
            return total + Math.max(0, partEnd - partStart);
          }, 0),
        );
        await this.saveUpload(job);
        return true;
      } catch (e) {
        lastError = e;
        if (attempt < UPLOAD_RETRIES) await this.ports.sleep(700 * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }
  private async runUpload(job: any, control: UploadControl) {
    try {
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      const client = await this.clientFor();
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      if (job.size === 0) {
        if (control.cancelled || control.paused) return;
        control.completing = true;
        await client.send(
          storageRequest('PutObject', {
            Bucket: job.bucket,
            Key: job.key,
            Body: new Uint8Array(0),
            ContentType: job.contentType,
          }),
        );
        job.status = 'complete';
        job.completedAt = this.ports.now();
        await this.saveUpload(job);
        this.ports.syncIndex();
        return;
      }
      if (!job.uploadId) throw new Error('Upload IDがありません。');
      const count = Math.ceil(job.size / job.partSize),
        queue: number[] = [];
      for (let n = 1; n <= count; n++) if (!job.completedParts[String(n)]) queue.push(n);
      let cursor = 0,
        failure: unknown = null;
      const worker = async () => {
        while (cursor < queue.length && !failure && !control.cancelled && !control.paused) {
          const number = queue[cursor++];
          try {
            await this.uploadPartWithRetry(job, number, client, control);
          } catch (e) {
            failure = e;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, Math.max(queue.length, 1)) }, () =>
          worker(),
        ),
      );
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      if (failure) throw failure;
      await this.assertSourceFingerprint(job.filePath, job.sourceFingerprint, job.partSize);
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      // Claim the completion phase synchronously with the final cancellation
      // check. Cancel waits for this request and never aborts a completed upload.
      control.completing = true;
      const parts = Array.from({ length: count }, (_, i) => ({
        PartNumber: i + 1,
        ETag: job.completedParts[String(i + 1)],
      }));
      await client.send(
        storageRequest('CompleteMultipartUpload', {
          Bucket: job.bucket,
          Key: job.key,
          UploadId: job.uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
      job.status = 'complete';
      job.transferredBytes = job.size;
      job.completedAt = this.ports.now();
      await this.saveUpload(job);
      this.ports.syncIndex();
    } catch (e) {
      if (control.cancelled) return;
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      job.completedAt = this.ports.now();
      await this.saveUpload(job);
      if (job.error.startsWith(SOURCE_CHANGED) && job.uploadId) {
        try {
          await (await this.clientFor()).send(
            storageRequest('AbortMultipartUpload', {
              Bucket: job.bucket,
              Key: job.key,
              UploadId: job.uploadId,
            }),
          );
          job.uploadId = null;
          job.completedParts = {};
          await this.saveUpload(job);
        } catch {
          // Retain the upload ID so Cancel can retry cleanup if R2 is unavailable.
        }
      }
    }
  }
  async pauseUpload(id: string) {
    const control = this.controls.get(id);
    if (control) control.paused = true;
    // Wait for startup and every in-flight UploadPart/Complete request. Once
    // this returns, the previous generation cannot write any more state.
    await this.startingUploads.get(id)?.catch(() => {});
    await this.activeUploads.get(id)?.catch(() => {});
    const state = await this.uploadState(),
      job = state.jobs.find((item) => item.id === id);
    if (!job) throw new Error('アップロードセッションが見つかりません。');
    if (job.kind === 'move') throw new Error('移動ジョブは一時停止できません。');
    if (this.cancellationRequested.has(id)) return job;
    if (job.status === 'complete' || job.status === 'cancelled') return job;
    job.status = 'paused';
    await this.saveUpload(job);
    return job;
  }
  async cancelUpload(id: string): Promise<R2UploadJob | undefined> {
    const existing = this.cancellingUploads.get(id);
    if (existing) return existing;
    this.cancellationRequested.add(id);
    const control = this.controls.get(id);
    if (control) control.cancelled = true;
    const task = this.cancelUploadAfterDrain(id).finally(() => {
      if (this.cancellingUploads.get(id) === task) this.cancellingUploads.delete(id);
      this.cancellationRequested.delete(id);
    });
    this.cancellingUploads.set(id, task);
    return task;
  }
  private async cancelUploadAfterDrain(id: string): Promise<R2UploadJob | undefined> {
    await this.startingUploads.get(id)?.catch(() => {});
    await this.activeUploads.get(id)?.catch(() => {});
    const state = await this.uploadState(),
      job = state.jobs.find((item) => item.id === id);
    if (!job) return undefined;
    if (job.kind === 'move') throw new Error('移動ジョブはキャンセルできません。');
    // CompleteMultipartUpload may have entered S3 before Cancel was requested.
    // An already completed object is never relabeled cancelled or aborted.
    if (job.status === 'complete' || job.status === 'cancelled') return job;
    if (job.uploadId)
      await (await this.clientFor()).send(
        storageRequest('AbortMultipartUpload', {
          Bucket: job.bucket,
          Key: job.key,
          UploadId: job.uploadId,
        }),
      );
    job.status = 'cancelled';
    job.completedAt = this.ports.now();
    await this.saveUpload(job);
    return job;
  }
}
