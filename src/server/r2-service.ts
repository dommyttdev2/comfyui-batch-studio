import { createHash, randomUUID } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ActorContext } from '../domain/contracts.js';
import type { R2BatchDownloadTemplate } from '../domain/integration-types.js';
import { searchIndexedObjects } from '../domain/r2-object-index-policy.js';
import {
  normalizeBatchTemplateObjects,
  normalizeR2ObjectKey,
  normalizeR2PresignedExpiresIn,
  normalizeR2PutContentType,
  normalizeR2PutObjectKey,
  objectName,
} from '../domain/r2-storage-policy.js';
import type { R2Object } from '../domain/resource-observation-types.js';
import {
  deleteSavedTemplate,
  type R2TemplateInput,
  saveR2Template,
} from '../domain/saved-template-policy.js';
import type {
  ExternalDefinition,
  ExternalFacts,
  ExternalOperation,
} from './external-operations.js';
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
import { r2InternalPrefix, verifyR2ConditionalDelete } from './r2-conditions.js';
import { R2Gateway, type R2Port } from './r2-gateway.js';
import { atomicJson, SerialQueue } from './storage.js';

type Target = {
  id: string;
  userId: string;
  sourceFingerprint: string;
  account: string;
  operation: ExternalOperation;
  bucket: string;
  keys: string[];
  destination?: string;
};
type Store = {
  schema: 'web-r2/1';
  sourceFingerprint: string;
  revision: number;
  indexedAt: string | null;
  buckets: Record<string, R2Object[]>;
  templates: R2BatchDownloadTemplate[];
  targets: Target[];
};
const mutations: ExternalOperation[] = [
  'create-bucket',
  'delete-bucket',
  'delete-objects',
  'move-object',
  'copy-object',
];
function bucket(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/.test(raw))
    throw new HttpFailure(400, 'INVALID_BUCKET');
  return raw;
}
function key(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || Buffer.byteLength(raw) > 1024 || /[\0\r\n]/.test(raw))
    throw new HttpFailure(400, 'INVALID_KEY');
  if (raw.replace(/^\/+/, '').startsWith(r2InternalPrefix))
    throw new HttpFailure(400, 'RESERVED_KEY');
  return raw;
}
function text(raw: unknown, max = 1024): string {
  if (typeof raw !== 'string' || raw.length > max || /[\0\r\n]/.test(raw))
    throw new HttpFailure(400, 'INVALID_INPUT');
  return raw;
}
function admin(actor: ActorContext): void {
  if (!actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
}
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class R2Service {
  readonly port: R2Port;
  private value: Store | undefined;
  private readonly file: string;
  private readonly queue = new SerialQueue();
  private fault = false;
  constructor(
    dataDir: string,
    private readonly settings: IntegrationSettings,
    definitions: Map<ExternalOperation, ExternalDefinition>,
    port?: R2Port,
  ) {
    this.file = path.join(dataDir, 'r2.json');
    this.port = port ?? new R2Gateway(settings);
    for (const op of mutations)
      definitions.set(op, {
        scope: (id) => {
          const target = this.target(id);
          return 'r2:' + digest({ account: target.account, bucket: target.bucket });
        },
        inspect: (actor, id) => {
          if (this.owned(actor, id).operation !== op)
            throw new HttpFailure(400, 'INVALID_OPERATION');
          return this.inspect(actor, id);
        },
        execute: (actor, id, receipt, facts) => {
          if (this.owned(actor, id).operation !== op)
            throw new HttpFailure(400, 'INVALID_OPERATION');
          return this.execute(actor, id, facts, receipt);
        },
        reconcile: (actor, receipt, id, facts) => {
          if (this.owned(actor, id).operation !== op)
            throw new HttpFailure(400, 'INVALID_OPERATION');
          return this.reconcile(actor, id, facts, receipt);
        },
      });
  }
  async initialize(): Promise<void> {
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
        info.size > 32 * 1024 * 1024 ||
        (process.platform !== 'win32' && (info.mode & 0o077) !== 0)
      )
        throw new Error('Invalid store');
      const raw = object(JSON.parse(await readFile(this.file, 'utf8')));
      fields(raw, [
        'schema',
        'sourceFingerprint',
        'revision',
        'indexedAt',
        'buckets',
        'templates',
        'targets',
      ]);
      if (
        raw.schema !== 'web-r2/1' ||
        typeof raw.sourceFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(raw.sourceFingerprint) ||
        !Number.isSafeInteger(raw.revision) ||
        Number(raw.revision) < 1 ||
        (raw.indexedAt !== null &&
          (typeof raw.indexedAt !== 'string' || !Number.isFinite(Date.parse(raw.indexedAt)))) ||
        !Array.isArray(raw.templates) ||
        !Array.isArray(raw.targets) ||
        raw.targets.length > 1000
      )
        throw new Error('Invalid store');
      const buckets = object(raw.buckets);
      if (Object.keys(buckets).length > 1000) throw new Error('Invalid index');
      for (const [name, entries] of Object.entries(buckets)) {
        bucket(name);
        if (!Array.isArray(entries) || entries.length > 100000) throw new Error('Invalid index');
        const seen = new Set();
        for (const entry of entries) {
          const row = object(entry);
          fields(row, ['key', 'name', 'size', 'etag', 'lastModified', 'storageClass']);
          key(row.key);
          if (
            seen.has(row.key) ||
            !Number.isSafeInteger(row.size) ||
            Number(row.size) < 0 ||
            typeof row.etag !== 'string' ||
            typeof row.name !== 'string'
          )
            throw new Error('Invalid object');
          seen.add(row.key);
        }
      }
      const seen = new Set();
      for (const entry of raw.targets) {
        const row = object(entry);
        fields(row, [
          'id',
          'userId',
          'sourceFingerprint',
          'account',
          'operation',
          'bucket',
          'keys',
          'destination',
        ]);
        identifier(row.id);
        identifier(row.userId);
        if (typeof row.account !== 'string' || !/^[a-f0-9]{32}$/.test(row.account))
          throw new Error('Invalid account');
        bucket(row.bucket);
        if (
          seen.has(row.id) ||
          !mutations.includes(row.operation as ExternalOperation) ||
          typeof row.sourceFingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(row.sourceFingerprint) ||
          !Array.isArray(row.keys) ||
          row.keys.length > 500
        )
          throw new Error('Invalid target');
        if (
          new Set(row.keys).size !== row.keys.length ||
          ((row.operation === 'move-object' || row.operation === 'copy-object') &&
            (row.keys.length !== 1 || row.destination === undefined)) ||
          (row.operation === 'delete-objects' && !row.keys.length) ||
          (String(row.operation).endsWith('bucket') && row.keys.length) ||
          (row.operation !== 'move-object' &&
            row.operation !== 'copy-object' &&
            row.destination !== undefined) ||
          (row.destination !== undefined && row.destination === row.keys[0])
        )
          throw new Error('Invalid target shape');
        row.keys.forEach(key);
        if (row.destination !== undefined) normalizeR2ObjectKey(key(row.destination));
        seen.add(row.id);
      }
      for (const rawTemplate of raw.templates) {
        const template = object(rawTemplate);
        identifier(template.id);
        bucket(template.bucket);
        fields(template, ['id', 'name', 'bucket', 'objects', 'createdAt', 'updatedAt']);
        if (
          typeof template.createdAt !== 'string' ||
          !Number.isFinite(Date.parse(template.createdAt)) ||
          typeof template.updatedAt !== 'string' ||
          !Number.isFinite(Date.parse(template.updatedAt))
        )
          throw new Error('Invalid template timestamps');
        saveR2Template(
          [],
          {
            name: template.name as string,
            bucket: template.bucket as string,
            objects: template.objects as R2TemplateInput['objects'],
          },
          new Date().toISOString(),
          () => identifier(template.id),
        );
      }
      this.value = raw as unknown as Store;
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'R2_STORE_UNAVAILABLE');
    }
  }
  private current(): Store {
    if (this.fault) throw new HttpFailure(503, 'R2_STORE_UNAVAILABLE');
    const sourceFingerprint = this.settings.resolve('r2').fingerprint;
    // Targets remain available for conservative reconciliation; stale index/templates are invalidated.
    return this.value?.sourceFingerprint === sourceFingerprint
      ? structuredClone(this.value)
      : {
          schema: 'web-r2/1',
          sourceFingerprint,
          revision: this.value?.revision ?? 0,
          indexedAt: null,
          buckets: {},
          templates: [],
          targets: structuredClone(this.value?.targets ?? []),
        };
  }
  private async save(next: Store): Promise<void> {
    if (this.fault || Buffer.byteLength(JSON.stringify(next)) > 32 * 1024 * 1024)
      throw new HttpFailure(503, 'R2_STORE_UNAVAILABLE');
    next.revision++;
    try {
      await atomicJson(this.file, next);
      this.value = next;
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'R2_STORE_UNAVAILABLE');
    }
  }
  async buckets() {
    const data = await this.port.send('ListBuckets', {});
    if (!Array.isArray(data.Buckets) || data.Buckets.length > 1000)
      throw new HttpFailure(502, 'R2_PROTOCOL');
    return data.Buckets.map((row: any) => ({
      name: bucket(row.Name),
      createdAt: row.CreationDate?.toISOString() ?? null,
    }));
  }
  async list(name: string, prefix = '', token?: string) {
    bucket(name);
    text(prefix);
    if (token !== undefined) text(token, 4096);
    const data = await this.port.send('ListObjectsV2', {
      Bucket: name,
      Prefix: prefix,
      ...(token ? { ContinuationToken: token } : {}),
      MaxKeys: 1000,
    });
    const contents = data.Contents ?? [];
    if (
      !Array.isArray(contents) ||
      contents.length > 1000 ||
      (data.IsTruncated && typeof data.NextContinuationToken !== 'string')
    )
      throw new HttpFailure(502, 'R2_PROTOCOL');
    const internalCount = contents.filter(
      (row: any) => typeof row.Key === 'string' && row.Key.startsWith(r2InternalPrefix),
    ).length;
    const objects: R2Object[] = contents
      .filter((row: any) => !(typeof row.Key === 'string' && row.Key.startsWith(r2InternalPrefix)))
      .map((row: any) => {
        key(row.Key);
        if (!Number.isSafeInteger(row.Size) || row.Size < 0 || typeof row.ETag !== 'string')
          throw new HttpFailure(502, 'R2_PROTOCOL');
        return {
          key: row.Key,
          name: objectName(row.Key),
          size: row.Size,
          etag: row.ETag,
          lastModified: row.LastModified?.toISOString() ?? null,
          storageClass: row.StorageClass,
        };
      });
    return {
      objects,
      internalCount,
      nextToken: data.IsTruncated ? data.NextContinuationToken : null,
    };
  }
  async syncIndex(actor: ActorContext) {
    admin(actor);
    return this.queue.run(async () => {
      const next = this.current();
      const entries: Record<string, R2Object[]> = {};
      for (const b of await this.buckets()) {
        const objects: R2Object[] = [];
        const seen = new Set<string>();
        let token: string | undefined;
        for (let pages = 0; ; pages++) {
          if (pages >= 1000) throw new HttpFailure(502, 'R2_PAGE_LIMIT');
          const page = await this.list(b.name, '', token);
          objects.push(...page.objects);
          if (objects.length > 100000) throw new HttpFailure(502, 'R2_INDEX_LIMIT');
          if (!page.nextToken) break;
          if (seen.has(page.nextToken)) throw new HttpFailure(502, 'R2_CURSOR');
          token = page.nextToken as string;
          seen.add(token);
        }
        entries[b.name] = objects;
      }
      if (next.sourceFingerprint !== this.settings.resolve('r2').fingerprint)
        throw new HttpFailure(409, 'TARGET_CHANGED');
      next.buckets = entries;
      next.indexedAt = new Date().toISOString();
      await this.save(next);
      return {
        indexedAt: next.indexedAt,
        revision: next.revision,
        buckets: Object.keys(entries).length,
      };
    });
  }
  indexedObjects(name: string): R2Object[] {
    const current = this.current();
    if (!current.indexedAt || !current.buckets[bucket(name)])
      throw new HttpFailure(503, 'R2_INDEX_UNAVAILABLE');
    return current.buckets[name];
  }
  private target(id: string): Target {
    const target = this.value?.targets.find((row) => row.id === id);
    if (!target) throw new HttpFailure(404, 'NOT_FOUND');
    return target;
  }
  async createTarget(actor: ActorContext, input: JsonObject) {
    admin(actor);
    fields(input, ['operation', 'bucket', 'keys', 'destination']);
    if (
      !mutations.includes(input.operation as ExternalOperation) ||
      !Array.isArray(input.keys) ||
      input.keys.length > 500
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    const keys = input.keys.map(key);
    if (new Set(keys).size !== keys.length) throw new HttpFailure(400, 'INVALID_INPUT');
    const op = input.operation as ExternalOperation;
    if (
      ((op === 'move-object' || op === 'copy-object') && keys.length !== 1) ||
      (op === 'delete-objects' && !keys.length) ||
      (op.endsWith('bucket') && keys.length !== 0) ||
      (op !== 'move-object' && op !== 'copy-object' && input.destination !== undefined)
    )
      throw new HttpFailure(400, 'INVALID_INPUT');
    const destination =
      op === 'move-object' || op === 'copy-object'
        ? normalizeR2ObjectKey(key(input.destination))
        : undefined;
    if (destination !== undefined && destination === keys[0])
      throw new HttpFailure(400, 'INVALID_INPUT');
    return this.queue.run(async () => {
      const next = this.current();
      if (next.targets.length >= 1000) throw new HttpFailure(409, 'R2_STORE_LIMIT');
      const target: Target = {
        id: randomUUID(),
        userId: actor.userId,
        sourceFingerprint: next.sourceFingerprint,
        account: this.settings.resolve('r2').account!,
        operation: op,
        bucket: bucket(input.bucket),
        keys,
        ...(destination ? { destination } : {}),
      };
      next.targets.push(target);
      await this.save(next);
      return { targetId: target.id, operation: op };
    });
  }
  private async head(name: string, objectKey: string) {
    try {
      const data = await this.port.send('HeadObject', { Bucket: name, Key: objectKey });
      if (
        !Number.isSafeInteger(data.ContentLength) ||
        data.ContentLength < 0 ||
        typeof data.ETag !== 'string'
      )
        throw new HttpFailure(502, 'R2_PROTOCOL');
      return {
        size: data.ContentLength as number,
        etag: data.ETag as string,
        version: data.VersionId ?? null,
      };
    } catch (e) {
      if ((e as any)?.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  private owned(actor: ActorContext, id: string): Target {
    admin(actor);
    const target = this.target(id);
    if (target.userId !== actor.userId) throw new HttpFailure(404, 'NOT_FOUND');
    if (target.sourceFingerprint !== this.settings.resolve('r2').fingerprint)
      throw new HttpFailure(409, 'TARGET_CHANGED');
    return target;
  }
  private async inspect(actor: ActorContext, id: string): Promise<ExternalFacts> {
    const t = this.owned(actor, id);
    const config = this.settings.resolve('r2');
    const existing = (await this.buckets()).some((b: { name: string }) => b.name === t.bucket);
    if (
      (t.operation === 'create-bucket' && existing) ||
      (t.operation !== 'create-bucket' && !existing)
    )
      throw new HttpFailure(409, 'TARGET_CHANGED');
    if (t.operation === 'delete-bucket') {
      const contents = await this.list(t.bucket);
      if (contents.objects.length || contents.internalCount)
        throw new HttpFailure(409, 'BUCKET_NOT_EMPTY');
    }
    const objects = [];
    for (const k of t.keys) {
      const h = await this.head(t.bucket, k);
      if (!h) throw new HttpFailure(404, 'NOT_FOUND');
      objects.push({ key: k, ...h });
    }
    if (t.destination && (await this.head(t.bucket, t.destination)))
      throw new HttpFailure(409, 'DESTINATION_EXISTS');
    const summary = {
      bucket: t.bucket,
      objects,
      destination: t.destination ?? null,
      conditionalCheck:
        t.keys.length > 0
          ? '一時objectで条件付き削除を確認し、不成立なら対象を変更しません。'
          : null,
    };
    return {
      revision: config.revision,
      fingerprint: digest({ account: t.account, sourceFingerprint: t.sourceFingerprint, summary }),
      summary,
    };
  }
  private async execute(actor: ActorContext, id: string, prepared: ExternalFacts, receipt: string) {
    const target = this.owned(actor, id);
    const current = await this.inspect(actor, id);
    if (current.fingerprint !== prepared.fingerprint || current.revision !== prepared.revision)
      return { state: 'failed' as const };
    this.owned(actor, id);
    if (target.operation === 'create-bucket')
      await this.port.send('CreateBucket', { Bucket: target.bucket });
    else if (target.operation === 'delete-bucket')
      await this.port.send('DeleteBucket', { Bucket: target.bucket });
    else if (target.operation === 'delete-objects') {
      await verifyR2ConditionalDelete(this.port, target.bucket, receipt);
      this.owned(actor, id);
      for (const row of prepared.summary.objects as JsonObject[]) {
        this.owned(actor, id);
        await this.port.send('DeleteObject', {
          Bucket: target.bucket,
          Key: row.key,
          IfMatch: row.etag,
        });
      }
    } else {
      const source = (prepared.summary.objects as JsonObject[])[0];
      if (Number(source.size) > 5 * 1024 * 1024 * 1024)
        throw new HttpFailure(409, 'MULTIPART_MOVE_REQUIRED');
      if (target.operation === 'move-object')
        await verifyR2ConditionalDelete(this.port, target.bucket, receipt);
      this.owned(actor, id);
      const response = await this.port.send('GetObject', {
        Bucket: target.bucket,
        Key: target.keys[0],
        IfMatch: source.etag,
      });
      if (
        !(response.Body instanceof Readable) ||
        response.ContentLength !== source.size ||
        response.ETag !== source.etag
      ) {
        response.Body?.destroy?.();
        throw new HttpFailure(502, 'R2_PROTOCOL');
      }
      const controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), 30 * 60_000);
      let bytes = 0;
      const verifier = new Transform({
        highWaterMark: 64 * 1024,
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > Number(source.size)) callback(new HttpFailure(502, 'R2_PROTOCOL'));
          else callback(null, chunk);
        },
        flush(callback) {
          callback(bytes === Number(source.size) ? null : new HttpFailure(502, 'R2_PROTOCOL'));
        },
      });
      this.owned(actor, id);
      const streamed = pipeline(response.Body, verifier, { signal: controller.signal });
      void streamed.catch(() => {});
      try {
        await Promise.all([
          streamed,
          this.port.send(
            'PutObject',
            {
              Bucket: target.bucket,
              Key: target.destination,
              Body: verifier,
              ContentLength: source.size,
              IfNoneMatch: '*',
              Metadata: {
                'batch-operation': receipt,
                'batch-source-etag': Buffer.from(String(source.etag)).toString('base64'),
                'batch-source-size': String(source.size),
              },
            },
            controller.signal,
          ),
        ]);
      } catch (error) {
        controller.abort();
        response.Body.destroy();
        verifier.destroy();
        await streamed.catch(() => {});
        throw error;
      } finally {
        clearTimeout(timer);
      }
      const copied = await this.port.send('HeadObject', {
        Bucket: target.bucket,
        Key: target.destination,
      });
      const observed = await this.head(target.bucket, target.keys[0]);
      if (
        copied.ContentLength !== source.size ||
        copied.Metadata?.['batch-operation'] !== receipt ||
        copied.Metadata?.['batch-source-etag'] !==
          Buffer.from(String(source.etag)).toString('base64') ||
        (target.operation === 'move-object' && (!observed || observed.etag !== source.etag))
      )
        return { state: 'uncertain' as const };
      if (target.operation === 'move-object') {
        this.owned(actor, id);
        await this.port.send('DeleteObject', {
          Bucket: target.bucket,
          Key: target.keys[0],
          IfMatch: source.etag,
        });
      }
    }
    return { state: 'succeeded' as const, result: { bucket: target.bucket } };
  }
  private async reconcile(
    actor: ActorContext,
    id: string,
    prepared: ExternalFacts,
    receipt: string,
  ) {
    const t = this.owned(actor, id);
    if (t.operation === 'create-bucket' || t.operation === 'delete-bucket')
      return { state: 'uncertain' as const }; // Presence alone cannot prove who created/deleted a bucket.
    if (t.operation === 'delete-objects') {
      for (const k of t.keys)
        if (await this.head(t.bucket, k)) return { state: 'uncertain' as const };
      return { state: 'succeeded' as const };
    }
    const source = (prepared.summary.objects as JsonObject[])[0];
    let destination;
    try {
      destination = await this.port.send('HeadObject', { Bucket: t.bucket, Key: t.destination });
    } catch (error) {
      if ((error as any)?.$metadata?.httpStatusCode !== 404) throw error;
    }
    if (
      (t.operation === 'copy-object' || !(await this.head(t.bucket, t.keys[0]))) &&
      destination &&
      destination.ContentLength === source.size &&
      destination.Metadata?.['batch-operation'] === receipt &&
      destination.Metadata?.['batch-source-etag'] ===
        Buffer.from(String(source.etag)).toString('base64')
    )
      return { state: 'succeeded' as const };
    return { state: 'uncertain' as const };
  }
  async route(ctx: RequestContext): Promise<boolean> {
    if (!ctx.url.pathname.startsWith('/api/v1/integrations/r2/')) return false;
    if (!ctx.actor.permissions.includes('read')) throw new HttpFailure(403, 'FORBIDDEN');
    const action = ctx.url.pathname.slice('/api/v1/integrations/r2/'.length);
    const params = ctx.url.searchParams;
    const queryFields: Record<string, string[]> = {
      status: [],
      buckets: [],
      list: ['bucket', 'prefix', 'token'],
      search: ['bucket', 'query', 'token'],
      metadata: ['bucket', 'key'],
      templates: ['bucket'],
      metrics: [],
      download: ['bucket', 'key'],
    };
    if (ctx.request.method === 'GET')
      for (const name of params.keys()) {
        if (!queryFields[action]?.includes(name) || params.getAll(name).length !== 1)
          throw new HttpFailure(400, 'INVALID_INPUT');
      }
    if (ctx.request.method === 'GET') {
      if (action === 'status') {
        json(ctx.response, 200, {
          state: this.settings.providerState('r2'),
          canManage: ctx.actor.permissions.includes('admin'),
        });
        return true;
      }
      if (action === 'buckets') {
        json(ctx.response, 200, { buckets: await this.buckets() });
        return true;
      }
      if (action === 'list') {
        json(
          ctx.response,
          200,
          await this.list(
            bucket(params.get('bucket')),
            text(params.get('prefix') ?? ''),
            params.get('token') ?? undefined,
          ),
        );
        return true;
      }
      if (action === 'search') {
        const query = text(params.get('query') ?? '', 200);
        const token = params.get('token');
        if (token !== null && !/^local:[0-9]+$/.test(token))
          throw new HttpFailure(400, 'INVALID_INPUT');
        json(
          ctx.response,
          200,
          searchIndexedObjects(this.indexedObjects(bucket(params.get('bucket'))), query, token),
        );
        return true;
      }
      if (action === 'metadata') {
        json(ctx.response, 200, {
          metadata: await this.head(bucket(params.get('bucket')), key(params.get('key'))),
        });
        return true;
      }
      if (action === 'templates') {
        const current = this.current();
        json(ctx.response, 200, {
          revision: current.revision,
          templates: current.templates.filter((t) => t.bucket === bucket(params.get('bucket'))),
        });
        return true;
      }
      if (action === 'metrics') {
        const current = this.current();
        json(ctx.response, 200, {
          revision: current.revision,
          indexedAt: current.indexedAt,
          objects: Object.values(current.buckets).reduce((sum, rows) => sum + rows.length, 0),
        });
        return true;
      }
      if (action === 'download') {
        const name = bucket(params.get('bucket')),
          k = key(params.get('key'));
        const result = await this.port.send('GetObject', { Bucket: name, Key: k });
        if (!result.Body || !Number.isSafeInteger(result.ContentLength))
          throw new HttpFailure(502, 'R2_PROTOCOL');
        ctx.response.setHeader('Content-Type', 'application/octet-stream');
        ctx.response.setHeader('Content-Length', String(result.ContentLength));
        ctx.response.setHeader(
          'Content-Disposition',
          "attachment; filename*=UTF-8''" + encodeURIComponent(objectName(k)),
        );
        await pipeline(result.Body, ctx.response, { signal: AbortSignal.timeout(30 * 60_000) });
        return true;
      }
      throw new HttpFailure(404, 'NOT_FOUND');
    }
    if (ctx.request.method !== 'POST') throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    admin(ctx.actor);
    if (action === 'index') {
      fields(ctx.input, []);
      json(ctx.response, 200, await this.syncIndex(ctx.actor));
      return true;
    }
    if (action === 'targets') {
      json(ctx.response, 200, await this.createTarget(ctx.actor, ctx.input));
      return true;
    }
    if (action === 'batch-download-info') {
      fields(ctx.input, ['bucket', 'objects', 'expiresIn']);
      const name = bucket(ctx.input.bucket);
      const objects = normalizeBatchTemplateObjects(ctx.input.objects);
      const expiresIn = normalizeR2PresignedExpiresIn(Number(ctx.input.expiresIn));
      const results = [];
      for (const row of objects) {
        const metadata = await this.head(name, row.key);
        if (!metadata) throw new HttpFailure(404, 'NOT_FOUND');
        results.push({
          ...row,
          size: metadata.size,
          url: await this.port.signed(
            'GetObject',
            { Bucket: name, Key: row.key, IfMatch: metadata.etag },
            expiresIn,
          ),
        });
      }
      json(ctx.response, 200, {
        bucket: name,
        objects: results,
        expiresAt: Date.now() + expiresIn * 1000,
      });
      return true;
    }
    if (action === 'download-info' || action === 'put-url-info') {
      fields(ctx.input, ['bucket', 'key', 'expiresIn', 'contentType']);
      const name = bucket(ctx.input.bucket),
        k =
          action === 'put-url-info'
            ? normalizeR2PutObjectKey(key(ctx.input.key))
            : key(ctx.input.key);
      const expiresIn = normalizeR2PresignedExpiresIn(Number(ctx.input.expiresIn));
      if (action === 'download-info' && !(await this.head(name, k)))
        throw new HttpFailure(404, 'NOT_FOUND');
      const url = await this.port.signed(
        action === 'download-info' ? 'GetObject' : 'PutObject',
        {
          Bucket: name,
          Key: k,
          ...(action === 'put-url-info'
            ? {
                ContentType:
                  normalizeR2PutContentType(ctx.input.contentType as string) ?? undefined,
                IfNoneMatch: '*',
              }
            : {}),
        },
        expiresIn,
      );
      json(ctx.response, 200, {
        bucket: name,
        key: k,
        url,
        expiresAt: Date.now() + expiresIn * 1000,
      });
      return true;
    }
    if (action === 'save-template' || action === 'delete-template') {
      fields(
        ctx.input,
        action === 'save-template' ? ['expectedRevision', 'template'] : ['expectedRevision', 'id'],
      );
      const result = await this.queue.run(async () => {
        const next = this.current();
        if (ctx.input.expectedRevision !== next.revision)
          throw new HttpFailure(409, 'REVISION_CONFLICT');
        if (action === 'save-template') {
          const t = object(ctx.input.template);
          fields(t, ['id', 'name', 'bucket', 'objects']);
          bucket(t.bucket);
          next.templates = saveR2Template(
            next.templates,
            t as unknown as R2TemplateInput,
            new Date().toISOString(),
            randomUUID,
          );
        } else next.templates = deleteSavedTemplate(next.templates, identifier(ctx.input.id));
        await this.save(next);
        return { revision: next.revision, templates: next.templates };
      });
      json(ctx.response, 200, result);
      return true;
    }
    throw new HttpFailure(404, 'NOT_FOUND');
  }
  async drain(): Promise<void> {
    await this.queue.drain();
    if (this.port instanceof R2Gateway) this.port.close();
  }
}
