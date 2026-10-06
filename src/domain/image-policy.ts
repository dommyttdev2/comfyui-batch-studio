import { BusinessError } from './contracts.js';
export const MAX_IMAGE_WORKING_BYTES = 768 * 1024 * 1024;
export interface RenderSize {
  sourceWidth: number;
  sourceHeight: number;
  cropWidth: number;
  cropHeight: number;
  outputWidth: number;
  outputHeight: number;
}
export function assertRenderSize(size: RenderSize): void {
  const {
    sourceWidth: sw,
    sourceHeight: sh,
    cropWidth: cw,
    cropHeight: ch,
    outputWidth: ow,
    outputHeight: oh,
  } = size;
  if (!Object.values(size).every((v) => Number.isSafeInteger(v) && v > 0) || cw > sw || ch > sh)
    throw new BusinessError('INVALID_INPUT', 'Image dimensions or crop are invalid.');
  const bytes = sw * sh * 12 + cw * ch * 8 + Math.min(ow * ch, cw * oh) * 16 + ow * oh * 24;
  if (
    sw * sh * 16 > MAX_IMAGE_WORKING_BYTES ||
    ow * oh * 24 > MAX_IMAGE_WORKING_BYTES ||
    !Number.isFinite(bytes) ||
    bytes > MAX_IMAGE_WORKING_BYTES
  )
    throw new BusinessError('INVALID_INPUT', 'Image exceeds the working memory budget.');
}
