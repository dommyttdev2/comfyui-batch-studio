import type { ModelsArtifact, PromptFallback } from './artifact-types.js';
import { mergeLoraImport, splitModelDraft } from './model-draft-policy.js';
export type ModelResetScope =
  | 'story'
  | 'base-models'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'workflow';
export function cleanBase(models: ModelsArtifact) {
  const base = splitModelDraft(models).models;
  base.loras = [];
  return base;
}
export function modelResetPlan(scope: ModelResetScope) {
  if (!['story', 'base-models', 'models', 'models-fix', 'prompt-plan', 'workflow'].includes(scope))
    throw new Error('Unsupported reset scope.');
  return {
    story: scope === 'story',
    models: ['story', 'base-models', 'models', 'models-fix'].includes(scope),
    promptPlan: scope !== 'workflow',
    workflow: true,
    initialHistory: ['story', 'base-models', 'models'].includes(scope),
    fixHistory: ['story', 'base-models', 'models', 'models-fix'].includes(scope),
  };
}
export function restoreModelSelection(
  current: ModelsArtifact | null,
  initial: unknown,
  scope: 'models' | 'models-fix',
  currentOnly = true,
) {
  if (!current || (currentOnly && current.schemaVersion !== 5))
    throw new Error('Current base model selection required.');
  if (scope === 'models') return { models: cleanBase(current), fallbacks: [] as PromptFallback[] };
  if (!initial) throw new Error('Initial LoRA selection history required.');
  const result = splitModelDraft(mergeLoraImport(cleanBase(current), initial, currentOnly));
  if (result.missingRequirements.length)
    throw new Error('Initial selection has unresolved requirements.');
  return { models: result.models, fallbacks: result.fallbacks };
}
