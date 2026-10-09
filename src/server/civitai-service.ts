import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { syncCivitaiCatalog } from '../application/civitai-catalog-sync.js';
import type { CatalogRepository } from '../application/project-ports.js';
import type { ModelCatalog } from '../domain/artifact-types.js';
import {
  calculateObservedCheckpointReferences,
  calculateStrengthBaseline,
  extractGenerationExamples,
} from '../domain/civitai-catalog-policy.js';
import type { ActorContext } from '../domain/contracts.js';
import { authorize } from '../domain/contracts.js';
import { WebCivitaiClient } from './civitai-client.js';
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
import type { JobDefinition, JobRegistry } from './jobs.js';
import { atomicJson, SerialQueue } from './storage.js';

type CacheRow = { key: string; expiresAt: number; value: unknown };
type Store = {
  schema: 'web-civitai/1';
  providerRevision: number;
  sourceFingerprint: string;
  generation: number;
  catalog: ModelCatalog | null;
  cache: CacheRow[];
};
function catalog(raw: unknown): ModelCatalog | null {
  if (raw === null) return null;
  const value = object(raw);
  fields(value, ['schemaVersion', 'generation', 'generatedAt', 'collections']);
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    typeof value.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.generatedAt)) ||
    !Array.isArray(value.collections) ||
    value.collections.length > 1000
  )
    throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
  for (const rawCollection of value.collections) {
    const collection = object(rawCollection);
    if (
      !Number.isSafeInteger(collection.id) ||
      typeof collection.name !== 'string' ||
      !Array.isArray(collection.items)
    )
      throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
    for (const rawItem of collection.items) {
      const item = object(rawItem);
      if (
        !Number.isSafeInteger(item.modelId) ||
        !Number.isSafeInteger(item.versionId) ||
        !Array.isArray(item.versions)
      )
        throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
    }
  }
  return value as unknown as ModelCatalog;
}
export class CivitaiService implements CatalogRepository {
  private readonly queue = new SerialQueue();
  private value: Store | undefined;
  private readonly file: string;
  private syncing = false;
  private fault = false;
  readonly definition: JobDefinition;
  constructor(
    dataDir: string,
    private readonly settings: IntegrationSettings,
    private readonly jobs: JobRegistry,
    private readonly grant: (actor: ActorContext) => Promise<ActorContext>,
    private readonly request: typeof fetch = fetch,
  ) {
    this.file = path.join(dataDir, 'civitai.json');
    this.definition = {
      globalExclusive: true,
      validate(input) {
        fields(input, ['providerRevision', 'sourceFingerprint']);
        if (
          typeof input.sourceFingerprint !== 'string' ||
          !/^[a-f0-9]{64}$/.test(input.sourceFingerprint)
        )
          throw new HttpFailure(400, 'INVALID_INPUT');
        if (!Number.isSafeInteger(input.providerRevision) || Number(input.providerRevision) < 1)
          throw new HttpFailure(400, 'INVALID_INPUT');
      },
      reserve: async () => {
        if (this.syncing || this.fault) throw new HttpFailure(409, 'CIVITAI_BUSY');
        this.syncing = true;
        return {
          release: async () => {
            this.syncing = false;
          },
        };
      },
      run: async ({ actor, job, input, signal, progress }) => {
        try {
          const currentActor = await this.grant(actor);
          if (!currentActor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
          authorize(currentActor, job.projectId, 'execute');
          const config = this.settings.resolve('civitai');
          if (
            config.revision !== input.providerRevision ||
            config.fingerprint !== input.sourceFingerprint
          )
            throw new HttpFailure(409, 'TARGET_CHANGED');
          const client = new WebCivitaiClient(config.secrets.apiKey, signal, this.request);
          let done = 0;
          const metric = { collectionPages: 0, membershipItems: 0 };
          const cached = <T>(key: string, load: () => Promise<T>): Promise<T> =>
            this.cached(config.revision, config.fingerprint, key, signal, load);
          const result = await syncCivitaiCatalog({
            client,
            localMetrics: metric,
            progress: () => {
              done++;
            },
            modelDetail: (id) => cached('model:' + id, () => client.getModel(id)),
            versionDetail: (id) => cached('version:' + id, () => client.getModelVersion(id)),
            loraUsage: (id) =>
              cached('usage:' + id, async () => {
                const images = await client.getImages(id);
                return {
                  baseline: calculateStrengthBaseline(images, id),
                  checkpointEvidence: calculateObservedCheckpointReferences(images),
                  generationExamples: extractGenerationExamples(images, id),
                };
              }),
            collectionThumbnail: async (_id, imageId) =>
              imageId === null
                ? undefined
                : ((await cached('image:' + imageId, () => client.getImageUrl(imageId))) ??
                  undefined),
            previous: () => this.currentCatalog(config.revision, config.fingerprint),
            now: () => new Date().toISOString(),
            publish: async (snapshot) => {
              const granted = await this.grant(actor);
              if (!granted.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
              authorize(granted, job.projectId, 'execute');
              await this.queue.run(async () => {
                signal.throwIfAborted();
                if (this.settings.resolve('civitai').fingerprint !== config.fingerprint)
                  throw new HttpFailure(409, 'TARGET_CHANGED');
                const next = this.currentStore(config.revision, config.fingerprint);
                next.generation++;
                next.catalog = catalog({ ...snapshot, generation: next.generation });
                await this.save(next);
              });
            },
            pruneCache: async () => {
              await this.queue.run(async () => {
                signal.throwIfAborted();
                if (this.settings.resolve('civitai').fingerprint !== config.fingerprint)
                  throw new HttpFailure(409, 'TARGET_CHANGED');
                const next = this.currentStore(config.revision, config.fingerprint);
                next.cache = next.cache.filter((row) => row.expiresAt > Date.now());
                await this.save(next);
              });
            },
          });
          if (!result.snapshot || !done) throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
          await progress(1);
          return { state: 'succeeded' };
        } catch {
          return { state: signal.aborted ? 'cancelled' : 'failed' };
        }
      },
      // Catalog/cache effects are local; no external mutation can be replayed here.
      reconcile: async () => ({ state: 'failed' }),
    };
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
        'providerRevision',
        'sourceFingerprint',
        'generation',
        'catalog',
        'cache',
      ]);
      if (
        typeof raw.sourceFingerprint !== 'string' ||
        !/^[a-f0-9]{64}$/.test(raw.sourceFingerprint) ||
        !Number.isSafeInteger(raw.generation) ||
        Number(raw.generation) < 0
      )
        throw new Error('Invalid source binding');
      if (
        raw.schema !== 'web-civitai/1' ||
        !Number.isSafeInteger(raw.providerRevision) ||
        Number(raw.providerRevision) < 1 ||
        !Array.isArray(raw.cache) ||
        raw.cache.length > 10000
      )
        throw new Error('Invalid store');
      const seen = new Set<string>();
      const cache = raw.cache.map((entry): CacheRow => {
        const row = object(entry);
        fields(row, ['key', 'expiresAt', 'value']);
        if (
          typeof row.key !== 'string' ||
          !/^(model|version|usage|image):[1-9][0-9]*$/.test(row.key) ||
          seen.has(row.key) ||
          !Number.isSafeInteger(row.expiresAt) ||
          Number(row.expiresAt) < 0 ||
          row.value === undefined
        )
          throw new Error('Invalid cache');
        seen.add(row.key);
        return row as CacheRow;
      });
      this.value = {
        schema: 'web-civitai/1',
        providerRevision: Number(raw.providerRevision),
        sourceFingerprint: raw.sourceFingerprint,
        generation: Number(raw.generation),
        catalog: catalog(raw.catalog),
        cache,
      };
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
    }
  }
  private currentStore(revision: number, fingerprint: string): Store {
    return this.value?.providerRevision === revision && this.value.sourceFingerprint === fingerprint
      ? structuredClone(this.value)
      : {
          schema: 'web-civitai/1',
          providerRevision: revision,
          sourceFingerprint: fingerprint,
          generation: this.value?.generation ?? 0,
          catalog: null,
          cache: [],
        };
  }
  private async save(next: Store): Promise<void> {
    if (
      this.fault ||
      next.cache.length > 10000 ||
      Buffer.byteLength(JSON.stringify(next)) > 32 * 1024 * 1024
    )
      throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
    try {
      await atomicJson(this.file, next);
      this.value = next;
    } catch {
      this.fault = true;
      throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
    }
  }
  private async cached<T>(
    revision: number,
    fingerprint: string,
    key: string,
    signal: AbortSignal,
    load: () => Promise<T>,
  ): Promise<T> {
    signal.throwIfAborted();
    if (this.fault) throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
    const row =
      this.value?.providerRevision === revision && this.value.sourceFingerprint === fingerprint
        ? this.value.cache.find((r) => r.key === key && r.expiresAt > Date.now())
        : undefined;
    if (row) return structuredClone(row.value) as T;
    const value = await load();
    await this.queue.run(async () => {
      signal.throwIfAborted();
      if (this.settings.resolve('civitai').fingerprint !== fingerprint)
        throw new HttpFailure(409, 'TARGET_CHANGED');
      const next = this.currentStore(revision, fingerprint);
      next.cache = next.cache.filter((r) => r.key !== key && r.expiresAt > Date.now());
      next.cache.push({ key, expiresAt: Date.now() + 30 * 60_000, value });
      await this.save(next);
    });
    return value;
  }
  private async currentCatalog(
    revision: number,
    fingerprint: string,
  ): Promise<ModelCatalog | null> {
    if (this.fault) throw new HttpFailure(503, 'CIVITAI_STORE_UNAVAILABLE');
    return this.value?.providerRevision === revision && this.value.sourceFingerprint === fingerprint
      ? structuredClone(this.value.catalog)
      : null;
  }
  async read(_projectId: string): Promise<ModelCatalog | null> {
    const state = this.settings.providerState('civitai');
    if (state === 'unconfigured' || state === 'disabled') return null;
    const config = this.settings.resolve('civitai');
    return this.currentCatalog(config.revision, config.fingerprint);
  }
  async route(ctx: RequestContext): Promise<boolean> {
    if (!ctx.url.pathname.startsWith('/api/v1/integrations/civitai/')) return false;
    if (!ctx.actor.permissions.includes('read')) throw new HttpFailure(403, 'FORBIDDEN');
    const action = ctx.url.pathname.slice('/api/v1/integrations/civitai/'.length);
    if (ctx.request.method === 'GET' && action === 'status') {
      const config = this.settings
        .status(ctx.actor)
        .providers.find((p) => p.provider === 'civitai')!;
      json(ctx.response, 200, {
        state: config.state,
        canManage: ctx.actor.permissions.includes('admin'),
        revision: config.revision,
        syncing: this.syncing,
        jobs: this.jobs.list(ctx.actor).filter((job) => job.kind === 'civitai-sync'),
      });
      return true;
    }
    if (ctx.request.method === 'GET' && action === 'search') {
      if (
        [...ctx.url.searchParams.keys()].some((key) => key !== 'query') ||
        ctx.url.searchParams.getAll('query').length !== 1
      )
        throw new HttpFailure(400, 'INVALID_INPUT');
      const query = ctx.url.searchParams.get('query')!;
      if (query.length > 200) throw new HttpFailure(400, 'INVALID_INPUT');
      const current = await this.read('global');
      if (!current) throw new HttpFailure(503, 'DEPENDENCY_UNAVAILABLE');
      const items = current.collections
        .flatMap((collection) =>
          collection.items
            .filter((item) =>
              (item.modelName + ' ' + item.versionName)
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((item) => ({ collectionId: collection.id, ...item })),
        )
        .slice(0, 1000);
      json(ctx.response, 200, { generation: current.generation, items });
      return true;
    }
    if (ctx.request.method === 'GET' && action === 'collections') {
      const config = this.settings.resolve('civitai');
      const signal = AbortSignal.timeout(30_000);
      const collections = await new WebCivitaiClient(
        config.secrets.apiKey,
        signal,
        this.request,
      ).getCollections();
      if (this.settings.resolve('civitai').fingerprint !== config.fingerprint)
        throw new HttpFailure(409, 'TARGET_CHANGED');
      json(ctx.response, 200, { collections });
      return true;
    }
    if (ctx.request.method === 'GET' && /^versions\/[1-9][0-9]*$/.test(action)) {
      const config = this.settings.resolve('civitai');
      const signal = AbortSignal.timeout(30_000);
      const value = object(
        await this.cached(
          config.revision,
          config.fingerprint,
          'version:' + action.slice(9),
          signal,
          () =>
            new WebCivitaiClient(config.secrets.apiKey, signal, this.request).getModelVersion(
              Number(action.slice(9)),
            ),
        ),
      );
      json(ctx.response, 200, {
        version: {
          id: value.id,
          modelId: value.modelId,
          name: value.name,
          baseModel: value.baseModel,
          trainedWords: value.trainedWords,
        },
      });
      return true;
    }
    if (ctx.request.method === 'GET' && action === 'catalog') {
      json(ctx.response, 200, { catalog: await this.read('global') });
      return true;
    }
    if (ctx.request.method === 'POST' && action === 'sync') {
      if (!ctx.actor.permissions.includes('admin')) throw new HttpFailure(403, 'FORBIDDEN');
      fields(ctx.input, ['projectId']);
      const projectId = identifier(ctx.input.projectId);
      authorize(ctx.actor, projectId, 'execute');
      const config = this.settings.resolve('civitai');
      const job = await this.jobs.submit(
        ctx.actor,
        projectId,
        'civitai-sync',
        identifier(ctx.request.headers['idempotency-key']),
        { providerRevision: config.revision, sourceFingerprint: config.fingerprint },
        {
          stage: 'catalog',
          provider: 'civitai',
          turnId: createHash('sha256')
            .update(projectId + ':' + identifier(ctx.request.headers['idempotency-key']))
            .digest('hex'),
        },
      );
      json(ctx.response, 202, { job });
      return true;
    }
    if (ctx.request.method === 'GET' && /^models\/[1-9][0-9]*$/.test(action)) {
      const config = this.settings.resolve('civitai');
      const signal = AbortSignal.timeout(30_000);
      const value = await this.cached(
        config.revision,
        config.fingerprint,
        'model:' + action.slice(7),
        signal,
        () =>
          new WebCivitaiClient(config.secrets.apiKey, signal, this.request).getModel(
            Number(action.slice(7)),
          ),
      );
      const row = object(value);
      json(ctx.response, 200, {
        model: {
          id: row.id,
          name: row.name,
          type: row.type,
          versions: (row.modelVersions as JsonObject[]).map((version) => ({
            id: version.id,
            name: version.name,
            baseModel: version.baseModel,
            trainedWords: version.trainedWords,
          })),
        },
      });
      return true;
    }
    throw new HttpFailure(404, 'NOT_FOUND');
  }
  async drain(): Promise<void> {
    await this.queue.drain();
  }
}
