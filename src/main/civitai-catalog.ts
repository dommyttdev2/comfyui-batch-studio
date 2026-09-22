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

const METHOD = 'median-of-post-medians:newest-200';
const MIN_DISTINCT_POSTS = 5;
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

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
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
function collectionImageId(meta: CivitaiCollectionMeta, items: any[]) {
  if (meta.imageId != null && Number.isFinite(meta.imageId)) return meta.imageId;
  const found = items.find((x) => x?.data?.images?.[0]?.id != null);
  const id = Number(found?.data?.images?.[0]?.id);
  return Number.isFinite(id) ? id : null;
}

export function calculateStrengthBaseline(
  items: unknown[],
  versionId: number,
): StrengthBaseline | null {
  const byPost = new Map<string, number[]>();
  for (const image of items) {
    if (!image || typeof image !== 'object') continue;
    const row = image as Record<string, unknown>;
    if (row.postId == null || !row.meta || typeof row.meta !== 'object') continue;
    const resources = (row.meta as Record<string, unknown>).civitaiResources;
    if (!Array.isArray(resources)) continue;
    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') continue;
      const r = resource as Record<string, unknown>;
      if (String(r.type ?? '').toLowerCase() !== 'lora' || Number(r.modelVersionId) !== versionId)
        continue;
      const weight = numberValue(r.weight);
      if (weight == null) continue;
      const key = String(row.postId),
        values = byPost.get(key) ?? [];
      values.push(weight);
      byPost.set(key, values);
    }
  }
  if (byPost.size < MIN_DISTINCT_POSTS) return null;
  const perPost = [...byPost.values()].filter((x) => x.length).map(median);
  if (perPost.length < MIN_DISTINCT_POSTS) return null;
  return {
    value: median(perPost),
    provenance: {
      source: 'civitai',
      basis: 'observed-usage-derived',
      method: METHOD,
      sampleCount: perPost.length,
    },
  };
}

export function calculateObservedCheckpointReferences(
  items: unknown[],
): CachedCheckpointEvidence[] {
  const byVersion = new Map<number, { imageCount: number; evidenceImageIds: Set<number> }>();
  for (const image of items) {
    if (!image || typeof image !== 'object') continue;
    const row = image as Record<string, unknown>;
    if (!row.meta || typeof row.meta !== 'object') continue;
    const resources = (row.meta as Record<string, unknown>).civitaiResources;
    if (!Array.isArray(resources)) continue;
    const seenInImage = new Set<number>();
    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') continue;
      const r = resource as Record<string, unknown>;
      if (String(r.type ?? '').toLowerCase() !== 'checkpoint') continue;
      const modelVersionId = Number(r.modelVersionId);
      if (
        !Number.isInteger(modelVersionId) ||
        modelVersionId <= 0 ||
        seenInImage.has(modelVersionId)
      )
        continue;
      seenInImage.add(modelVersionId);
      const found = byVersion.get(modelVersionId) ?? {
        imageCount: 0,
        evidenceImageIds: new Set<number>(),
      };
      found.imageCount += 1;
      const imageId = Number(row.id);
      if (Number.isInteger(imageId) && imageId > 0) found.evidenceImageIds.add(imageId);
      byVersion.set(modelVersionId, found);
    }
  }
  return [...byVersion.entries()]
    .map(([modelVersionId, value]) => ({
      modelVersionId,
      imageCount: value.imageCount,
      evidenceImageIds: [...value.evidenceImageIds].sort((a, b) => a - b),
    }))
    .sort((a, b) => b.imageCount - a.imageCount || a.modelVersionId - b.modelVersionId);
}

/**
 * Keep the original prompt text from Civitai's disclosed image metadata. Image
 * records without either prompt are not useful as prompt examples. Missing
 * positive/negative fields remain null rather than being invented.
 */
