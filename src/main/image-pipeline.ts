import { readFile } from 'node:fs/promises';
import { nativeImage } from 'electron';
import type { MarketplaceCropRect } from '../shared/types.js';
import {
  applyExifOrientation,
  compositeBitmapOnWhite,
  parseExifOrientation,
  resizeLanczosBitmap,
} from './image-pipeline-core.js';

export async function readOrientedNativeImage(filePath: string) {
  const bytes = await readFile(filePath);
  const decoded = nativeImage.createFromBuffer(bytes);
  if (decoded.isEmpty()) throw new Error('画像を読み込めませんでした。');
  const size = decoded.getSize();
  const bitmap = decoded.toBitmap();
  if (bitmap.length !== size.width * size.height * 4)
    throw new Error('画像Bitmapのサイズが正しくありません。');
  const oriented = applyExifOrientation(
    bitmap,
    size.width,
    size.height,
    parseExifOrientation(bytes),
  );
  return {
    bytes,
    image: nativeImage.createFromBitmap(oriented.bitmap, {
      width: oriented.width,
      height: oriented.height,
      scaleFactor: 1,
    }),
    width: oriented.width,
    height: oriented.height,
  };
}

export function renderLanczosCrop(
  source: Electron.NativeImage,
  crop: MarketplaceCropRect,
  width: number,
  height: number,
) {
  const cropped = source.crop({
    x: Math.round(crop.x),
    y: Math.round(crop.y),
    width: Math.round(crop.width),
    height: Math.round(crop.height),
  });
  const sourceSize = cropped.getSize();
  const bitmap = cropped.toBitmap();
  const resized = resizeLanczosBitmap(
    bitmap,
    sourceSize.width,
    sourceSize.height,
    width,
    height,
  );
  return nativeImage.createFromBitmap(resized, { width, height, scaleFactor: 1 });
}

export function encodeLanczosImage(
  image: Electron.NativeImage,
  format: 'jpeg' | 'png',
) {
  if (format === 'png') return image.toPNG();
  const size = image.getSize();
  const opaque = compositeBitmapOnWhite(image.toBitmap());
  return nativeImage
    .createFromBitmap(opaque, { width: size.width, height: size.height, scaleFactor: 1 })
    .toJPEG(100);
}
