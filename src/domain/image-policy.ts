import { BusinessError } from './contracts.js';

export { MAX_IMAGE_WORKING_BYTES } from './image-size-policy.js';

import { assertRenderBudget } from './image-size-policy.js';
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
  try {
    assertRenderBudget(sw, sh, cw, ch, ow, oh);
  } catch (error) {
    throw new BusinessError(
      'INVALID_INPUT',
      error instanceof Error ? error.message : 'Invalid image budget.',
    );
  }
}
