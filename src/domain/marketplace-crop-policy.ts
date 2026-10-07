import type { MarketplaceCropRect } from './artifact-types.js';
export function fitCrop(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): MarketplaceCropRect {
  const targetAspect = outputWidth / outputHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  const width = sourceAspect > targetAspect ? sourceHeight * targetAspect : sourceWidth;
  const height = sourceAspect > targetAspect ? sourceHeight : sourceWidth / targetAspect;
  return {
    x: (sourceWidth - width) / 2,
    y: (sourceHeight - height) / 2,
    width,
    height,
  };
}

export function clampCrop(
  crop: MarketplaceCropRect,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): MarketplaceCropRect {
  const fit = fitCrop(sourceWidth, sourceHeight, outputWidth, outputHeight);
  const aspect = outputWidth / outputHeight;
  let width = Math.max(fit.width / 5, Math.min(fit.width, crop.width));
  let height = width / aspect;
  if (height > fit.height) {
    height = Math.max(fit.height / 5, Math.min(fit.height, crop.height));
    width = height * aspect;
  }
  const x = Math.max(0, Math.min(sourceWidth - width, crop.x));
  const y = Math.max(0, Math.min(sourceHeight - height, crop.y));
  return { x, y, width, height };
}

export function normalizeCrop(
  crop: MarketplaceCropRect | null,
  source: { width: number; height: number },
  outputWidth: number,
  outputHeight: number,
) {
  return crop
    ? clampCrop(crop, source.width, source.height, outputWidth, outputHeight)
    : fitCrop(source.width, source.height, outputWidth, outputHeight);
}
