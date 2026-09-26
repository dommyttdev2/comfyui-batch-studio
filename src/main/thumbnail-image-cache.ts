import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import type { ThumbnailImageSource } from '../shared/types.js';
import { readOrientedNativeImage } from './image-pipeline.js';
import { encodedImageDimensions } from './image-dimensions.js';
import { ThumbnailCachePruner } from './thumbnail-cache-prune.js';

export type ThumbnailCacheVariant = 'editor' | 'gallery';
export type ThumbnailCacheTiming = {
  hit?: boolean;
  statMs?: number;
  diskReadMs?: number;
  queuedMs?: number;
  decodeMs?: number;
  resizeMs?: number;
  encodeMs?: number;
  writeMs?: number;
  sharedMs?: number;
};
const MAX_EDGE: Record<ThumbnailCacheVariant, number> = { editor: 2048, gallery: 320 };
const LIMIT_BYTES = 512 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const pending = new Map<string, Promise<ThumbnailImageSource | null>>();
const protectedCacheFiles = new Set<string>();
const pruner = new ThumbnailCachePruner(LIMIT_BYTES);
const queue: Array<() => void> = [];
let active = 0;
let completed = 0;

function cachedDimensions(bytes: Buffer, variant: ThumbnailCacheVariant) {
  const header = encodedImageDimensions(bytes);
  if (
    !header ||
    header.width < 1 ||
    header.height < 1 ||
    Math.max(header.width, header.height) > MAX_EDGE[variant]
  )
    return null;
  const size = nativeImage.createFromBuffer(bytes).getSize();
  return size.width > 0 && size.height > 0 && Math.max(size.width, size.height) <= MAX_EDGE[variant]
    ? size
    : null;
}

async function limited<T>(action: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
  try {
    return await action();
  } finally {
    active--;
    queue.shift()?.();
  }
}

function cacheFile(root: string, variant: ThumbnailCacheVariant, key: string, extension: string) {
  return path.join(root, 'cache', 'thumbnail-images', 'v1', variant, `${key}.${extension}`);
}

async function sourceIdentity(file: string, variant: ThumbnailCacheVariant) {
  const resolved = path.resolve(file);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('画像ファイルが存在しません。');
  const key = createHash('sha256')
    .update(
      JSON.stringify([
        process.platform === 'win32' ? resolved.toLowerCase() : resolved,
        info.size,
        info.mtimeMs,
        info.ctimeMs,
        variant,
        MAX_EDGE[variant],
      ]),
    )
    .digest('hex');
  return { resolved, info, key };
}

function toSource(
  file: string,
  bytes: Buffer,
  mime: string,
  version: string,
  width: number,
  height: number,
): ThumbnailImageSource {
  return {
    path: file,
    name: path.basename(file),
    width,
    height,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    cacheVersion: version,
  };
}

function cacheRoot(root: string) {
  return path.join(root, 'cache', 'thumbnail-images', 'v1');
}

function isCacheFileProtected(file: string) {
  return pending.has(file) || protectedCacheFiles.has(file);
}

function scheduleCachePrune(root: string) {
  pruner.schedule(cacheRoot(root), isCacheFileProtected);
}

export function thumbnailCachePruneMetrics(root: string) {
  return pruner.snapshot(cacheRoot(root));
}

