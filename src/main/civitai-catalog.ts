import { syncCivitaiCatalog } from '../application/civitai-catalog-sync.js';
import {
  numberValue,
  calculateStrengthBaseline,
  calculateObservedCheckpointReferences,
  extractGenerationExamples,
  calculateMembershipChanges,
} from '../domain/civitai-catalog-policy.js';
import {
  saveCatalogSelectionTemplate,
  deleteSavedTemplate,
} from '../domain/saved-template-policy.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { withTemplateStoreLock, writeJsonAtomic } from './fs-utils.js';
import type {
  CatalogSelectionTemplate,
  CatalogSelectionTemplateInput,
  CivitaiCatalogStatus,
  CivitaiGenerationExample,
  ModelCatalog,
  StrengthBaseline,
} from '../shared/types.js';
import { CivitaiClient, type CivitaiCollectionMeta } from './civitai-client.js';
import { CivitaiMetadataCache, type CachedCheckpointEvidence } from './civitai-cache.js';
import {
  getActiveCivitaiRequestState,
  resetActiveCivitaiRequestMetrics,
} from './civitai-request-policy.js';

const MODEL_CACHE_TTL_DEFAULT = 30 * 60;
const VERSION_CACHE_TTL_DEFAULT = 30 * 60;
const BASELINE_CACHE_TTL_DEFAULT = 7 * 24 * 60 * 60;
const CHECKPOINT_EVIDENCE_CACHE_TTL_DEFAULT = 7 * 24 * 60 * 60;
const PROMPT_EXAMPLES_CACHE_TTL_DEFAULT = 7 * 24 * 60 * 60;
const THUMBNAIL_CACHE_TTL_DEFAULT = 24 * 60 * 60;

type LocalSyncMetrics = {
  cacheHits: number;
  cacheMisses: number;
  collectionPages: number;
  membershipItems: number;
  elapsedMs: number;
};
export type CivitaiSyncMetrics = LocalSyncMetrics & {
  requests: number;
  retries: number;
  responses429: number;
  responses5xx: number;
  networkErrors: number;
  currentIntervalMs: number;
  requestsByEndpoint: Record<string, number>;
};

function ttlMs(name: string, fallbackSeconds: number) {
  const seconds = Number(process.env[name] ?? fallbackSeconds);
  return Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : fallbackSeconds * 1000);
}
function emptyLocalMetrics(): LocalSyncMetrics {
  return { cacheHits: 0, cacheMisses: 0, collectionPages: 0, membershipItems: 0, elapsedMs: 0 };
}
function emptyNetworkMetrics() {
  return {
    requests: 0,
    retries: 0,
    responses429: 0,
    responses5xx: 0,
    networkErrors: 0,
    currentIntervalMs: 0,
    requestsByEndpoint: {},
  };
}
export {
  calculateStrengthBaseline,
  calculateObservedCheckpointReferences,
  extractGenerationExamples,
  calculateMembershipChanges,
} from '../domain/civitai-catalog-policy.js';
async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}
class CivitaiError extends Error {
  constructor(
    message: string,
    readonly statusCode = 502,
  ) {
    super(message);
  }
}

export class CivitaiCatalogService {
  readonly catalogPath: string;
  readonly templatesPath: string;
  readonly cachePath: string;
  private readonly apiKey: string;
  private readonly client: CivitaiClient;
  private readonly cache: CivitaiMetadataCache;
  private readonly modelCacheTtlMs: number;
  private readonly versionCacheTtlMs: number;
  private readonly baselineCacheTtlMs: number;
  private readonly checkpointEvidenceCacheTtlMs: number;
  private readonly promptExamplesCacheTtlMs: number;
  private readonly thumbnailCacheTtlMs: number;
  private snapshot: ModelCatalog | null = null;
  private syncPromise: Promise<void> | null = null;
  private syncStartedAt = 0;
  private localMetrics: LocalSyncMetrics = emptyLocalMetrics();
  private statusValue: CivitaiCatalogStatus;

