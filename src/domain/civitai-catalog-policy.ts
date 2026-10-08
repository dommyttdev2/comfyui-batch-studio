import type { CivitaiGenerationExample, StrengthBaseline, ModelCatalog } from './artifact-types.js';
export interface CachedCheckpointEvidence {
  modelVersionId: number;
  imageCount: number;
  evidenceImageIds: number[];
}
const METHOD = 'median-of-post-medians:newest-200';
const MIN_DISTINCT_POSTS = 5;
export function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
      values.find(
        (value): value is string => typeof value === 'string' && value.trim().length > 0,
      ) ?? null;
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
