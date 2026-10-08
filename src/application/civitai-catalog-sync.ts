import type {
  ModelCatalog,
  StrengthBaseline,
  CivitaiGenerationExample,
} from '../domain/artifact-types.js';
import {
  numberValue,
  calculateMembershipChanges,
  type CachedCheckpointEvidence,
} from '../domain/civitai-catalog-policy.js';
export interface CatalogCollectionMeta {
  id: number;
  name: string;
  description?: string | null;
  read?: string;
  type?: string;
  imageId?: number | null;
}
export interface CivitaiCatalogSyncPorts {
  client: {
    getCollections(): Promise<CatalogCollectionMeta[]>;
    getCollectionItems(id: number): Promise<{ pages: number; items: any[] }>;
  };
  localMetrics: { collectionPages: number; membershipItems: number };
  progress(phase: string, completed: number, total: number, message: string): void;
  modelDetail(id: number): Promise<any>;
  versionDetail(id: number): Promise<any>;
  loraUsage(id: number): Promise<{
    baseline: StrengthBaseline | null;
    checkpointEvidence: CachedCheckpointEvidence[];
    generationExamples: CivitaiGenerationExample[];
  }>;
  collectionThumbnail(id: number, imageId: number | null): Promise<string | undefined>;
  previous(): Promise<ModelCatalog | null>;
  publish(value: ModelCatalog): Promise<void>;
  now(): string;
  pruneCache(
    modelIds: number[],
    versionIds: number[],
    loraVersionIds: number[],
    collectionIds: number[],
  ): Promise<void>;
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

function collectionImageId(meta: CatalogCollectionMeta, items: any[]) {
  if (meta.imageId != null && Number.isFinite(meta.imageId)) return meta.imageId;
  const found = items.find((x) => x?.data?.images?.[0]?.id != null);
  const id = Number(found?.data?.images?.[0]?.id);
  return Number.isFinite(id) ? id : null;
}

export async function syncCivitaiCatalog(ports: CivitaiCatalogSyncPorts) {
  const collections = await ports.client.getCollections();
  const collectionIds = collections.map((x) => x.id);
  ports.progress(
    'コレクション確認中',
    0,
    collectionIds.length || 1,
    'コレクション所属情報を全件確認しています',
  );
  let collectionCompleted = 0;
  const itemResults = await mapLimit(collectionIds, 1, async (id) => {
    const result = await ports.client.getCollectionItems(id);
    ports.localMetrics.collectionPages += result.pages;
    collectionCompleted += 1;
    ports.progress(
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
      if (item?.type === 'model' && data?.id && version?.id) rows.push({ collectionId: id, item });
    }
  });
  ports.localMetrics.membershipItems = rows.length;

  const modelIds = [...new Set(rows.map((x) => Number(x.item.data.id)))];
  const models = new Map<number, any>();
  ports.progress('モデル収集中', 0, modelIds.length || 1, 'モデル詳細をキャッシュと照合しています');
  let modelCompleted = 0;
  await mapLimit(modelIds, 4, async (id) => {
    models.set(id, await ports.modelDetail(id));
    modelCompleted += 1;
    ports.progress(
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
      fallback.set(id, await ports.versionDetail(id));
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
  ports.progress(
    'LoRA利用実績確認中',
    0,
    loraVersionIds.length || 1,
    'LoRA Versionの作例から強度と使用Checkpointを確認しています',
  );
  let usageCompleted = 0;
  await mapLimit(loraVersionIds, 4, async (id) => {
    usageByVersion.set(id, await ports.loraUsage(id));
    usageCompleted += 1;
    ports.progress(
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
  ports.progress(
    'LoRA基盤Checkpoint解決中',
    0,
    checkpointVersionIds.length || 1,
    '作例で確認したCheckpointのCivitai identityを解決しています',
  );
  let checkpointCompleted = 0;
  await mapLimit(checkpointVersionIds, 4, async (id) => {
    try {
      checkpointDetails.set(id, await ports.versionDetail(id));
    } catch {
      checkpointDetails.set(id, null);
    }
    checkpointCompleted += 1;
    ports.progress(
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
  ports.progress(
    'サムネイル確認中',
    0,
    collectionIds.length || 1,
    'コレクションサムネイルをキャッシュと照合しています',
  );
  const thumbnails = await mapLimit(collectionIds, 3, async (id, index) => {
    const imageId = collectionImageId(metaById.get(id)!, itemResults[index]);
    const url = await ports.collectionThumbnail(id, imageId);
    thumbnailCompleted += 1;
    ports.progress(
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

  const previous = await ports.previous();
  const snapshot: ModelCatalog = {
    schemaVersion: 1,
    generation: (previous?.generation ?? 0) + 1,
    generatedAt: ports.now(),
    collections: enriched,
  };
  const changes = calculateMembershipChanges(previous, snapshot);
  await ports.publish(snapshot);
  await ports.pruneCache(
    modelIds,
    [...rows.map((x) => Number(x.item.data.version.id)), ...checkpointVersionIds],
    loraVersionIds,
    collectionIds,
  );
  return { snapshot, changes };
}
