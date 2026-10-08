import { randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { copyR2Snapshot } from '../application/r2-snapshot-copy.js';
import { type ActorContext, authorize } from '../domain/contracts.js';
import { fields, HttpFailure, identifier, type JsonObject, object } from './http.js';
import type { IntegrationSettings } from './integration-settings.js';
import type { JobDefinition, JobRegistry } from './jobs.js';
import { verifyR2ConditionalCompletion, verifyR2ConditionalDelete } from './r2-conditions.js';
import type { R2Port } from './r2-gateway.js';
import { atomicJson, SerialQueue } from './storage.js';
export type SnapshotTarget = {
  projectId: string;
  bucket: string;
  source: string;
  destination: string;
  size: number;
  etag: string;
  move: boolean;
  fingerprint: string;
};
type Record = {
  id: string;
  userId: string;
  receiptId: string;
  jobId: string;
  target: SnapshotTarget;
  state: 'reserved' | 'active' | 'complete' | 'failed' | 'uncertain';
  uploadId: string | null;
  intent: string | null;
  parts: { PartNumber: number; ETag: string }[];
  transferred: number;
};
export class R2ObjectTransfers {
  private readonly file: string;
  private queue = new SerialQueue();
  private records: Record[] = [];
  private fault = false;
  constructor(
    dataDir: string,
    private settings: IntegrationSettings,
    private jobs: JobRegistry,
    private port: R2Port,
    private reauthorize: (actor: ActorContext) => Promise<ActorContext>,
  ) {
    this.file = path.join(dataDir, 'r2-object-transfers.json');
  }
  private async save() {
    if (this.fault) throw new HttpFailure(503, 'TRANSFER_STORE_UNAVAILABLE');
    try {
      await atomicJson(this.file, { schema: 'web-r2-object-transfers/1', records: this.records });
    } catch (e) {
      this.fault = true;
      throw e;
    }
  }
  private update(r: Record, change: () => void) {
    return this.queue.run(async () => {
      change();
      await this.save();
    });
  }
  async initialize() {
    let stat;
    try {
      stat = await lstat(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    try {
      if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.size > 4 * 1024 * 1024 ||
        (process.platform !== 'win32' && (stat.mode & 0o077) !== 0)
      )
        throw Error();
      const raw = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(raw, ['schema', 'records']);
      if (
        raw.schema !== 'web-r2-object-transfers/1' ||
        !Array.isArray(raw.records) ||
        raw.records.length > 128
      )
        throw Error();
      const seen = new Set<string>();
      this.records = raw.records.map((raw) => {
        const r = object(raw);
        fields(r, [
          'id',
          'userId',
          'receiptId',
          'jobId',
          'target',
          'state',
          'uploadId',
          'intent',
          'parts',
          'transferred',
        ]);
        for (const k of ['id', 'userId', 'receiptId', 'jobId']) identifier(r[k]);
        if (seen.has(String(r.id))) throw Error();
        seen.add(String(r.id));
        const t = object(r.target);
        fields(t, [
          'projectId',
          'bucket',
          'source',
          'destination',
          'size',
          'etag',
          'move',
          'fingerprint',
        ]);
        identifier(t.projectId);
        if (
          typeof t.bucket !== 'string' ||
          !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(t.bucket) ||
          typeof t.source !== 'string' ||
          typeof t.destination !== 'string' ||
          t.source === t.destination ||
          [t.source, t.destination].some(
            (k) =>
              !k ||
              Buffer.byteLength(k) > 1024 ||
              /[\0\r\n]/.test(k) ||
              k.startsWith('.batch-studio/'),
          ) ||
          !Number.isSafeInteger(t.size) ||
          Number(t.size) < 1 ||
          Number(t.size) > 100 * 1024 ** 3 ||
          typeof t.etag !== 'string' ||
          !t.etag ||
          typeof t.move !== 'boolean' ||
          typeof t.fingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(t.fingerprint) ||
          !['reserved', 'active', 'complete', 'failed', 'uncertain'].includes(String(r.state)) ||
          !Array.isArray(r.parts) ||
          r.parts.length > 6400 ||
          !Number.isSafeInteger(r.transferred) ||
          Number(r.transferred) < 0 ||
          Number(r.transferred) > Number(t.size) ||
          (r.uploadId !== null &&
            (typeof r.uploadId !== 'string' || !r.uploadId || r.uploadId.length > 2048)) ||
          (r.intent !== null && (typeof r.intent !== 'string' || r.intent.length > 100))
        )
          throw Error();
        const partIds = new Set();
        for (const rawPart of r.parts) {
          const p = object(rawPart);
          fields(p, ['PartNumber', 'ETag']);
          if (
            !Number.isSafeInteger(p.PartNumber) ||
            Number(p.PartNumber) < 1 ||
            Number(p.PartNumber) > Math.ceil(Number(t.size) / (16 * 1024 ** 2)) ||
            partIds.has(p.PartNumber) ||
            typeof p.ETag !== 'string' ||
            !p.ETag ||
            p.ETag.length > 256
          )
            throw Error();
          partIds.add(p.PartNumber);
        }
        if (['reserved', 'active'].includes(String(r.state))) r.state = 'uncertain';
        return r as unknown as Record;
      });
      await this.save();
    } catch {
      throw new HttpFailure(503, 'TRANSFER_STORE_UNAVAILABLE');
    }
  }
  private owned(actor: ActorContext, r: Record) {
    if (!actor.permissions.includes('admin') || actor.userId !== r.userId)
      throw new HttpFailure(403, 'FORBIDDEN');
    authorize(actor, r.target.projectId, 'execute');
    if (this.settings.resolve('r2').fingerprint !== r.target.fingerprint)
      throw new HttpFailure(409, 'SETTINGS_CHANGED');
  }
  async execute(actor: ActorContext, target: SnapshotTarget, receiptId: string) {
    const r = await this.queue.run(async () => {
      if (
        this.records.length >= 128 ||
        this.records.filter((r) => ['reserved', 'active', 'uncertain'].includes(r.state)).length >=
          3
      )
        throw new HttpFailure(503, 'TRANSFER_CAPACITY');
      const r: Record = {
        id: randomUUID(),
        userId: actor.userId,
        receiptId,
        jobId: randomUUID(),
        target,
        state: 'reserved',
        uploadId: null,
        intent: null,
        parts: [],
        transferred: 0,
      };
      this.owned(actor, r);
      this.records.push(r);
      await this.save();
      return r;
    });
    const job = await this.jobs.reserve(
      actor,
      target.projectId,
      'r2-object-copy',
      receiptId,
      { recordId: r.id },
      { stage: 'r2-object-copy', provider: 'r2', turnId: 'shared' },
    );
    await this.update(r, () => {
      r.jobId = job.job.id;
    });
    await this.jobs.activate(actor, r.jobId, { recordId: r.id });
    for (;;) {
      const j = this.jobs.get(actor, r.jobId);
      if (['succeeded', 'failed', 'cancelled', 'uncertain'].includes(j.state)) {
        await this.jobs.waitIdle(j.id);
        return {
          state:
            j.state === 'succeeded'
              ? ('succeeded' as const)
              : j.state === 'uncertain'
                ? ('uncertain' as const)
                : ('failed' as const),
          result: { jobId: j.id, transferId: r.id },
        };
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  private get(input: JsonObject) {
    fields(input, ['recordId']);
    const r = this.records.find((r) => r.id === identifier(input.recordId));
    if (!r) throw new HttpFailure(404, 'NOT_FOUND');
    return r;
  }
  readonly definition: JobDefinition = {
    globalExclusive: true,
    validate: (input) => {
      if (this.get(input).state !== 'reserved') throw new HttpFailure(409, 'TRANSFER_UNCERTAIN');
    },
    run: async (ctx) => {
      const r = this.get(ctx.input),
        t = r.target;
      const who = async () => {
        this.owned(await this.reauthorize(ctx.actor), r);
        ctx.signal.throwIfAborted();
        if (r.state === 'uncertain') throw new HttpFailure(409, 'TRANSFER_UNCERTAIN');
      };
      const send = async (name: Parameters<R2Port['send']>[0], input: JsonObject) => {
        await who();
        const readOnly = name === 'HeadObject' || name === 'GetObject';
        if (!readOnly)
          await this.update(r, () => {
            r.intent = name;
          });
        try {
          const result = await this.port.send(name, input, ctx.signal);
          if (!readOnly)
            await this.update(r, () => {
              r.intent = null;
              if (name === 'CreateMultipartUpload' && input.Key === t.destination)
                r.uploadId = result.UploadId;
            });
          return result;
        } catch (error) {
          if (!readOnly)
            await this.update(r, () => {
              if (
                [400, 401, 403, 404, 409, 412].includes((error as any)?.$metadata?.httpStatusCode)
              )
                r.intent = null;
              else r.state = 'uncertain';
            });
          throw error;
        }
      };
      try {
        this.owned(ctx.actor, r);
        await this.update(r, () => {
          r.state = 'active';
        });
        const bound: R2Port = {
          send,
          signed: async () => {
            throw new HttpFailure(400, 'INVALID_INPUT');
          },
        };
        await verifyR2ConditionalCompletion(bound, t.bucket, r.receiptId);
        if (t.move) await verifyR2ConditionalDelete(bound, t.bucket, r.receiptId);
        await copyR2Snapshot(t.size, {
          check: () => ctx.signal.throwIfAborted(),
          begin: async () => {
            const response = await send('CreateMultipartUpload', {
              Bucket: t.bucket,
              Key: t.destination,
              ContentType: 'application/octet-stream',
              Metadata: {
                'batch-operation': r.receiptId,
                'batch-source-etag': Buffer.from(t.etag).toString('base64'),
                'batch-source-size': String(t.size),
              },
            });
            if (typeof response.UploadId !== 'string' || !response.UploadId)
              throw new HttpFailure(502, 'R2_PROTOCOL');
            return response.UploadId;
          },
          read: async (start, length) => {
            const response = await send('GetObject', {
              Bucket: t.bucket,
              Key: t.source,
              IfMatch: t.etag,
              Range: `bytes=${start}-${start + length - 1}`,
            });
            if (
              !(response.Body instanceof Readable) ||
              response.ETag !== t.etag ||
              response.ContentLength !== length ||
              response.ContentRange !== `bytes ${start}-${start + length - 1}/${t.size}`
            ) {
              response.Body?.destroy?.();
              throw new HttpFailure(502, 'R2_PROTOCOL');
            }
            const result = Buffer.alloc(length);
            let n = 0;
            const timer = setTimeout(
              () => response.Body.destroy(new HttpFailure(504, 'R2_TIMEOUT')),
              30_000,
            );
            const abort = () => response.Body.destroy();
            ctx.signal.addEventListener('abort', abort, { once: true });
            try {
              for await (const chunk of response.Body) {
                ctx.signal.throwIfAborted();
                if (n + chunk.length > length) throw new HttpFailure(502, 'R2_PROTOCOL');
                result.set(chunk, n);
                n += chunk.length;
              }
              if (n !== length) throw new HttpFailure(502, 'R2_PROTOCOL');
              return result;
            } finally {
              clearTimeout(timer);
              ctx.signal.removeEventListener('abort', abort);
              response.Body.destroy();
            }
          },
          upload: async (uploadId, number, bytes) => {
            const part = await send('UploadPart', {
              Bucket: t.bucket,
              Key: t.destination,
              UploadId: uploadId,
              PartNumber: number,
              Body: bytes,
              ContentLength: bytes.length,
            });
            if (typeof part.ETag !== 'string' || !part.ETag)
              throw new HttpFailure(502, 'R2_PROTOCOL');
            await this.update(r, () => {
              r.parts.push({ PartNumber: number, ETag: part.ETag });
            });
            return part.ETag;
          },
          complete: async (uploadId, parts) => {
            await send('CompleteMultipartUpload', {
              Bucket: t.bucket,
              Key: t.destination,
              UploadId: uploadId,
              IfNoneMatch: '*',
              MultipartUpload: { Parts: parts },
            });
          },
          progress: async (bytes) => {
            await this.update(r, () => {
              r.transferred = bytes;
            });
            await ctx.progress(bytes / t.size);
          },
        });
        const destination = await send('HeadObject', { Bucket: t.bucket, Key: t.destination });
        if (
          destination.ContentLength !== t.size ||
          destination.Metadata?.['batch-operation'] !== r.receiptId ||
          destination.Metadata?.['batch-source-etag'] !== Buffer.from(t.etag).toString('base64')
        )
          throw new HttpFailure(409, 'DESTINATION_CHANGED');
        if (t.move) {
          const source = await send('HeadObject', { Bucket: t.bucket, Key: t.source });
          if (source.ETag !== t.etag || source.ContentLength !== t.size)
            throw new HttpFailure(409, 'SOURCE_CHANGED');
          await send('DeleteObject', { Bucket: t.bucket, Key: t.source, IfMatch: t.etag });
        }
        await this.update(r, () => {
          r.state = 'complete';
        });
        return { state: 'succeeded' };
      } catch {
        await this.update(r, () => {
          r.state =
            r.intent !== null || r.uploadId !== null || r.state === 'uncertain'
              ? 'uncertain'
              : 'failed';
        });
        return { state: r.state === 'failed' ? 'failed' : 'uncertain' };
      }
    },
    reconcile: async (_job, input) => {
      const r = this.get(input),
        t = r.target;
      const actor = await this.reauthorize({
        userId: r.userId,
        sessionId: 'server-job',
        requestId: r.jobId,
        projectIds: [],
        permissions: [],
      });
      this.owned(actor, r);
      try {
        const d = await this.port.send('HeadObject', { Bucket: t.bucket, Key: t.destination });
        if (
          d.ContentLength !== t.size ||
          d.Metadata?.['batch-operation'] !== r.receiptId ||
          d.Metadata?.['batch-source-etag'] !== Buffer.from(t.etag).toString('base64')
        )
          return { state: 'uncertain' };
        if (t.move) {
          try {
            await this.port.send('HeadObject', { Bucket: t.bucket, Key: t.source });
            return { state: 'uncertain' };
          } catch (e) {
            if ((e as any)?.$metadata?.httpStatusCode !== 404) throw e;
          }
        }
        await this.update(r, () => {
          r.state = 'complete';
          r.intent = null;
        });
        return { state: 'succeeded' };
      } catch {
        return { state: 'uncertain' };
      }
    },
    interrupt: async (_job, input) => {
      const r = this.get(input);
      await this.update(r, () => {
        r.state = 'uncertain';
      });
    },
  };
  async reconcile(actor: ActorContext, receiptId: string) {
    const r = this.records.find((r) => r.receiptId === receiptId);
    if (!r) return;
    this.owned(actor, r);
    await this.jobs.reconcile(actor, r.jobId);
  }
  drain() {
    return this.queue.drain();
  }
}
