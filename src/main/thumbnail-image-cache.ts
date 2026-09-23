import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import type { ThumbnailImageSource } from '../shared/types.js';
import { readOrientedNativeImage } from './image-pipeline.js';

export type ThumbnailCacheVariant = 'editor' | 'gallery';
const MAX_EDGE: Record<ThumbnailCacheVariant, number> = { editor: 2048, gallery: 320 };
const LIMIT_BYTES = 512 * 1024 * 1024;
const MAX_CONCURRENT = 2;
const pending = new Map<string, Promise<ThumbnailImageSource | null>>();
const queue: Array<() => void> = [];
let active = 0;
let completed = 0;

async function limited<T>(action: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((resolve) => queue.push(resolve));
  active++;
  try { return await action(); }
  finally { active--; queue.shift()?.(); }
}

function cacheFile(root: string, variant: ThumbnailCacheVariant, key: string, extension: string) {
  return path.join(root, 'cache', 'thumbnail-images', 'v1', variant, `${key}.${extension}`);
}

async function sourceIdentity(file: string, variant: ThumbnailCacheVariant) {
  const resolved = path.resolve(file);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('画像ファイルが存在しません。');
  const key = createHash('sha256').update(JSON.stringify([
    process.platform === 'win32' ? resolved.toLowerCase() : resolved,
    info.size, info.mtimeMs, info.ctimeMs, variant, MAX_EDGE[variant],
  ])).digest('hex');
  return { resolved, info, key };
}

function toSource(file: string, bytes: Buffer, mime: string, version: string,
  width: number, height: number): ThumbnailImageSource {
  return {
    path: file, name: path.basename(file), width, height,
    dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    cacheVersion: version,
  };
}

async function pruneCache(root: string) {
  const base = path.join(root, 'cache', 'thumbnail-images', 'v1');
  const files: Array<{ path: string; size: number; mtimeMs: number }> = [];
  for (const variant of ['editor', 'gallery']) {
    const directory = path.join(base, variant);
    const entries = await readdir(directory).catch(() => [] as string[]);
    for (const name of entries) {
      const file = path.join(directory, name);
      const info = await stat(file).catch(() => null);
      if (info?.isFile()) files.push({ path: file, size: info.size, mtimeMs: info.mtimeMs });
    }
  }
  let total = files.reduce((sum, file) => sum + file.size, 0);
  for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
    if (total <= LIMIT_BYTES) break;
    await rm(file.path, { force: true }).catch(() => undefined);
    total -= file.size;
  }
}

export async function readCachedThumbnailImage(
  userDataRoot: string, file: string, variant: ThumbnailCacheVariant,
): Promise<ThumbnailImageSource | null> {
  const { resolved, info, key } = await sourceIdentity(file, variant);
  const jpeg = /\.jpe?g$/i.test(resolved);
  const extension = jpeg ? 'jpg' : 'png';
  const mime = jpeg ? 'image/jpeg' : 'image/png';
  const target = cacheFile(userDataRoot, variant, key, extension);
  const cached = await readFile(target).catch(() => null);
  if (cached) {
    const size = nativeImage.createFromBuffer(cached).getSize();
    if (size.width && size.height) return toSource(resolved, cached, mime, key, size.width, size.height);
    await rm(target, { force: true }).catch(() => undefined);
  }
  const existing = pending.get(target);
  if (existing) return existing;
  const job = limited(async () => {
    // Another request may have populated the file while queued.
    const already = await readFile(target).catch(() => null);
    if (already) {
      const size = nativeImage.createFromBuffer(already).getSize();
      if (size.width && size.height) return toSource(resolved, already, mime, key, size.width, size.height);
    }
    let image: Electron.NativeImage;
    let width: number;
    let height: number;
    try {
      const oriented = await readOrientedNativeImage(resolved);
      image = oriented.image;
      width = oriented.width;
      height = oriented.height;
    } catch {
      // Some Electron builds do not support WebP in nativeImage. The picker can
      // decode it in Chromium and store a resized preview via storeWebpThumbnailPreview.
      if (variant === 'gallery' && /\.webp$/i.test(resolved)) return null;
      throw new Error('画像キャッシュを生成できませんでした。');
    }
    const ratio = Math.min(1, MAX_EDGE[variant] / Math.max(width, height));
    const thumbnail = ratio < 1
      ? image.resize({ width: Math.max(1, Math.round(width * ratio)),
        height: Math.max(1, Math.round(height * ratio)), quality: 'good' })
      : image;
    const size = thumbnail.getSize();
    const bytes = jpeg ? thumbnail.toJPEG(92) : thumbnail.toPNG();
    const after = await stat(resolved);
    if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs)
      throw new Error('画像が処理中に変更されました。');
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try { await writeFile(temp, bytes); await rename(temp, target); }
    finally { await rm(temp, { force: true }).catch(() => undefined); }
    if (++completed % 32 === 0) void pruneCache(userDataRoot).catch(() => undefined);
    return toSource(resolved, bytes, mime, key, size.width, size.height);
  });
  pending.set(target, job);
  try { return await job; } finally { pending.delete(target); }
}

export async function storeWebpThumbnailPreview(
  userDataRoot: string, file: string, dataUrl: string,
): Promise<void> {
  if (!/\.webp$/i.test(file) || !dataUrl.startsWith('data:image/png;base64,'))
    throw new Error('Invalid WebP preview.');
  const before = await sourceIdentity(file, 'gallery');
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (!bytes.length || bytes.length > 4 * 1024 * 1024)
    throw new Error('Invalid WebP preview size.');
  const decoded = nativeImage.createFromBuffer(bytes);
  const size = decoded.getSize();
  if (decoded.isEmpty() || Math.max(size.width, size.height) > 320)
    throw new Error('Invalid WebP preview dimensions.');
  const after = await sourceIdentity(file, 'gallery');
  if (before.key !== after.key) throw new Error('画像が処理中に変更されました。');
  const target = cacheFile(userDataRoot, 'gallery', before.key, 'png');
  await mkdir(path.dirname(target), { recursive: true });
  const temp = `${target}.${randomUUID()}.tmp`;
  try { await writeFile(temp, bytes); await rename(temp, target); }
  finally { await rm(temp, { force: true }).catch(() => undefined); }
}