export function extractGenerationExamples(
  items: unknown[],
  versionId: number,
): CivitaiGenerationExample[] {
  const examples: CivitaiGenerationExample[] = [];
  const seenImageIds = new Set<number>();
  for (const image of items) {
    if (!image || typeof image !== 'object') continue;
    const row = image as Record<string, unknown>;
    const imageId = Number(row.id);
    if (!Number.isSafeInteger(imageId) || imageId <= 0 || seenImageIds.has(imageId)) continue;
    if (typeof row.type === 'string' && row.type.toLowerCase() !== 'image') continue;
    if (!row.meta || typeof row.meta !== 'object' || Array.isArray(row.meta)) continue;
    const meta = row.meta as Record<string, unknown>;
    const promptText = (...values: unknown[]) =>
      values.find((value): value is string => typeof value === 'string' && value.trim().length > 0) ??
      null;
    const positivePrompt = promptText(meta.prompt, meta.positivePrompt, meta.positive_prompt);
    const negativePrompt = promptText(meta.negativePrompt, meta.negative_prompt);
    if (positivePrompt === null && negativePrompt === null) continue;

    const resources = Array.isArray(meta.civitaiResources) ? meta.civitaiResources : [];
    const checkpoints = new Set<number>();
    let loraStrength: number | undefined;
    for (const resource of resources) {
      if (!resource || typeof resource !== 'object') continue;
      const r = resource as Record<string, unknown>;
      const id = Number(r.modelVersionId);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const type = String(r.type ?? '').toLowerCase();
      if (type === 'checkpoint') checkpoints.add(id);
      if (type === 'lora' && id === versionId && loraStrength === undefined)
        loraStrength = numberValue(r.weight) ?? undefined;
    }

    const postId = Number(row.postId);
    examples.push({
      imageId,
      ...(Number.isSafeInteger(postId) && postId > 0 ? { postId } : {}),
      positivePrompt,
      negativePrompt,
      ...(loraStrength !== undefined ? { loraStrength } : {}),
      checkpointVersionIds: [...checkpoints].sort((a, b) => a - b),
    });
    seenImageIds.add(imageId);
  }
  return examples;
}

function membershipMap(catalog: ModelCatalog | null) {
  const result = new Map<string, number>();
  for (const collection of catalog?.collections ?? [])
    for (const item of collection.items)
      result.set(`${collection.id}:${item.modelId}`, Number(item.versionId));
  return result;
}

