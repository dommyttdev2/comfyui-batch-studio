const EXIF_TAG_ORIENTATION = 0x0112;
const LANCZOS_LOBES = 3;

function tiffOrientation(bytes: Buffer, baseOffset = 0): number {
  if (bytes.length - baseOffset < 8) return 1;
  const littleEndian =
    bytes[baseOffset] === 0x49 &&
    bytes[baseOffset + 1] === 0x49;
  const bigEndian =
    bytes[baseOffset] === 0x4d &&
    bytes[baseOffset + 1] === 0x4d;
  if (!littleEndian && !bigEndian) return 1;

  const read16 = (offset: number) => {
    if (offset < 0 || offset + 2 > bytes.length) return null;
    return littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  };
  const read32 = (offset: number) => {
    if (offset < 0 || offset + 4 > bytes.length) return null;
    return littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  };

  if (read16(baseOffset + 2) !== 42) return 1;
  const ifdOffset = read32(baseOffset + 4);
  if (ifdOffset == null) return 1;
  const ifd = baseOffset + ifdOffset;
  const count = read16(ifd);
  if (count == null) return 1;

  for (let index = 0; index < count; index++) {
    const entry = ifd + 2 + index * 12;
    if (entry + 12 > bytes.length) break;
    const tag = read16(entry);
    if (tag !== EXIF_TAG_ORIENTATION) continue;
    const type = read16(entry + 2);
    const valueCount = read32(entry + 4);
    if (type !== 3 || valueCount !== 1) return 1;
    const orientation = read16(entry + 8);
    return orientation != null && orientation >= 1 && orientation <= 8 ? orientation : 1;
  }
  return 1;
}

function exifPayloadOrientation(payload: Buffer) {
  const exifHeader = Buffer.from([0x45, 0x78, 0x69, 0x66, 0, 0]);
  return payload.subarray(0, 6).equals(exifHeader)
    ? tiffOrientation(payload, 6)
    : tiffOrientation(payload, 0);
}

function jpegOrientation(bytes: Buffer) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return 1;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if (marker === 0xe1) {
      const orientation = exifPayloadOrientation(bytes.subarray(offset + 2, offset + length));
      if (orientation !== 1) return orientation;
    }
    offset += length;
  }
  return 1;
}

function pngOrientation(bytes: Buffer) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(signature)) return 1;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) break;
    if (type === 'eXIf') return exifPayloadOrientation(bytes.subarray(dataStart, dataEnd));
    offset = dataEnd + 4;
  }
  return 1;
}

function webpOrientation(bytes: Buffer) {
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WEBP'
  )
    return 1;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;
    if (type === 'EXIF') return exifPayloadOrientation(bytes.subarray(dataStart, dataEnd));
    offset = dataEnd + (length % 2);
  }
  return 1;
}

export function parseExifOrientation(bytes: Buffer) {
  const jpeg = jpegOrientation(bytes);
  if (jpeg !== 1) return jpeg;
  const png = pngOrientation(bytes);
  if (png !== 1) return png;
  return webpOrientation(bytes);
}

export function applyExifOrientation(
  bitmap: Buffer,
  width: number,
  height: number,
  orientation: number,
) {
  if (orientation <= 1 || orientation > 8)
    return { bitmap: Buffer.from(bitmap), width, height };
  const swapsAxes = orientation >= 5;
  const outputWidth = swapsAxes ? height : width;
  const outputHeight = swapsAxes ? width : height;
  const output = Buffer.alloc(outputWidth * outputHeight * 4);

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
      bitmap.copy(output, targetIndex, sourceIndex, sourceIndex + 4);
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
  const output = Buffer.alloc(input.length);
  for (let index = 0; index < input.length; index++)
    output[index] = Math.max(0, Math.min(255, Math.round(input[index])));
  return output;
}

export function resizeLanczosBitmap(
  bitmap: Buffer,
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
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return Buffer.from(bitmap);

  const horizontalFirst = targetWidth * sourceHeight <= sourceWidth * targetHeight;
  if (horizontalFirst) {
    const horizontal = horizontalPass(bitmap, sourceWidth, sourceHeight, targetWidth);
    return floatsToBitmap(verticalPass(horizontal, targetWidth, sourceHeight, targetHeight));
  }
  const vertical = verticalPass(bitmap, sourceWidth, sourceHeight, targetHeight);
  return floatsToBitmap(horizontalPass(vertical, sourceWidth, targetHeight, targetWidth));
}

export function compositeBitmapOnWhite(bitmap: Buffer) {
  const output = Buffer.from(bitmap);
  for (let index = 0; index < output.length; index += 4) {
    const alpha = output[index + 3] / 255;
    output[index] = Math.round(output[index] * alpha + 255 * (1 - alpha));
    output[index + 1] = Math.round(output[index + 1] * alpha + 255 * (1 - alpha));
    output[index + 2] = Math.round(output[index + 2] * alpha + 255 * (1 - alpha));
    output[index + 3] = 255;
  }
  return output;
}
