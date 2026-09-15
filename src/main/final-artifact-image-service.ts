import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import type {
  FinalArtifactImageItem,
  FinalArtifactImageSource,
} from '../shared/types.js';
import { getFinalArtifactStatus } from './final-artifact-service.js';

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
  const status = await getFinalArtifactStatus(root);
  if (!status.exists || !status.directory)
    throw new Error('最終成果物ディレクトリが設定されていません。');
  const resolved = path.resolve(imagePath);
  const allowed = (await listImageFiles(status.directory)).some(
    (item) => pathKey(item.path) === pathKey(resolved),
  );
  if (!allowed) throw new Error('最終成果物ディレクトリ外の画像は選択できません。');
  return resolved;
}

export async function readImageSource(
  imagePath: string,
): Promise<FinalArtifactImageSource | null> {
  const resolved = path.resolve(imagePath);
  const mime = FINAL_ARTIFACT_IMAGE_MIME_TYPES[path.extname(resolved).toLowerCase()];
  if (!mime) return null;
  try {
    const bytes = await readFile(resolved);
    const image = nativeImage.createFromBuffer(bytes);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    return {
      path: resolved,
      name: path.basename(resolved),
      width: size.width,
      height: size.height,
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    };
  } catch {
    return null;
  }
}

export async function readImagePreview(
  imagePath: string,
): Promise<FinalArtifactImageSource | null> {
  const resolved = path.resolve(imagePath);
  if (!FINAL_ARTIFACT_IMAGE_MIME_TYPES[path.extname(resolved).toLowerCase()]) return null;
  const image = nativeImage.createFromPath(resolved);
  if (image.isEmpty()) return null;
  const original = image.getSize();
  const preview = original.width > 320 ? image.resize({ width: 320, quality: 'good' }) : image;
  const size = preview.getSize();
  return {
    path: resolved,
    name: path.basename(resolved),
    width: size.width,
    height: size.height,
    dataUrl: preview.toDataURL(),
  };
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