  constructor(storageRoot: string) {
    this.catalogPath = path.join(storageRoot, 'model_catalog.json');
    this.templatesPath = path.join(storageRoot, 'selection_templates.json');
    this.cachePath = path.join(storageRoot, 'sync_cache.json');
    this.apiKey = (process.env.CIVIT_API_KEY ?? '').trim();
    const baseUrl = (process.env.CIVITAI_BASE_URL ?? 'https://civitai.com').replace(/\/$/, '');
    const matureBaseUrl = (process.env.CIVITAI_MATURE_BASE_URL ?? 'https://civitai.red').replace(
      /\/$/,
      '',
    );
    const timeoutMs = Math.max(1000, Number(process.env.CIVITAI_TIMEOUT ?? 20) * 1000);
    const deadlineSeconds = Number(process.env.CIVITAI_REQUEST_DEADLINE_SECONDS ?? 120);
    const deadlineMs = Math.max(
      timeoutMs,
      Number.isFinite(deadlineSeconds) ? deadlineSeconds * 1000 : 120000,
    );
    this.client = new CivitaiClient({ apiKey: this.apiKey, baseUrl, matureBaseUrl, deadlineMs });
    this.cache = new CivitaiMetadataCache(this.cachePath);
    this.modelCacheTtlMs = ttlMs('CIVITAI_MODEL_CACHE_TTL_SECONDS', MODEL_CACHE_TTL_DEFAULT);
    this.versionCacheTtlMs = ttlMs('CIVITAI_VERSION_CACHE_TTL_SECONDS', VERSION_CACHE_TTL_DEFAULT);
    this.baselineCacheTtlMs = ttlMs(
      'CIVITAI_BASELINE_CACHE_TTL_SECONDS',
      BASELINE_CACHE_TTL_DEFAULT,
    );
    this.checkpointEvidenceCacheTtlMs = ttlMs(
      'CIVITAI_CHECKPOINT_EVIDENCE_CACHE_TTL_SECONDS',
      CHECKPOINT_EVIDENCE_CACHE_TTL_DEFAULT,
    );
    this.promptExamplesCacheTtlMs = ttlMs(
      'CIVITAI_PROMPT_EXAMPLES_CACHE_TTL_SECONDS',
      PROMPT_EXAMPLES_CACHE_TTL_DEFAULT,
    );
    this.thumbnailCacheTtlMs = ttlMs(
      'CIVITAI_THUMBNAIL_CACHE_TTL_SECONDS',
      THUMBNAIL_CACHE_TTL_DEFAULT,
    );
    this.statusValue = {
      state: 'idle',
      phase: '待機中',
      completed: 0,
      total: 0,
      message: '同期待ち',
      generation: 0,
      changes: { added: 0, updated: 0, removed: 0 },
      error: null,
      apiKeyConfigured: Boolean(this.apiKey),
      catalogPath: this.catalogPath,
    };
  }

  async initialize() {
    await this.cache.initialize();
    this.snapshot = await readJson<ModelCatalog>(this.catalogPath);
    if (this.snapshot?.schemaVersion === 1 && Array.isArray(this.snapshot.collections)) {
      this.statusValue = {
        ...this.statusValue,
        state: 'ready',
        phase: '完了',
        message: '保存済みカタログを使用できます',
        generation: this.snapshot.generation,
        total: this.snapshot.collections.length,
        completed: this.snapshot.collections.length,
      };
    } else this.snapshot = null;
  }

  private metrics(): CivitaiSyncMetrics {
    const network = getActiveCivitaiRequestState()?.metrics ?? emptyNetworkMetrics();
    const elapsedMs = this.syncStartedAt
      ? Math.max(this.localMetrics.elapsedMs, Date.now() - this.syncStartedAt)
      : this.localMetrics.elapsedMs;
    return { ...this.localMetrics, elapsedMs, ...network };
  }

  status() {
    return structuredClone({ ...this.statusValue, metrics: this.metrics() });
  }
  catalog() {
    return this.snapshot ? structuredClone(this.snapshot) : null;
  }

  async startSync() {
    if (this.syncPromise) return this.status();
    if (!this.apiKey) {
      this.statusValue = {
        ...this.statusValue,
        state: 'error',
        phase: '同期失敗',
        message: 'Civitai APIキーが必要です',
        error: '環境変数 CIVIT_API_KEY が設定されていません。',
      };
      return this.status();
    }
    resetActiveCivitaiRequestMetrics();
    this.localMetrics = emptyLocalMetrics();
    this.syncStartedAt = Date.now();
    this.statusValue = {
      ...this.statusValue,
      state: 'running',
      phase: '準備中',
      completed: 0,
      total: 1,
      message: 'Civitaiからコレクション一覧を取得しています',
      changes: { added: 0, updated: 0, removed: 0 },
      error: null,
    };
    this.syncPromise = this.sync().finally(() => {
      this.localMetrics.elapsedMs = Date.now() - this.syncStartedAt;
      this.syncStartedAt = 0;
      this.syncPromise = null;
    });
    return this.status();
  }

  async waitForSync() {
    await this.syncPromise;
  }
  private progress(phase: string, completed: number, total: number, message: string) {
    this.statusValue = {
      ...this.statusValue,
      state: 'running',
      phase,
      completed,
      total: Math.max(total, 1),
      message,
    };
  }
  private cacheResult<T>(lookup: { hit: true; value: T } | { hit: false }) {
    if (lookup.hit) {
      this.localMetrics.cacheHits += 1;
      return lookup.value;
    }
    this.localMetrics.cacheMisses += 1;
    return undefined;
  }

  private async modelDetail(modelId: number) {
    const cached = this.cacheResult(this.cache.model(modelId, this.modelCacheTtlMs));
    if (cached !== undefined) return cached as any;
    const value = await this.client.getModel(modelId);
    this.cache.setModel(modelId, value);
    return value;
  }