export function calculateMembershipChanges(previous: ModelCatalog | null, current: ModelCatalog) {
  const before = membershipMap(previous),
    after = membershipMap(current);
  let added = 0,
    updated = 0,
    removed = 0;
  for (const [key, versionId] of after) {
    if (!before.has(key)) added += 1;
    else if (before.get(key) !== versionId) updated += 1;
  }
  for (const key of before.keys()) if (!after.has(key)) removed += 1;
  return { added, updated, removed };
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return null;
  }
}
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      result[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, worker));
  return result;
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
      const collections = await this.client.getCollections();
      const collectionIds = collections.map((x) => x.id);
      this.progress(
        'コレクション確認中',
        0,
        collectionIds.length || 1,
        'コレクション所属情報を全件確認しています',
      );
      let collectionCompleted = 0;
      const itemResults = await mapLimit(collectionIds, 4, async (id) => {
        const result = await this.client.getCollectionItems(id);
        this.localMetrics.collectionPages += result.pages;
        collectionCompleted += 1;
        this.progress(
          'コレクション確認中',
          collectionCompleted,
          collectionIds.length,
          `コレクション ${collectionCompleted}/${collectionIds.length} を確認中`,
        );
        return result.items;
      });

      const rows: Array<{ collectionId: number; item: any }> = [];
      collectionIds.forEach((id, index) => {
        for (const item of itemResults[index]) {
          const data = item?.data,
            version = data?.version;
          if (item?.type === 'model' && data?.id && version?.id)
            rows.push({ collectionId: id, item });
        }
      });
      this.localMetrics.membershipItems = rows.length;

      const modelIds = [...new Set(rows.map((x) => Number(x.item.data.id)))];
      const models = new Map<number, any>();
      this.progress(
        'モデル収集中',
        0,
        modelIds.length || 1,
        'モデル詳細をキャッシュと照合しています',
      );
      let modelCompleted = 0;
      await mapLimit(modelIds, 4, async (id) => {
        models.set(id, await this.modelDetail(id));
        modelCompleted += 1;
        this.progress(
          'モデル収集中',
          modelCompleted,
          modelIds.length,
          `モデル ${modelCompleted}/${modelIds.length} を確認中`,
        );
      });

      const fallbackIds = [
        ...new Set(
          rows
            .filter((x) => {
              const data = x.item.data,
                id = Number(data.version.id),
                versions = models.get(Number(data.id))?.modelVersions;
              return !Array.isArray(versions) || !versions.some((v: any) => Number(v?.id) === id);
            })
            .map((x) => Number(x.item.data.version.id)),
        ),
      ];
      const fallback = new Map<number, any>();
      await mapLimit(fallbackIds, 4, async (id) => {
        try {
          fallback.set(id, await this.versionDetail(id));
        } catch {}
      });

      const exportVersion = (modelId: number, detail: any, fallbackName = '名称未設定') => {
        const id = Number(detail?.id),
          trained = Array.isArray(detail?.trainedWords) ? detail.trainedWords.map(String) : [];
        const files = (Array.isArray(detail?.files) ? detail.files : []).map((f: any) => ({
          id: Number(f.id),
          name: String(f.name ?? '名称未設定'),
          primary: Boolean(f.primary),
          sizeKB: numberValue(f.sizeKB) ?? undefined,
          type: typeof f.type === 'string' ? f.type : undefined,
          componentType:
            typeof f.metadata?.component === 'string'
              ? f.metadata.component
              : typeof f.metadata?.componentType === 'string'
                ? f.metadata.componentType
                : undefined,
          format: f.metadata?.format ?? undefined,
          precision: f.metadata?.fp ?? undefined,
        }));
        const images = Array.isArray(detail?.images) ? detail.images : [];
        const image =
          images.find(
            (x: any) =>
              x?.url &&
              String(x.type ?? '').toLowerCase() !== 'video' &&
              !/\.(mp4|webm|mov)(?:$|[?#])/i.test(String(x.url)),
          ) ?? {};
        let thumbnailUrl = typeof image.url === 'string' ? image.url : undefined;
        if (thumbnailUrl && /^https:\/\/(image|imagecache)\.civitai\.com\//.test(thumbnailUrl))
          thumbnailUrl = thumbnailUrl.replace(/\/(?:original=true|width=\d+)\//, '/width=450/');
        return {
          versionId: id,
          versionName: String(detail?.name ?? fallbackName),
          baseModel: typeof detail?.baseModel === 'string' ? detail.baseModel : undefined,
          modelUrl: `https://civitai.com/models/${modelId}?modelVersionId=${id}`,
          thumbnailUrl,
          thumbnailWidth: numberValue(image.width) ?? undefined,
          thumbnailHeight: numberValue(image.height) ?? undefined,
          trainedWords: trained,
          files,
        };
      };

      const byCollection = new Map<number, any[]>();
      for (const id of collectionIds) byCollection.set(id, []);
      for (const { collectionId, item } of rows) {
        const data = item.data,
          modelId = Number(data.id),
          selectedId = Number(data.version.id),
          modelDetail = models.get(modelId) ?? {},
          rawVersions = Array.isArray(modelDetail.modelVersions) ? modelDetail.modelVersions : [];
        const versions = rawVersions
          .filter((v: any) => v?.id != null)
          .map((v: any) => exportVersion(modelId, v));
        let selected = versions.find((v: any) => v.versionId === selectedId);
        if (!selected) {
          const detail = {
            ...(fallback.get(selectedId) ?? {}),
            id: selectedId,
            name: fallback.get(selectedId)?.name ?? data.version.name,
            baseModel: fallback.get(selectedId)?.baseModel ?? data.version.baseModel,
            trainedWords: fallback.get(selectedId)?.trainedWords ?? data.version.trainedWords ?? [],
            files: fallback.get(selectedId)?.files ?? data.version.files ?? [],
            images: fallback.get(selectedId)?.images ?? data.version.images ?? [],
          };
          selected = exportVersion(modelId, detail, String(data.version.name ?? '名称未設定'));
          versions.unshift(selected);
        }
        byCollection.get(collectionId)!.push({
          modelId,
          modelName: String(data.name ?? modelDetail.name ?? '名称未設定'),
          modelType: String(modelDetail.type ?? data.type ?? data.modelType ?? ''),
          ...selected,
          versions,
        });
      }

      const loraVersionIds = [
        ...new Set(
          [...byCollection.values()].flatMap((items) =>
            items
              .filter((item) =>
                ['lora', 'locon', 'dora'].includes(String(item.modelType).toLowerCase()),
              )
              .flatMap((item) =>
                (Array.isArray(item.versions) ? item.versions : [item])
                  .map((version: any) => Number(version.versionId))
                  .filter((id: number) => Number.isInteger(id) && id > 0),
              ),
          ),
        ),
      ];
      const usageByVersion = new Map<
        number,
        {
          baseline: StrengthBaseline | null;
          checkpointEvidence: CachedCheckpointEvidence[];
          generationExamples: CivitaiGenerationExample[];
        }
      >();
      this.progress(
        'LoRA利用実績確認中',
        0,
        loraVersionIds.length || 1,
        'LoRA Versionの作例から強度と使用Checkpointを確認しています',
      );
      let usageCompleted = 0;
      await mapLimit(loraVersionIds, 4, async (id) => {
        usageByVersion.set(id, await this.loraUsage(id));
        usageCompleted += 1;
        this.progress(
          'LoRA利用実績確認中',
          usageCompleted,
          loraVersionIds.length,
          `LoRA利用実績 ${usageCompleted}/${loraVersionIds.length} を確認中`,
        );
      });

      const checkpointVersionIds = [
        ...new Set(
          [...usageByVersion.values()].flatMap((usage) =>
            usage.checkpointEvidence.map((evidence) => evidence.modelVersionId),
          ),
        ),
      ];
      const checkpointDetails = new Map<number, any>();
      this.progress(
        'LoRA基盤Checkpoint解決中',
        0,
        checkpointVersionIds.length || 1,
        '作例で確認したCheckpointのCivitai identityを解決しています',
      );
      let checkpointCompleted = 0;
      await mapLimit(checkpointVersionIds, 4, async (id) => {
        try {
          checkpointDetails.set(id, await this.versionDetail(id));
        } catch {
          checkpointDetails.set(id, null);
        }
        checkpointCompleted += 1;
        this.progress(
          'LoRA基盤Checkpoint解決中',
          checkpointCompleted,
          checkpointVersionIds.length,
          `Checkpoint ${checkpointCompleted}/${checkpointVersionIds.length} を解決中`,
        );
      });

      const resolvedCheckpointEvidence = (versionId: number) => {
        const usage = usageByVersion.get(versionId);
        return (usage?.checkpointEvidence ?? []).map((evidence) => {
          const detail = checkpointDetails.get(evidence.modelVersionId),
            modelId = Number(detail?.modelId);
          return {
            modelVersionId: evidence.modelVersionId,
            ...(Number.isInteger(modelId) && modelId > 0 ? { modelId } : {}),
            ...(typeof detail?.model?.name === 'string' ? { modelName: detail.model.name } : {}),
            ...(typeof detail?.name === 'string' ? { versionName: detail.name } : {}),
            ...(typeof detail?.baseModel === 'string' ? { baseModel: detail.baseModel } : {}),
            ...(Number.isInteger(modelId) && modelId > 0
              ? {
                  modelUrl: `https://civitai.com/models/${modelId}?modelVersionId=${evidence.modelVersionId}`,
                }
              : {}),
            imageCount: evidence.imageCount,
            evidenceImageIds: evidence.evidenceImageIds,
          };
        });
      };

      for (const items of byCollection.values())
        for (const item of items) {
          if (!['lora', 'locon', 'dora'].includes(String(item.modelType).toLowerCase())) continue;
          for (const version of item.versions ?? []) {
            const versionId = Number(version.versionId),
              usage = usageByVersion.get(versionId);
            version.observedCheckpoints = resolvedCheckpointEvidence(versionId);
            version.generationExamples = usage?.generationExamples ?? [];
            if (usage?.baseline) version.strengthBaseline = usage.baseline;
          }
          const selected = item.versions.find(
            (version: any) => Number(version.versionId) === Number(item.versionId),
          );
          if (!selected) continue;
          item.observedCheckpoints = selected.observedCheckpoints ?? [];
          if (selected.strengthBaseline) item.strengthBaseline = selected.strengthBaseline;
        }

      const metaById = new Map(collections.map((x) => [x.id, x]));
      const enriched: any[] = [];
      let thumbnailCompleted = 0;
      this.progress(
        'サムネイル確認中',
        0,
        collectionIds.length || 1,
        'コレクションサムネイルをキャッシュと照合しています',
      );
      const thumbnails = await mapLimit(collectionIds, 3, async (id, index) => {
        const imageId = collectionImageId(metaById.get(id)!, itemResults[index]);
        const url = await this.collectionThumbnail(id, imageId);
        thumbnailCompleted += 1;
        this.progress(
          'サムネイル確認中',
          thumbnailCompleted,
          collectionIds.length,
          `サムネイル ${thumbnailCompleted}/${collectionIds.length} を確認中`,
        );
        return url;
      });
      for (let i = 0; i < collectionIds.length; i++) {
        const id = collectionIds[i],
          meta = metaById.get(id)!;
        enriched.push({
          id,
          name: meta.name,
          description: meta.description,
          read: meta.read,
          type: meta.type,
          imageId: meta.imageId,
          thumbnailUrl: thumbnails[i],
          items: byCollection.get(id) ?? [],
        });
      }

      const previous = this.snapshot;
      const snapshot: ModelCatalog = {
        schemaVersion: 1,
        generation: (previous?.generation ?? 0) + 1,
        generatedAt: new Date().toISOString(),
        collections: enriched,
      };
      const changes = calculateMembershipChanges(previous, snapshot);
      await writeJsonAtomic(this.catalogPath, snapshot);
      this.snapshot = snapshot;
      this.cache.prune(
        modelIds,
        [...rows.map((x) => Number(x.item.data.version.id)), ...checkpointVersionIds],
        loraVersionIds,
        collectionIds,
      );
      try {
        await this.cache.save();
      } catch (error) {
        console.warn('Civitai metadata cache could not be saved:', error);
      }
      this.statusValue = {
        ...this.statusValue,
        state: 'ready',
        phase: '完了',
        completed: enriched.length,
        total: enriched.length,
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
    const name = input.name.trim();
    if (!name) throw new Error('テンプレート名を入力してください。');
    return withTemplateStoreLock(this.templatesPath, async () => {
      const templates = await this.templates(),
        now = new Date().toISOString(),
        existing = input.id ? templates.find((x) => x.id === input.id) : null;
      const value: CatalogSelectionTemplate = {
        id: existing?.id ?? `template-${randomUUID()}`,
        name: name.slice(0, 60),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        selection: input.selection,
      };
      const next = [...templates.filter((x) => x.id !== value.id), value].sort((a, b) =>
        a.name.localeCompare(b.name, 'ja'),
      );
      await writeJsonAtomic(this.templatesPath, next);
      return next;
    });
  }
  async deleteTemplate(id: string) {
    return withTemplateStoreLock(this.templatesPath, async () => {
      const next = (await this.templates()).filter((x) => x.id !== id);
      await writeJsonAtomic(this.templatesPath, next);
      return next;
    });
  }
}
