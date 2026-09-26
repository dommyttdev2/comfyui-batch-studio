const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-image-pipeline-'));
const compiled = path.join(runtime, 'compiled');
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', compiled],
  { cwd: repo, stdio: 'inherit' },
);

function pixelBuffer(values) {
  const bytes = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => {
    const offset = index * 4;
    bytes[offset] = value;
    bytes[offset + 1] = value;
    bytes[offset + 2] = value;
    bytes[offset + 3] = 255;
  });
  return bytes;
}

function redChannel(bitmap) {
  const values = [];
  for (let offset = 0; offset < bitmap.length; offset += 4) values.push(bitmap[offset]);
  return values;
}

function jpegWithOrientation(orientation) {
  const tiff = Buffer.alloc(26);
  tiff.write('II', 0, 'ascii');
  tiff.writeUInt16LE(42, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x0112, 10);
  tiff.writeUInt16LE(3, 12);
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt16LE(orientation, 18);
  tiff.writeUInt16LE(0, 20);
  tiff.writeUInt32LE(0, 22);

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(payload.length + 2, 0);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe1]),
    length,
    payload,
    Buffer.from([0xff, 0xd9]),
  ]);
}

(async () => {
  try {
    const modulePath = path.join(compiled, 'main', 'image-pipeline-core.js');
    const { encodedImageDimensions } = await import(
      pathToFileURL(path.join(compiled, 'main', 'image-dimensions.js')).href
    );
    const {
      MAX_IMAGE_WORKING_BYTES,
      assertInputDimensions,
      assertOutputDimensions,
      assertRenderBudget,
    } = await import(pathToFileURL(path.join(compiled, 'shared', 'image-size-limits.js')).href);
    const {
      applyExifOrientation,
      compositeBitmapOnWhite,
      parseExifOrientation,
      resizeLanczosBitmap,
    } = await import(pathToFileURL(modulePath).href);

    assert.equal(
      parseExifOrientation(jpegWithOrientation(6)),
      6,
      'JPEG EXIF orientation must be parsed from APP1 TIFF metadata',
    );

    const rotated = applyExifOrientation(pixelBuffer([10, 20, 30, 40, 50, 60]), 2, 3, 6);
    assert.equal(rotated.width, 3);
    assert.equal(rotated.height, 2);
    assert.deepEqual(
      redChannel(rotated.bitmap),
      [50, 30, 10, 60, 40, 20],
      'orientation 6 must rotate pixels 90 degrees clockwise',
    );

    const identityInput = pixelBuffer([10, 20, 30, 40]);
    const identity = resizeLanczosBitmap(identityInput, 2, 2, 2, 2);
    assert.deepEqual(identity, identityInput, 'same-size Lanczos rendering must preserve pixels');

    const solid = Buffer.alloc(4 * 4 * 4);
    for (let offset = 0; offset < solid.length; offset += 4) {
      solid[offset] = 31;
      solid[offset + 1] = 63;
      solid[offset + 2] = 127;
      solid[offset + 3] = 255;
    }
    const downscaled = resizeLanczosBitmap(solid, 4, 4, 2, 2);
    for (let offset = 0; offset < downscaled.length; offset += 4) {
      assert.deepEqual(
        [...downscaled.subarray(offset, offset + 4)],
        [31, 63, 127, 255],
        'Lanczos3 downscaling must preserve a constant-color image',
      );
    }

    const transparent = Buffer.from([0, 100, 200, 0, 20, 40, 60, 128]);
    assert.deepEqual(
      [...compositeBitmapOnWhite(transparent)],
      [255, 255, 255, 255, 137, 147, 157, 255],
      'JPEG compositing must flatten alpha onto white at quality 100 encoding time',
    );

    const png = Buffer.alloc(24);
    Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(20000, 16);
    png.writeUInt32BE(20000, 20);
    assert.deepEqual(encodedImageDimensions(png), { width: 20000, height: 20000 });
    assert.throws(() => assertInputDimensions(20000, 20000, png.length), /作業メモリ/);
    assert.throws(() => assertOutputDimensions(20000, 20000), /作業メモリ/);
    assert.doesNotThrow(() => assertInputDimensions(4000, 4000));
    assert.doesNotThrow(() => assertRenderBudget(4000, 4000, 560, 420, 560, 420));
    assert.throws(() => assertRenderBudget(4000, 4000, 4000, 4000, 20000, 20000));

    const shortJpegFrame = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x02, 0xff, 0xd9, 0, 0, 0, 0,
    ]);
    assert.equal(encodedImageDimensions(shortJpegFrame), null);
    const jpegFrame = Buffer.from([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x4e, 0x20, 0x4e, 0x20, 0xff, 0xd9,
    ]);
    assert.deepEqual(encodedImageDimensions(jpegFrame), { width: 20000, height: 20000 });
    const paddedJpeg = Buffer.concat([
      jpegFrame.subarray(0, 2),
      Buffer.from([0xff]),
      jpegFrame.subarray(2),
    ]);
    assert.deepEqual(encodedImageDimensions(paddedJpeg), { width: 20000, height: 20000 });
    for (let length = 0; length < jpegFrame.length; length++)
      assert.doesNotThrow(() => encodedImageDimensions(jpegFrame.subarray(0, length)));

    const inputPixels = MAX_IMAGE_WORKING_BYTES / 16;
    assert.doesNotThrow(() => assertInputDimensions(inputPixels, 1));
    assert.throws(() => assertInputDimensions(inputPixels, 1, 1));
    const outputPixels = MAX_IMAGE_WORKING_BYTES / 24;
    assert.doesNotThrow(() => assertOutputDimensions(outputPixels, 1));
    assert.throws(() => assertOutputDimensions(outputPixels + 1, 1));
    for (const invalid of [NaN, Infinity, -1, 0, 1.5]) {
      assert.throws(() => assertInputDimensions(invalid, 10));
      assert.throws(() => assertOutputDimensions(10, invalid));
      assert.throws(() => assertRenderBudget(10, 10, invalid, 10, 10, 10));
    }
    assert.throws(() => assertInputDimensions(10, 10, -1));
    assert.throws(() => assertRenderBudget(10, 10, 11, 10, 10, 10));
    // Both Float32 pass results and the final RGBA/native bitmap can overlap.
    assert.throws(() => assertRenderBudget(4000, 4000, 4000, 4000, 4100, 4000));

    const webp = Buffer.alloc(30);
    webp.write('RIFF', 0);
    webp.write('WEBP', 8);
    webp.write('VP8X', 12);
    webp.writeUIntLE(19999, 24, 3);
    webp.writeUIntLE(19999, 27, 3);
    assert.deepEqual(encodedImageDimensions(webp), { width: 20000, height: 20000 });
    const lossless = Buffer.alloc(25);
    lossless.write('RIFF', 0);
    lossless.write('WEBP', 8);
    lossless.write('VP8L', 12);
    lossless[20] = 0x2f;
    lossless.writeUInt32LE(16383 | (16383 << 14), 21);
    assert.deepEqual(encodedImageDimensions(lossless), { width: 16384, height: 16384 });
    assert.throws(() => assertInputDimensions(16384, 16384, lossless.length));
    for (let length = 0; length < webp.length; length++)
      assert.doesNotThrow(() => encodedImageDimensions(webp.subarray(0, length)));

    console.log('Image pipeline EXIF/Lanczos3 and memory limit tests passed.');
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
