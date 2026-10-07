import type { ModelsArtifact } from './artifact-types.js';

type PromptFallbackLike = {
  requirement?: unknown;
  positiveTags?: unknown;
  negativeTags?: unknown;
  positive?: unknown;
  negative?: unknown;
  reason?: unknown;
};

function selectionImpact(value: any) {
  if (!value) return null;
  if (Number.isInteger(value.modelId))
    return {
      ref: value.ref,
      modelId: value.modelId,
      versionId: value.versionId,
      fileId: value.fileId,
      fileName: value.fileName,
      trainedWords: Array.isArray(value.trainedWords) ? value.trainedWords : [],
      strengthBaseline: value.strengthBaseline?.value ?? null,
    };
  return { ref: value.ref, fileName: value.fileName };
}
function normalizedFallbackTags(value: unknown) {
  if (Array.isArray(value))
    return value
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  return [];
}
export function normalizedFallback(value: PromptFallbackLike) {
  return {
    requirement: typeof value.requirement === 'string' ? value.requirement : '',
    positiveTags: normalizedFallbackTags(value.positiveTags ?? value.positive),
    negativeTags: normalizedFallbackTags(value.negativeTags ?? value.negative),
    reason: typeof value.reason === 'string' ? value.reason : '',
  };
}
function fallbackImpact(value: PromptFallbackLike) {
  const fallback = normalizedFallback(value);
  return {
    requirement: fallback.requirement,
    positiveTags: fallback.positiveTags,
    negativeTags: fallback.negativeTags,
  };
}
export function modelGenerationInputs(
  models: ModelsArtifact,
  fallbacks: PromptFallbackLike[] = [],
) {
  return JSON.stringify({
    schemaVersion: models.schemaVersion,
    modelFamily: models.modelFamily ?? null,
    checkpoint: selectionImpact(models.checkpoint),
    diffusionModel: selectionImpact(models.diffusionModel),
    textEncoder: selectionImpact(models.textEncoder),
    clip: selectionImpact(models.clip),
    vae: selectionImpact(models.vae),
    loras: (models.loras ?? []).map(selectionImpact),
    promptFallbacks: fallbacks.map(fallbackImpact),
  });
}
export function modelGenerationInputsChanged(
  previous: ModelsArtifact,
  previousFallbacks: PromptFallbackLike[],
  next: ModelsArtifact,
  nextFallbacks: PromptFallbackLike[],
) {
  return (
    modelGenerationInputs(previous, previousFallbacks) !==
    modelGenerationInputs(next, nextFallbacks)
  );
}
