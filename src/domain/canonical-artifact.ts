import type {
  ModelCatalog,
  ModelsArtifact,
  ProjectBriefInput,
  PromptFallback,
  PromptPlanArtifact,
  ValidationResult,
} from './artifact-types.js';
import { validateModels, validateProjectBrief, validatePromptPlan } from './artifact-validation.js';
import { sameStoryBriefInputs } from './brief-impact-policy.js';
import { validateCaptionContent } from './caption-policy.js';
import { validateModelsWithCatalog } from './catalog-validation.js';
import type { ArtifactKey, Validation } from './contracts.js';
import { splitModelDraft, validateModelDraft } from './model-draft-policy.js';
import { modelGenerationInputsChanged } from './model-impact.js';
export function parseArtifact(content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}
function reject(code: string): Validation {
  return { valid: false, issues: [{ code, message: code }] };
}
export function validateCanonicalArtifact(
  key: ArtifactKey,
  content: string,
  models: ModelsArtifact | null,
  catalog: ModelCatalog | null,
): Validation {
  if (key === 'story') return content.trim() ? { valid: true, issues: [] } : reject('STORY_EMPTY');
  const value = parseArtifact(content);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return reject('ARTIFACT_JSON_OBJECT');
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  let result: ValidationResult;
  try {
    switch (key) {
      case 'brief':
        result = validateProjectBrief(value as ProjectBriefInput);
        break;
      case 'models': {
        if (version !== 5) return reject('MODELS_CURRENT_SCHEMA_REQUIRED');
        const selected = value as ModelsArtifact;
        result = validateModelDraft(selected);
        if (result.valid)
          result = validateModelsWithCatalog(catalog, splitModelDraft(selected).models, result);
        break;
      }
      case 'promptPlan':
        if (version !== 2) return reject('PROMPT_PLAN_CURRENT_SCHEMA_REQUIRED');
        if (!models || models.schemaVersion !== 5) return reject('CONFIRMED_MODELS_REQUIRED');
        result = validatePromptPlan(value as PromptPlanArtifact, models);
        break;
      case 'caption':
        if (version !== 2) return reject('CAPTION_CURRENT_SCHEMA_REQUIRED');
        result = validateCaptionContent(value);
        break;
      default:
        return reject('GENERATED_ARTIFACT_REQUIRES_BUILD');
    }
    return result;
  } catch {
    return reject('ARTIFACT_FIELD_TYPE');
  }
}
export function changesGenerationInputs(
  key: ArtifactKey,
  previous: string | undefined,
  next: string,
  previousFallbacks: PromptFallback[] = [],
  nextFallbacks: PromptFallback[] = [],
): boolean {
  if (previous === undefined) return true;
  if (key === 'brief') return !sameStoryBriefInputs(parseArtifact(previous), parseArtifact(next));
  if (key !== 'models') return previous !== next;
  const before = parseArtifact(previous) as ModelsArtifact | null;
  const after = parseArtifact(next) as ModelsArtifact | null;
  return (
    !before ||
    !after ||
    modelGenerationInputsChanged(before, previousFallbacks, after, nextFallbacks)
  );
}
