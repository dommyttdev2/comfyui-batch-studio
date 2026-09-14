import type { PromptPlanArtifact, StructuredPrompt } from './types';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function loraUsages(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        record(item) &&
        typeof item.modelRef === 'string' &&
        typeof item.strengthModel === 'number' &&
        typeof item.strengthClip === 'number',
    )
  );
}

function promptGroups(value: unknown, allowCameraObject: boolean) {
  if (!record(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (allowCameraObject && key === 'camera') {
      return record(item) && Object.values(item).every((cameraTags) => stringArray(cameraTags));
    }
    return stringArray(item);
  });
}

function structuredPrompt(value: unknown): value is StructuredPrompt {
  return record(value) && promptGroups(value.positive, true) && promptGroups(value.negative, false);
}

function v1Branch(value: unknown) {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    loraUsages(value.loras) &&
    Array.isArray(value.leaves) &&
    value.leaves.every(
      (leaf) =>
        record(leaf) &&
        typeof leaf.id === 'string' &&
        typeof leaf.name === 'string' &&
        typeof leaf.positive === 'string' &&
        typeof leaf.negative === 'string',
    )
  );
}

function v2Branch(value: unknown) {
  return (
    record(value) &&
    typeof value.id === 'string' &&
    typeof value.label === 'string' &&
    loraUsages(value.loras) &&
    (value.prompt === undefined || structuredPrompt(value.prompt)) &&
    Array.isArray(value.leaves) &&
    value.leaves.every(
      (leaf) =>
        record(leaf) &&
        typeof leaf.id === 'string' &&
        typeof leaf.name === 'string' &&
        structuredPrompt(leaf.prompt),
    )
  );
}

export function isRenderablePromptPlan(value: unknown): value is PromptPlanArtifact {
  if (!record(value) || !loraUsages(value.rootLoras) || !Array.isArray(value.branches))
    return false;
  if (value.schemaVersion === 1) {
    return (
      record(value.common) &&
      typeof value.common.positive === 'string' &&
      typeof value.common.negative === 'string' &&
      value.branches.every(v1Branch)
    );
  }
  if (value.schemaVersion === 2) {
    return structuredPrompt(value.common) && value.branches.every(v2Branch);
  }
  return false;
}

export function parseRenderablePromptPlan(
  content: string | null | undefined,
): PromptPlanArtifact | null {
  if (!content) return null;
  try {
    const parsed: unknown = JSON.parse(content);
    return isRenderablePromptPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
