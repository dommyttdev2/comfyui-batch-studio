import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FinalArtifactStatus } from '../shared/types.js';
import { readProjectMeta } from './project-meta.js';

export const FINAL_ARTIFACT_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

async function isDirectory(directory: string) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function countImages(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries.filter(
    (entry) =>
      entry.isFile() && FINAL_ARTIFACT_IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()),
  ).length;
}

export async function getFinalArtifactStatus(root: string): Promise<FinalArtifactStatus> {
  const meta = await readProjectMeta(root);
  const configured =
    meta?.settings.finalArtifactDirectory?.trim() ||
    meta?.settings.captionSourceDirectory?.trim() ||
    '';
  const directory = configured || null;
  const exists = directory ? await isDirectory(directory) : false;
  const imageCount = exists && directory ? await countImages(directory) : 0;

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
