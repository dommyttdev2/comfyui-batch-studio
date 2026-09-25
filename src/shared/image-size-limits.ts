// Estimate decoded RGBA and Lanczos intermediate buffers before allocating them.
export const MAX_IMAGE_WORKING_BYTES = 768 * 1024 * 1024;

function megabytes(bytes: number) {
  return Math.ceil(bytes / (1024 * 1024));
}

export function assertInputDimensions(width: number, height: number, compressedBytes = 0) {
  const estimated = width * height * 16 + compressedBytes;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isFinite(estimated) ||
    estimated > MAX_IMAGE_WORKING_BYTES
  )
    throw new Error(
      `入力画像 ${width}×${height}px は作業メモリ約${megabytes(estimated)}MBを要します。上限${megabytes(MAX_IMAGE_WORKING_BYTES)}MB以内の画像に縮小してください。`,
    );
}

export function assertOutputDimensions(width: number, height: number) {
  const estimated = width * height * 24;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    !Number.isFinite(estimated) ||
    estimated > MAX_IMAGE_WORKING_BYTES
  )
    throw new Error(
      `出力 ${width}×${height}px は作業メモリ約${megabytes(estimated)}MBを要します。幅と高さを小さくしてください（上限${megabytes(MAX_IMAGE_WORKING_BYTES)}MB）。`,
    );
}

export function assertRenderBudget(
  sourceWidth: number,
  sourceHeight: number,
  cropWidth: number,
  cropHeight: number,
  outputWidth: number,
  outputHeight: number,
) {
  assertInputDimensions(sourceWidth, sourceHeight);
  assertOutputDimensions(outputWidth, outputHeight);
  const intermediate = Math.min(outputWidth * cropHeight, cropWidth * outputHeight);
  const estimated =
    sourceWidth * sourceHeight * 12 +
    cropWidth * cropHeight * 8 +
    intermediate * 16 +
    outputWidth * outputHeight * 12;
  if (estimated > MAX_IMAGE_WORKING_BYTES)
    throw new Error(
      `入力 ${sourceWidth}×${sourceHeight}px、出力 ${outputWidth}×${outputHeight}px の変換には作業メモリ約${megabytes(estimated)}MBが必要です。画像または出力サイズを縮小してください。`,
    );
}
