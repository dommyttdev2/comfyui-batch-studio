import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { FinalArtifactImageItem, FinalArtifactImageSource } from '../shared/types.js';
import { getFinalArtifactStatus } from './final-artifact-service.js';
import { readProjectMeta } from './project-meta.js';
import { readOrientedNativeImage } from './image-pipeline.js';

export const FINAL_ARTIFACT_IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function pathKey(value: string) {
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export async function listImageFiles(directory: string): Promise<FinalArtifactImageItem[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        FINAL_ARTIFACT_IMAGE_MIME_TYPES[path.extname(entry.name).toLowerCase()] !== undefined,
    )
    .map((entry) => ({ path: path.join(directory, entry.name), name: entry.name }))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),
    );
}

export async function listFinalArtifactImages(root: string): Promise<FinalArtifactImageItem[]> {
  const status = await getFinalArtifactStatus(root);
  if (!status.exists || !status.directory) return [];
  return listImageFiles(status.directory);
}

export async function assertFinalArtifactImage(root: string, imagePath: string) {
  // Read the configured path directly. getFinalArtifactStatus and listImageFiles
  // enumerate the entire directory, which is quadratic for gallery previews.
  const meta = await readProjectMeta(root);
  const configured =
    meta?.settings.finalArtifactDirectory?.trim() ||
    meta?.settings.captionSourceDirectory?.trim() ||
    '';
  if (!configured)
    throw new Error('最終成果物ディレクトリが設定されていません。');

  let directory: string;
  try {
    directory = await realpath(configured);
    if (!(await lstat(directory)).isDirectory())
      throw new Error('Not a directory');
  } catch {
    throw new Error('最終成果物ディレクトリが見つかりません。');
  }

  const resolved = path.resolve(imagePath);
  const extension = path.extname(resolved).toLowerCase();
  const relative = path.relative(pathKey(directory), pathKey(resolved));
  if (
    !FINAL_ARTIFACT_IMAGE_MIME_TYPES[extension] ||
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative) ||
    relative.includes(path.sep)
  )
    throw new Error('最終成果物ディレクトリ外の画像は選択できません。');

  try {
    // Refuse file symlinks and junction escapes; do not authorize by a prefix.
    const info = await lstat(resolved);
    if (!info.isFile() || pathKey(await realpath(resolved)) !== pathKey(path.join(directory, relative)))
      throw new Error('Invalid image');
  } catch {
    throw new Error('最終成果物ディレクトリ外の画像は選択できません。');
  }
  return resolved;
}

export async function readImageSource(imagePath: string): Promise<FinalArtifactImageSource | null> {
  const resolved = path.resolve(imagePath);
  const extension = path.extname(resolved).toLowerCase();
  const mime = FINAL_ARTIFACT_IMAGE_MIME_TYPES[extension];
  if (!mime) return null;
  try {
    if (extension === '.webp') {
      const bytes = await readFile(resolved);
      return {
        path: resolved,
        name: path.basename(resolved),
        width: 0,
        height: 0,
        dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      };
    }
    const { image, width, height } = await readOrientedNativeImage(resolved);
    return {
      path: resolved,
      name: path.basename(resolved),
      width,
      height,
      dataUrl: image.toDataURL(),
    };
  } catch {
    return null;
  }
}

export async function readImagePreview(
  imagePath: string,
): Promise<FinalArtifactImageSource | null> {
  const resolved = path.resolve(imagePath);
  const extension = path.extname(resolved).toLowerCase();
  const mime = FINAL_ARTIFACT_IMAGE_MIME_TYPES[extension];
  if (!mime) return null;
  try {
    if (extension === '.webp') {
      const bytes = await readFile(resolved);
      return {
        path: resolved,
        name: path.basename(resolved),
        width: 0,
        height: 0,
        dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
      };
    }
    const { image, width } = await readOrientedNativeImage(resolved);
    const preview = width > 320 ? image.resize({ width: 320, quality: 'good' }) : image;
    const size = preview.getSize();
    return {
      path: resolved,
      name: path.basename(resolved),
      width: size.width,
      height: size.height,
      dataUrl: preview.toDataURL(),
    };
  } catch {
    return null;
  }
}

export async function readFinalArtifactImage(
  root: string,
  imagePath: string,
): Promise<FinalArtifactImageSource | null> {
  const resolved = await assertFinalArtifactImage(root, imagePath);
  return readImageSource(resolved);
}

export async function readFinalArtifactPreview(
  root: string,
  imagePath: string,
): Promise<FinalArtifactImageSource | null> {
  const resolved = await assertFinalArtifactImage(root, imagePath);
  return readImagePreview(resolved);
}
