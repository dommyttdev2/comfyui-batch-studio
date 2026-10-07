import type { FinalArtifactStatus } from './artifact-types.js';
export const FINAL_ARTIFACT_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

export function assessFinalArtifact(
  directory: string | null,
  exists: boolean,
  imageCount: number,
): FinalArtifactStatus {
  if (!Number.isSafeInteger(imageCount) || imageCount < 0)
    throw new Error('Invalid final artifact image count.');
  return {
    state: !directory
      ? 'unconfigured'
      : !exists
        ? 'source-missing'
        : imageCount < 1
          ? 'empty'
          : 'ready',
    directory,
    exists,
    imageCount,
    imageExtensions: [...FINAL_ARTIFACT_IMAGE_EXTENSIONS],
  };
}