  private async versionDetail(versionId: number) {
    const cached = this.cacheResult(this.cache.version(versionId, this.versionCacheTtlMs));
    if (cached !== undefined) return cached as any;
    const value = await this.client.getModelVersion(versionId);
    this.cache.setVersion(versionId, value);
    return value;
  }

  private async loraUsage(versionId: number) {
    const baselineLookup = this.cache.baseline(versionId, this.baselineCacheTtlMs);
    const checkpointLookup = this.cache.checkpointEvidence(
      versionId,
      this.checkpointEvidenceCacheTtlMs,
    );
    const examplesLookup = this.cache.generationExamples(versionId, this.promptExamplesCacheTtlMs);
    if (examplesLookup.hit) this.localMetrics.cacheHits += 1;
    else this.localMetrics.cacheMisses += 1;
    if (baselineLookup.hit) this.localMetrics.cacheHits += 1;
    else this.localMetrics.cacheMisses += 1;
    if (checkpointLookup.hit) this.localMetrics.cacheHits += 1;
    else this.localMetrics.cacheMisses += 1;
    if (baselineLookup.hit && checkpointLookup.hit && examplesLookup.hit)
      return {
        baseline: baselineLookup.value,
        checkpointEvidence: checkpointLookup.value,
        generationExamples: examplesLookup.value,
      };
    try {
      const payload = await this.client.getImages({
        modelVersionId: versionId,
        withMeta: 'true',
        sort: 'Newest',
        limit: 200,
      });
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const baseline = calculateStrengthBaseline(items, versionId);
      const checkpointEvidence = calculateObservedCheckpointReferences(items);
      const generationExamples = extractGenerationExamples(items, versionId);
      this.cache.setGenerationExamples(versionId, generationExamples);
      this.cache.setBaseline(versionId, baseline);
      this.cache.setCheckpointEvidence(versionId, checkpointEvidence);
      return { baseline, checkpointEvidence, generationExamples };
    } catch {
      return {
        baseline: baselineLookup.hit ? baselineLookup.value : null,
        checkpointEvidence: checkpointLookup.hit ? checkpointLookup.value : [],
        generationExamples: examplesLookup.hit ? examplesLookup.value : [],
      };
    }
  }

  private async collectionThumbnail(collectionId: number, imageId: number | null) {
    const lookup = this.cache.thumbnail(collectionId, imageId, this.thumbnailCacheTtlMs);
    if (lookup.hit) {
      this.localMetrics.cacheHits += 1;
      return lookup.value ?? undefined;
    }
    this.localMetrics.cacheMisses += 1;
    if (imageId == null) {
      this.cache.setThumbnail(collectionId, null, null);
      return undefined;
    }
    try {
      const value = await this.client.getImageUrl(imageId);
      this.cache.setThumbnail(collectionId, imageId, value);
      return value ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async sync() {
    try {
      const { snapshot, changes } = await syncCivitaiCatalog({
        client: this.client,
        localMetrics: this.localMetrics,
        progress: (...args) => this.progress(...args),
        modelDetail: (id) => this.modelDetail(id),
        versionDetail: (id) => this.versionDetail(id),
        loraUsage: (id) => this.loraUsage(id),
        collectionThumbnail: (id, image) => this.collectionThumbnail(id, image),
        previous: async () => this.snapshot,
        publish: async (snapshot) => {
          await writeJsonAtomic(this.catalogPath, snapshot);
          this.snapshot = snapshot;
        },
        now: () => new Date().toISOString(),
        pruneCache: async (...args) => {
          this.cache.prune(...args);
          try {
            await this.cache.save();
          } catch (error) {
            console.warn('Civitai metadata cache could not be saved:', error);
          }
        },
      });
      this.statusValue = {
        ...this.statusValue,
        state: 'ready',
        phase: '完了',
        completed: snapshot.collections.length,
        total: snapshot.collections.length,
        message: 'モデルカタログを更新しました',
        generation: snapshot.generation,
        changes,
        error: null,
      };
    } catch (error) {
      const normalized =
        error instanceof CivitaiError
          ? error
          : error instanceof Error
            ? error
            : new Error(String(error));
      this.statusValue = {
        ...this.statusValue,
        state: 'error',
        phase: '同期失敗',
        message: 'モデルカタログを更新できませんでした',
        error: normalized.message,
      };
    }
  }

  async templates() {
    return (await readJson<CatalogSelectionTemplate[]>(this.templatesPath)) ?? [];
  }
  async saveTemplate(input: CatalogSelectionTemplateInput) {
    return withTemplateStoreLock(this.templatesPath, async () => {
      const next = saveCatalogSelectionTemplate(
        await this.templates(),
        input,
        new Date().toISOString(),
        () => 'template-' + randomUUID(),
      );
      await writeJsonAtomic(this.templatesPath, next);
      return next;
    });
  }
  async deleteTemplate(id: string) {
    return withTemplateStoreLock(this.templatesPath, async () => {
      const next = deleteSavedTemplate(await this.templates(), id);
      await writeJsonAtomic(this.templatesPath, next);
      return next;
    });
  }
}
