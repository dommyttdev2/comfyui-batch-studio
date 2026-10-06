import { BusinessError, type ArtifactKey, type Validation } from './contracts.js';
export interface Artifact {
  key: ArtifactKey;
  content: string;
  status: 'draft' | 'confirmed' | 'stale';
  validation: Validation;
}
export const downstream: Record<ArtifactKey, readonly ArtifactKey[]> = {
  brief: ['story', 'models', 'promptPlan', 'workflow', 'thumbnail', 'marketplace', 'caption'],
  story: ['models', 'promptPlan', 'workflow', 'thumbnail', 'marketplace', 'caption'],
  models: ['promptPlan', 'workflow', 'thumbnail', 'marketplace', 'caption'],
  promptPlan: ['workflow', 'thumbnail', 'marketplace', 'caption'],
  workflow: ['thumbnail', 'marketplace', 'caption'],
  thumbnail: [],
  marketplace: [],
  caption: [],
};
export function assertConfirmable(artifact: Artifact | undefined): asserts artifact is Artifact {
  if (
    !artifact ||
    artifact.status !== 'draft' ||
    !artifact.content.trim() ||
    !artifact.validation.valid
  )
    throw new BusinessError('INVALID_ARTIFACT', 'A nonempty valid draft is required.');
}
export function assertUsable(artifact: Artifact | undefined): asserts artifact is Artifact {
  if (!artifact || artifact.status !== 'confirmed' || !artifact.validation.valid)
    throw new BusinessError('INVALID_ARTIFACT', 'A current confirmed artifact is required.');
}
export function requireMessage(text: string): string {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > 750_000)
    throw new BusinessError('INVALID_INPUT', 'AI message is empty or too long.');
  return text.trim();
}
