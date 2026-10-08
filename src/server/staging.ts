import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { ActorContext } from '../domain/contracts.js';
import { authorize } from '../domain/contracts.js';
import { fields, HttpFailure, identifier, json, object, type RequestContext } from './http.js';
import { atomicJson, SerialQueue } from './storage.js';

type Record = {
  id: string;
  userId: string;
  projectId: string | null;
  name: string;
  size: number;
  offset: number;
  expiresAt: number;
  state: 'uploading' | 'complete';
  expectedHash: string | null;
  sha256: string | null;
  pins: string[];
};
type Store = { schema: 'web-staging/1'; resources: Record[] };
const MAX_FILE = 100 * 1024 ** 3;
const QUOTA = 200 * 1024 ** 3;
const MAX_CHUNK = 8 * 1024 ** 2;
function size(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || Number(raw) < 0 || Number(raw) > MAX_FILE)
    throw new HttpFailure(400, 'INVALID_INPUT');
  return Number(raw);
}
function hash(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw))
    throw new HttpFailure(400, 'INVALID_INPUT');
  return raw;
}
export class Staging {
  private readonly queue = new SerialQueue();
  private readonly file: string;
  private readonly root: string;
  private value: Store = { schema: 'web-staging/1', resources: [] };
  private fault = false;
  constructor(
    dataDir: string,
    private readonly now = Date.now,
  ) {
    this.file = path.join(dataDir, 'staging.json');
    this.root = path.join(dataDir, 'staging');
  }
  async initialize(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if ((await realpath(this.root)) !== this.root)
      throw new HttpFailure(503, 'STAGING_UNAVAILABLE');
    let info;
    try {
      info = await lstat(this.file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    try {
      if (
        !info.isFile() ||
        info.isSymbolicLink() ||
        info.size > 64 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error('Invalid store');
      const raw = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(raw, ['schema', 'resources']);
      if (
        raw.schema !== 'web-staging/1' ||
        !Array.isArray(raw.resources) ||
        raw.resources.length > 128
      )
        throw new Error('Invalid store');
      const ids = new Set();
      const resources = raw.resources.map((entry): Record => {
        const r = object(entry);
        fields(r, [
          'id',
          'userId',
          'projectId',
          'name',
          'size',
          'offset',
          'expiresAt',
          'state',
          'expectedHash',
          'sha256',
          'pins',
        ]);
        if (!Array.isArray(r.pins) || r.pins.length > 16 || new Set(r.pins).size !== r.pins.length)
          throw new Error('Invalid pins');
        r.pins.forEach(identifier);
        identifier(r.id);
        identifier(r.userId);
        if (r.projectId !== null) identifier(r.projectId);
        if (
          ids.has(r.id) ||
          typeof r.name !== 'string' ||
          r.name.length > 255 ||
          /[\0\r\n]/.test(r.name) ||
          size(r.offset) > size(r.size) ||
          !Number.isSafeInteger(r.expiresAt) ||
          Number(r.expiresAt) < 0 ||
          !['uploading', 'complete'].includes(r.state as string)
        )
          throw new Error('Invalid resource');
        if (r.expectedHash !== null) hash(r.expectedHash);
        if (r.state === 'complete') {
          hash(r.sha256);
          if (r.offset !== r.size || (r.expectedHash && r.sha256 !== r.expectedHash))
            throw new Error('Invalid hash');
        } else if (r.sha256 !== null) throw new Error('Invalid hash');
        ids.add(r.id);
        return r as unknown as Record;
      });
      if (resources.reduce((sum, r) => sum + r.size, 0) > QUOTA) throw new Error('Quota exceeded');
      this.value = { schema: 'web-staging/1', resources };
      // Recover only uncommitted tail bytes; never infer a completed upload.
      for (const record of resources) {
        const handle = await this.handle(record);
        try {
          const stat = await handle.stat();
          if (
            stat.size < record.offset ||
            (record.state === 'complete' && stat.size !== record.size)
          )
            throw new Error('Truncated resource');
          if (record.state === 'uploading' && stat.size > record.offset) {
            await handle.truncate(record.offset);
            await handle.sync();
          }
        } finally {
          await handle.close();
        }
      }
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'STAGING_UNAVAILABLE');
    }
  }
  private async handle(record: Record) {
    if ((await realpath(this.root)) !== this.root) throw new HttpFailure(403, 'RESOURCE_CHANGED');
    const file = path.join(this.root, record.id);
    const before = await lstat(file);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      before.nlink !== 1 ||
      (await realpath(file)) !== file
    )
      throw new HttpFailure(403, 'RESOURCE_CHANGED');
    const handle = await open(file, 'r+');
    const after = await handle.stat();
    if (before.ino !== after.ino || before.dev !== after.dev || after.nlink !== 1) {
      await handle.close();
      throw new HttpFailure(403, 'RESOURCE_CHANGED');
    }
    return handle;
  }
  private owned(actor: ActorContext, id: string, allowExpired = false): Record {
    if (this.fault) throw new HttpFailure(503, 'STAGING_UNAVAILABLE');
    identifier(id);
    const record = this.value.resources.find((r) => r.id === id);
    if (!record || record.userId !== actor.userId) throw new HttpFailure(404, 'NOT_FOUND');
    if (record.projectId) authorize(actor, record.projectId, 'execute');
    else if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
    if (!allowExpired && record.expiresAt <= this.now())
      throw new HttpFailure(410, 'RESOURCE_EXPIRED');
    return record;
  }
  private public(record: Record) {
    const { id, name, size, offset, expiresAt, state, sha256 } = record;
    return { id, name, size, offset, expiresAt, state, sha256, maxChunkBytes: MAX_CHUNK };
  }
  private async save(next: Store): Promise<void> {
    if (this.fault || Buffer.byteLength(JSON.stringify(next)) > 64 * 1024)
      throw new HttpFailure(503, 'STAGING_UNAVAILABLE');
    try {
      await atomicJson(this.file, next);
      this.value = next;
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'STAGING_UNAVAILABLE');
    }
  }
  async create(
    actor: ActorContext,
    raw: { projectId?: unknown; name: unknown; size: unknown; sha256?: unknown },
  ) {
    const projectId = raw.projectId === undefined ? null : identifier(raw.projectId);
    if (projectId) authorize(actor, projectId, 'execute');
    else if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
    if (
      typeof raw.name !== 'string' ||
      !raw.name ||
      raw.name.length > 255 ||
      /[\0\r\n]/.test(raw.name)
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    const name = raw.name,
      total = size(raw.size),
      expectedHash = raw.sha256 === undefined ? null : hash(raw.sha256);
    return this.queue.run(async () => {
      if (
        this.fault ||
        this.value.resources.length >= 128 ||
        this.value.resources.reduce((sum, r) => sum + r.size, total) > QUOTA
      )
        throw new HttpFailure(409, 'STAGING_QUOTA');
      const record: Record = {
        id: randomUUID(),
        userId: actor.userId,
        projectId,
        name,
        size: total,
        offset: 0,
        expiresAt: this.now() + 24 * 60 * 60_000,
        state: 'uploading',
        expectedHash,
        sha256: null,
        pins: [],
      };
      const handle = await open(path.join(this.root, record.id), 'wx', 0o600);
      await handle.sync();
      await handle.close();
      const next = structuredClone(this.value);
      next.resources.push(record);
      try {
        await this.save(next);
      } catch (e) {
        await unlink(path.join(this.root, record.id));
        throw e;
      }
      return this.public(record);
    });
  }
  async complete(actor: ActorContext, id: string) {
    return this.queue.run(async () => {
      const record = this.owned(actor, id);
      if (record.state === 'complete') return this.public(record);
      if (record.offset !== record.size) throw new HttpFailure(409, 'UPLOAD_INCOMPLETE');
      const handle = await this.handle(record);
      try {
        const before = await handle.stat();
        const digest = createHash('sha256');
        const stream = handle.createReadStream({
          autoClose: false,
          start: 0,
          highWaterMark: 1024 * 1024,
          signal: AbortSignal.timeout(30 * 60_000),
        });
        for await (const chunk of stream) digest.update(chunk);
        const sha256 = digest.digest('hex');
        const after = await handle.stat();
        if (
          before.size !== record.size ||
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs ||
          (record.expectedHash && record.expectedHash !== sha256)
        )
          throw new HttpFailure(409, 'SOURCE_HASH_MISMATCH');
        const next = structuredClone(this.value);
        const r = next.resources.find((r) => r.id === id)!;
        r.state = 'complete';
        r.sha256 = sha256;
        await this.save(next);
        return this.public(r);
      } finally {
        await handle.close();
      }
    });
  }
  route = async (ctx: RequestContext): Promise<boolean> => {
    const match =
      /^\/api\/v1\/resources\/staging(?:\/([a-zA-Z0-9_-]+)(?:\/(complete|delete))?)?$/.exec(
        ctx.url.pathname,
      );
    if (!match) return false;
    if (ctx.request.method === 'GET' && match[1] && !match[2]) {
      json(ctx.response, 200, this.public(this.owned(ctx.actor, match[1])));
      return true;
    }
    if (ctx.request.method !== 'POST') throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    if (!match[1]) {
      fields(ctx.input, ['projectId', 'name', 'size', 'sha256']);
      json(
        ctx.response,
        201,
        await this.create(ctx.actor, ctx.input as unknown as Parameters<Staging['create']>[1]),
      );
      return true;
    }
    fields(ctx.input, []);
    if (match[2] === 'complete') {
      json(ctx.response, 200, await this.complete(ctx.actor, match[1]));
      return true;
    }
    if (match[2] === 'delete') {
      await this.queue.run(async () => {
        const record = this.owned(ctx.actor, match[1], true);
        if (record.pins.length) throw new HttpFailure(409, 'RESOURCE_IN_USE');
        const handle = await this.handle(record);
        await handle.close();
        const next = structuredClone(this.value);
        next.resources = next.resources.filter((r) => r.id !== record.id);
        await this.save(next);
        await unlink(path.join(this.root, record.id));
      });
      json(ctx.response, 200, { deleted: true });
      return true;
    }
    throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
  };
  binaryRoute = async (ctx: Omit<RequestContext, 'input'>): Promise<boolean> => {
    const match = /^\/api\/v1\/resources\/staging\/([a-zA-Z0-9_-]+)$/.exec(ctx.url.pathname);
    if (!match || ctx.request.method !== 'PUT') return false;
    if (ctx.url.search || ctx.request.headers['content-type'] !== 'application/octet-stream')
      throw new HttpFailure(415, 'BINARY_REQUIRED');
    const rawOffset = ctx.request.headers['x-upload-offset'],
      rawSize = ctx.request.headers['content-length'];
    if (
      typeof rawOffset !== 'string' ||
      !/^[0-9]{1,12}$/.test(rawOffset) ||
      typeof rawSize !== 'string' ||
      !/^[0-9]{1,8}$/.test(rawSize)
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    const offset = size(Number(rawOffset)),
      bytesExpected = Number(rawSize),
      expectedHash = hash(ctx.request.headers['x-upload-sha256']);
    if (bytesExpected < 1 || bytesExpected > MAX_CHUNK)
      throw new HttpFailure(413, 'CHUNK_TOO_LARGE');
    const result = await this.queue.run(async () => {
      const record = this.owned(ctx.actor, match[1]);
      if (
        record.state !== 'uploading' ||
        record.offset !== offset ||
        offset + bytesExpected > record.size
      )
        throw new HttpFailure(409, 'UPLOAD_OFFSET_CONFLICT');
      const handle = await this.handle(record);
      let bytes = 0;
      const digest = createHash('sha256');
      let committed = false;
      try {
        await handle.truncate(offset);
        for await (const chunk of ctx.request) {
          bytes += chunk.length;
          if (bytes > bytesExpected) throw new HttpFailure(413, 'CHUNK_TOO_LARGE');
          digest.update(chunk);
          let written = 0;
          while (written < chunk.length) {
            const result = await handle.write(
              chunk,
              written,
              chunk.length - written,
              offset + bytes - chunk.length + written,
            );
            if (!result.bytesWritten) throw new Error('Write failed');
            written += result.bytesWritten;
          }
        }
        if (bytes !== bytesExpected || digest.digest('hex') !== expectedHash)
          throw new HttpFailure(409, 'CHUNK_HASH_MISMATCH');
        await handle.sync();
        const next = structuredClone(this.value);
        const r = next.resources.find((r) => r.id === record.id)!;
        r.offset += bytes;
        await this.save(next);
        committed = true;
        return this.public(r);
      } finally {
        if (!committed) {
          await handle.truncate(offset);
          await handle.sync();
        }
        await handle.close();
      }
    });
    json(ctx.response, 200, result);
    return true;
  };
  async pin(actor: ActorContext, id: string, jobId: string): Promise<void> {
    identifier(jobId);
    await this.queue.run(async () => {
      const known = this.value.resources.find((r) => r.id === id);
      const r = this.owned(actor, id, !!known?.pins.includes(jobId));
      if (r.state !== 'complete' || (!r.pins.includes(jobId) && r.pins.length >= 16))
        throw new HttpFailure(409, 'RESOURCE_NOT_READY');
      if (r.pins.includes(jobId)) return;
      const next = structuredClone(this.value);
      next.resources.find((r) => r.id === id)!.pins.push(jobId);
      await this.save(next);
    });
  }
  async release(id: string, jobId: string): Promise<void> {
    identifier(id);
    identifier(jobId);
    await this.queue.run(async () => {
      const next = structuredClone(this.value);
      const r = next.resources.find((r) => r.id === id);
      if (!r || !r.pins.includes(jobId)) throw new HttpFailure(409, 'RESOURCE_NOT_PINNED');
      r.pins = r.pins.filter((p) => p !== jobId);
      await this.save(next);
    });
  }
  async previewSource(actor: ActorContext, id: string) {
    const r = this.owned(actor, id);
    if (r.state !== 'complete') throw new HttpFailure(409, 'RESOURCE_INCOMPLETE');
    const handle = await this.handle(r);
    try {
      const stat = await handle.stat();
      if (stat.size !== r.size) throw new HttpFailure(409, 'RESOURCE_CHANGED');
    } finally {
      await handle.close();
    }
    return { file: path.join(this.root, r.id), name: r.name, size: r.size, sha256: r.sha256! };
  }
  async source(actor: ActorContext, id: string, jobId: string) {
    const r = this.owned(actor, id, true);
    if (r.state !== 'complete' || !r.pins.includes(identifier(jobId)))
      throw new HttpFailure(409, 'RESOURCE_NOT_PINNED');
    const handle = await this.handle(r);
    try {
      const stat = await handle.stat();
      if (stat.size !== r.size) throw new HttpFailure(409, 'RESOURCE_CHANGED');
    } finally {
      await handle.close();
    }
    return { file: path.join(this.root, r.id), size: r.size, sha256: r.sha256! };
  }
  async drain(): Promise<void> {
    await this.queue.drain();
  }
}
