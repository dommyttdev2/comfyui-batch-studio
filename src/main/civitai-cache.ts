import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import type { StrengthBaseline } from '../shared/types.js';

type CacheEntry<T> = { fetchedAt: number; value: T };
type ThumbnailEntry = CacheEntry<string | null> & { imageId: number | null };
type Lookup<T> = { hit: true; value: T } | { hit: false };

export interface CachedCheckpointEvidence {
  modelVersionId: number;
  imageCount: number;
  evidenceImageIds: number[];
}

interface StoredCache {
  schemaVersion: 1;
  models: Record<string, CacheEntry<unknown>>;
  versions: Record<string, CacheEntry<unknown>>;
  baselines: Record<string, CacheEntry<StrengthBaseline | null>>;
  checkpointEvidence: Record<string, CacheEntry<CachedCheckpointEvidence[]>>;
  collectionThumbnails: Record<string, ThumbnailEntry>;
}

function emptyCache(): StoredCache {
  return {
    schemaVersion: 1,
    models: {},
    versions: {},
    baselines: {},
    checkpointEvidence: {},
    collectionThumbnails: {},
  };
}
async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.tmp`);
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(temp, file);
}
async function readCache(file: string): Promise<StoredCache> {
  try {
    const value = JSON.parse(await readFile(file, 'utf8')) as Partial<StoredCache>;
    if (value?.schemaVersion !== 1) return emptyCache();
    return {
      schemaVersion: 1,
      models: value.models ?? {},
      versions: value.versions ?? {},
      baselines: value.baselines ?? {},
      checkpointEvidence: value.checkpointEvidence ?? {},
      collectionThumbnails: value.collectionThumbnails ?? {},
    };
  } catch {
    return emptyCache();
  }
}
function fresh<T>(entry: CacheEntry<T> | undefined, ttlMs: number, now = Date.now()): Lookup<T> {
  return entry && ttlMs > 0 && now - entry.fetchedAt <= ttlMs
    ? { hit: true, value: entry.value }
    : { hit: false };
}

export class CivitaiMetadataCache {
  private value: StoredCache = emptyCache();
  constructor(readonly filePath: string) {}
  async initialize() {
    this.value = await readCache(this.filePath);
  }

  model(modelId: number, ttlMs: number) {
    return fresh(this.value.models[String(modelId)], ttlMs);
  }
  setModel(modelId: number, value: unknown) {
    this.value.models[String(modelId)] = { fetchedAt: Date.now(), value };
  }

  version(versionId: number, ttlMs: number) {
    return fresh(this.value.versions[String(versionId)], ttlMs);
  }
  setVersion(versionId: number, value: unknown) {
    this.value.versions[String(versionId)] = { fetchedAt: Date.now(), value };
  }

  baseline(versionId: number, ttlMs: number) {
    return fresh(this.value.baselines[String(versionId)], ttlMs);
  }
  setBaseline(versionId: number, value: StrengthBaseline | null) {
    this.value.baselines[String(versionId)] = { fetchedAt: Date.now(), value };
  }

  checkpointEvidence(versionId: number, ttlMs: number) {
    return fresh(this.value.checkpointEvidence[String(versionId)], ttlMs);
  }
  setCheckpointEvidence(versionId: number, value: CachedCheckpointEvidence[]) {
    this.value.checkpointEvidence[String(versionId)] = { fetchedAt: Date.now(), value };
  }

  thumbnail(collectionId: number, imageId: number | null, ttlMs: number): Lookup<string | null> {
    const entry = this.value.collectionThumbnails[String(collectionId)];
    if (!entry || entry.imageId !== imageId) return { hit: false };
    return fresh(entry, ttlMs);
  }
  setThumbnail(collectionId: number, imageId: number | null, value: string | null) {
    this.value.collectionThumbnails[String(collectionId)] = {
      fetchedAt: Date.now(),
      imageId,
      value,
    };
  }

  prune(
    modelIds: Iterable<number>,
    versionIds: Iterable<number>,
    baselineIds: Iterable<number>,
    collectionIds: Iterable<number>,
  ) {
    const keep = (values: Iterable<number>) => new Set([...values].map(String));
    const models = keep(modelIds),
      versions = keep(versionIds),
      baselines = keep(baselineIds),
      collections = keep(collectionIds);
    for (const key of Object.keys(this.value.models))
      if (!models.has(key)) delete this.value.models[key];
    for (const key of Object.keys(this.value.versions))
      if (!versions.has(key)) delete this.value.versions[key];
    for (const key of Object.keys(this.value.baselines))
      if (!baselines.has(key)) delete this.value.baselines[key];
    for (const key of Object.keys(this.value.checkpointEvidence))
      if (!baselines.has(key)) delete this.value.checkpointEvidence[key];
    for (const key of Object.keys(this.value.collectionThumbnails))
      if (!collections.has(key)) delete this.value.collectionThumbnails[key];
  }

  save() {
    return atomicJson(this.filePath, this.value);
  }
}
