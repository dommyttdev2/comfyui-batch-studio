import { createHash } from 'node:crypto';
import { modelGenerationInputs } from '../domain/model-impact.js';
import type {
  ModelsArtifact,
  PromptPlanArtifact,
  ValidationIssue,
  WorkflowManifest,
} from '../shared/types.js';

// Catalog refresh timestamps and generation numbers are not Workflow inputs.
export function hashWorkflowModelInputs(models: ModelsArtifact): string {
  return hashCanonicalJson(JSON.parse(modelGenerationInputs(models)));
}

import { canonical } from '../domain/workflow-graph.js';

export * from '../domain/workflow-graph.js';
export function hashCanonicalJson(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)), 'utf8')
    .digest('hex');
}
