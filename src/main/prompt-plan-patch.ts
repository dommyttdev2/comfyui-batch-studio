import { promptPatchBase, applyPromptPatch } from '../application/prompt-plan-patch.js';
import { createHash } from 'node:crypto';
import { applyPromptPlanDifference } from '../domain/prompt-plan-patch-policy.js';
import type {
  ModelsArtifact,
  PromptPlanArtifactV2,
  StructuredPrompt,
  ValidationIssue,
  ValidationResult,
} from '../shared/types.js';
import { confirmedPath, draftPath } from './artifact-service.js';
import { readText, writeTextAtomic } from './fs-utils.js';
import { parseModels, parsePromptPlan, validatePromptPlan } from './validation.js';

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
async function currentPlan(root: string) {
  const draft = draftPath(root, 'promptPlan');
  const content = await readText(draft);
  if (content !== null) return { source: draft, content };
  const confirmed = confirmedPath(root, 'promptPlan');
  const saved = await readText(confirmed);
  return saved === null ? null : { source: confirmed, content: saved };
}
function patchPorts(root: string) {
  return {
    current: () => currentPlan(root),
    models: () => readText(confirmedPath(root, 'models')),
    writeDraft: (content: string) => writeTextAtomic(draftPath(root, 'promptPlan'), content),
    hash: sha256,
  };
}
export async function promptPlanPatchBase(root: string) {
  return promptPatchBase(patchPorts(root));
}
export async function applyPromptPlanPatch(root: string, raw: string) {
  return applyPromptPatch(patchPorts(root), raw);
}