export async function readCachedThumbnailImage(
  userDataRoot: string,
  file: string,
  variant: ThumbnailCacheVariant,
  timing?: ThumbnailCacheTiming,
): Promise<ThumbnailImageSource | null> {
  const started = performance.now();
  const { resolved, info, key } = await sourceIdentity(file, variant);
  if (timing) timing.statMs = performance.now() - started;
  const jpeg = /\.jpe?g$/i.test(resolved);
  const extension = jpeg ? 'jpg' : 'png';
  const mime = jpeg ? 'image/jpeg' : 'image/png';
  const target = cacheFile(userDataRoot, variant, key, extension);
  const readStarted = performance.now();
  protectedCacheFiles.add(target);
  try {
    const cached = await readFile(target).catch(() => null);
    if (timing) timing.diskReadMs = performance.now() - readStarted;
    if (cached) {
      const size = cachedDimensions(cached, variant);
      if (size) {
        if (timing) timing.hit = true;
        return toSource(resolved, cached, mime, key, size.width, size.height);
      }
      await rm(target, { force: true }).catch(() => undefined);
    }
  } finally {
    protectedCacheFiles.delete(target);
  }
  const existing = pending.get(target);
  if (existing) {
    const sharedStarted = performance.now();
    const result = await existing;
    if (timing) {
      timing.hit = false;
      timing.sharedMs = performance.now() - sharedStarted;
    }
    return result;
  }
  const queuedStarted = performance.now();
  const job = limited(async () => {
    if (timing) timing.queuedMs = performance.now() - queuedStarted;
    // Another request may have populated the file while queued.
    const already = await readFile(target).catch(() => null);
    if (already) {
      const size = cachedDimensions(already, variant);
      if (size) {
        if (timing) timing.hit = true;
        return toSource(resolved, already, mime, key, size.width, size.height);
      }
    }
    let image: Electron.NativeImage;
    let width: number;
    let height: number;
    try {
      const decodeStarted = performance.now();
      const oriented = await readOrientedNativeImage(resolved);
      if (timing) timing.decodeMs = performance.now() - decodeStarted;
      image = oriented.image;
      width = oriented.width;
      height = oriented.height;
    } catch (error) {
      // Some Electron builds do not support WebP in nativeImage. The picker can
      // decode it in Chromium and store a resized preview via storeWebpThumbnailPreview.
      if (variant === 'gallery' && /\.webp$/i.test(resolved)) return null;
      throw error instanceof Error ? error : new Error('画像キャッシュを生成できませんでした。');
    }
    const ratio = Math.min(1, MAX_EDGE[variant] / Math.max(width, height));
    const resizeStarted = performance.now();
    const thumbnail =
      ratio < 1
        ? image.resize({
            width: Math.max(1, Math.round(width * ratio)),
            height: Math.max(1, Math.round(height * ratio)),
            quality: 'good',
          })
        : image;
    if (timing) timing.resizeMs = performance.now() - resizeStarted;
    const size = thumbnail.getSize();
    const encodeStarted = performance.now();
    const bytes = jpeg ? thumbnail.toJPEG(92) : thumbnail.toPNG();
    if (timing) timing.encodeMs = performance.now() - encodeStarted;
    const after = await stat(resolved);
    if (
      after.size !== info.size ||
      after.mtimeMs !== info.mtimeMs ||
      after.ctimeMs !== info.ctimeMs
    )
      throw new Error('画像が処理中に変更されました。');
    const writeStarted = performance.now();
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, bytes);
      await rename(temp, target);
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
    if (timing) {
      timing.hit = false;
      timing.writeMs = performance.now() - writeStarted;
    }
    if (++completed % 32 === 0) scheduleCachePrune(userDataRoot);
    return toSource(resolved, bytes, mime, key, size.width, size.height);
  });
  pending.set(target, job);
  try {
    return await job;
  } finally {
    pending.delete(target);
  }
}

export async function storeWebpThumbnailPreview(
  userDataRoot: string,
  file: string,
  dataUrl: string,
): Promise<void> {
  if (!/\.webp$/i.test(file) || !dataUrl.startsWith('data:image/png;base64,'))
    throw new Error('Invalid WebP preview.');
  const before = await sourceIdentity(file, 'gallery');
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new Error('Invalid WebP preview size.');
  const size = cachedDimensions(bytes, 'gallery');
  if (!size) throw new Error('Invalid WebP preview dimensions.');
  const after = await sourceIdentity(file, 'gallery');
  if (before.key !== after.key) throw new Error('画像が処理中に変更されました。');
  const target = cacheFile(userDataRoot, 'gallery', before.key, 'png');
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  protectedCacheFiles.add(target);
  try {
    await writeFile(temp, bytes);
    await rename(temp, target);
  } finally {
    protectedCacheFiles.delete(target);
    await rm(temp, { force: true }).catch(() => undefined);
  }
}
