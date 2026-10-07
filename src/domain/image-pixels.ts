const LANCZOS_LOBES = 3;
export function applyExifOrientation(
  bitmap: Uint8Array,
  width: number,
  height: number,
  orientation: number,
) {
  if (orientation <= 1 || orientation > 8)
    return { bitmap: Uint8Array.from(bitmap), width, height };
  const swapsAxes = orientation >= 5;
  const outputWidth = swapsAxes ? height : width;
  const outputHeight = swapsAxes ? width : height;
  const output = new Uint8Array(outputWidth * outputHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let dx = x;
      let dy = y;
      if (orientation === 2) {
        dx = width - 1 - x;
      } else if (orientation === 3) {
        dx = width - 1 - x;
        dy = height - 1 - y;
      } else if (orientation === 4) {
        dy = height - 1 - y;
      } else if (orientation === 5) {
        dx = y;
        dy = x;
      } else if (orientation === 6) {
        dx = height - 1 - y;
        dy = x;
      } else if (orientation === 7) {
        dx = height - 1 - y;
        dy = width - 1 - x;
      } else if (orientation === 8) {
        dx = y;
        dy = width - 1 - x;
      }
      const sourceIndex = (y * width + x) * 4;
      const targetIndex = (dy * outputWidth + dx) * 4;
      output.set(bitmap.subarray(sourceIndex, sourceIndex + 4), targetIndex);
    }
  }
  return { bitmap: output, width: outputWidth, height: outputHeight };
}

function sinc(value: number) {
  if (Math.abs(value) < 1e-8) return 1;
  const x = Math.PI * value;
  return Math.sin(x) / x;
}

function lanczos(value: number) {
  const absolute = Math.abs(value);
  return absolute >= LANCZOS_LOBES ? 0 : sinc(value) * sinc(value / LANCZOS_LOBES);
}

type Contribution = Array<{ index: number; weight: number }>;

function buildContributions(sourceSize: number, targetSize: number): Contribution[] {
  const scale = targetSize / sourceSize;
  const filterScale = Math.min(1, scale);
  const support = LANCZOS_LOBES / filterScale;
  return Array.from({ length: targetSize }, (_, targetIndex) => {
    const center = (targetIndex + 0.5) / scale - 0.5;
    const left = Math.ceil(center - support);
    const right = Math.floor(center + support);
    const weights = new Map<number, number>();
    let sum = 0;
    for (let sourceIndex = left; sourceIndex <= right; sourceIndex++) {
      const weight = lanczos((center - sourceIndex) * filterScale) * filterScale;
      if (weight === 0) continue;
      const clamped = Math.max(0, Math.min(sourceSize - 1, sourceIndex));
      weights.set(clamped, (weights.get(clamped) ?? 0) + weight);
      sum += weight;
    }
    if (Math.abs(sum) < 1e-12) {
      const nearest = Math.max(0, Math.min(sourceSize - 1, Math.round(center)));
      return [{ index: nearest, weight: 1 }];
    }
    return [...weights.entries()].map(([index, weight]) => ({ index, weight: weight / sum }));
  });
}

function horizontalPass(
  input: ArrayLike<number>,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
) {
  const contributions = buildContributions(sourceWidth, targetWidth);
  const output = new Float32Array(targetWidth * sourceHeight * 4);
  for (let y = 0; y < sourceHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const targetIndex = (y * targetWidth + x) * 4;
      for (const { index, weight } of contributions[x]) {
        const sourceIndex = (y * sourceWidth + index) * 4;
        for (let channel = 0; channel < 4; channel++)
          output[targetIndex + channel] += input[sourceIndex + channel] * weight;
      }
    }
  }
  return output;
}

function verticalPass(
  input: ArrayLike<number>,
  width: number,
  sourceHeight: number,
  targetHeight: number,
) {
  const contributions = buildContributions(sourceHeight, targetHeight);
  const output = new Float32Array(width * targetHeight * 4);
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < width; x++) {
      const targetIndex = (y * width + x) * 4;
      for (const { index, weight } of contributions[y]) {
        const sourceIndex = (index * width + x) * 4;
        for (let channel = 0; channel < 4; channel++)
          output[targetIndex + channel] += input[sourceIndex + channel] * weight;
      }
    }
  }
  return output;
}

function floatsToBitmap(input: Float32Array) {
  const output = new Uint8Array(input.length);
  for (let index = 0; index < input.length; index++)
    output[index] = Math.max(0, Math.min(255, Math.round(input[index])));
  return output;
}

export function resizeLanczosBitmap(
  bitmap: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
) {
  if (
    sourceWidth < 1 ||
    sourceHeight < 1 ||
    targetWidth < 1 ||
    targetHeight < 1 ||
    bitmap.length !== sourceWidth * sourceHeight * 4
  )
    throw new Error('Invalid bitmap resize dimensions.');
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return new Uint8Array(bitmap);

  const horizontalFirst = targetWidth * sourceHeight <= sourceWidth * targetHeight;
  if (horizontalFirst) {
    const horizontal = horizontalPass(bitmap, sourceWidth, sourceHeight, targetWidth);
    return floatsToBitmap(verticalPass(horizontal, targetWidth, sourceHeight, targetHeight));
  }
  const vertical = verticalPass(bitmap, sourceWidth, sourceHeight, targetHeight);
  return floatsToBitmap(horizontalPass(vertical, sourceWidth, targetHeight, targetWidth));
}

export function compositeBitmapOnWhite(bitmap: Uint8Array) {
  const output = new Uint8Array(bitmap);
  for (let index = 0; index < output.length; index += 4) {
    const alpha = output[index + 3] / 255;
    output[index] = Math.round(output[index] * alpha + 255 * (1 - alpha));
    output[index + 1] = Math.round(output[index + 1] * alpha + 255 * (1 - alpha));
    output[index + 2] = Math.round(output[index + 2] * alpha + 255 * (1 - alpha));
    output[index + 3] = 255;
  }
  return output;
}
