import type { ThumbnailImageSource } from '../shared/types';

const LIMIT = 128 * 1024 * 1024;
type Entry = { image: HTMLImageElement; bytes: number };
const loaded = new Map<string, Entry>();
const pending = new Map<string, Promise<HTMLImageElement>>();
let generation = 0;

export function resetEditorImageCache() {
  generation++;
  loaded.clear();
  pending.clear();
}

function decode(source: ThumbnailImageSource): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${source.name} を読み込めませんでした。`));
    image.src = source.dataUrl;
  });
}

export async function cachedEditorImage(source: ThumbnailImageSource): Promise<HTMLImageElement> {
  if (!source.cacheVersion) return decode(source);
  const version = source.cacheVersion;
  const key = `${source.path}\0${version}`;
  const existing = loaded.get(key);
  if (existing) {
    loaded.delete(key);
    loaded.set(key, existing);
    return existing.image;
  }
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;
  const requestedGeneration = generation;
  const task = decode(source).then((image) => {
    if (requestedGeneration !== generation) return image;
    const bytes = image.naturalWidth * image.naturalHeight * 4;
    for (const stale of loaded.keys()) {
      if (stale.startsWith(`${source.path}\0`) && stale !== key) loaded.delete(stale);
    }
    loaded.set(key, { image, bytes });
    let total = [...loaded.values()].reduce((sum, item) => sum + item.bytes, 0);
    for (const [oldKey, item] of loaded) {
      if (total <= LIMIT || oldKey === key) break;
      loaded.delete(oldKey);
      total -= item.bytes;
    }
    return image;
  });
  pending.set(key, task);
  try {
    return await task;
  } finally {
    if (pending.get(key) === task) pending.delete(key);
  }
}
