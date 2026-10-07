import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { type NativeImage, nativeImage } from 'electron';
import {
  type CustomMarketplaceIO,
  generateCustomMarketplaceOutput,
  generateMarketplaceOutputs,
  packageMarketplaceOutputs,
} from '../application/marketplace-generation.js';
import {
  validateMarketplaceTargets,
  validMarketplaceState,
} from '../domain/marketplace-editor-policy.js';
import { assertInputDimensions, assertOutputDimensions } from '../shared/image-size-limits.js';
import type {
  MarketplaceCropRect,
  MarketplaceGenerationResult,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
  MarketplaceSourceType,
} from '../shared/types.js';
import {
  assertFinalArtifactImage,
  readImagePreview,
  readImageSource,
} from './final-artifact-image-service.js';
import {
  initializeCorruptProtectedJson,
  PersistedJsonError,
  readJson,
  restoreValidatedJsonFromBackup,
  withTemplateStoreLock,
  writeJsonAtomic,
} from './fs-utils.js';
import { encodedImageDimensions } from './image-dimensions.js';
import {
  encodeLanczosImage,
  readOrientedNativeImage,
  renderLanczosCrop,
} from './image-pipeline.js';
import {
  fingerprintMarketplaceSource,
  MARKETPLACE_REGENERATION_REQUIRED,
  type MarketplaceGeneratedOutput,
  type MarketplaceGenerationManifest,
  marketplaceInputSignature,
  sha256Bytes,
  validateMarketplaceGeneration,
  verifiedMarketplaceOutput,
} from './marketplace-generation-manifest.js';
import { readProjectMeta } from './project-meta.js';
import { readCachedThumbnailImage, type ThumbnailCacheTiming } from './thumbnail-image-cache.js';
import { assertExportedThumbnail } from './thumbnail-service.js';
import { cleanupTrackedOutput } from './tracked-output-cleanup.js';

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGETS_PATH = path.resolve(__dirname, '../marketplace-image-targets.json');
export async function getMarketplaceImageTargets(): Promise<MarketplaceImageTarget[]> {
  return validateMarketplaceTargets(JSON.parse(await readFile(TARGETS_PATH, 'utf8')));
}

function statePath(root: string) {
  return path.join(root, '._batch_studio', 'marketplace-images.json');
}

function assertMarketplaceState(
  value: unknown,
  file: string,
): asserts value is MarketplaceImageEditorState {
  if (!validMarketplaceState(value))
    throw new PersistedJsonError(
      'PERSISTED_JSON_CORRUPT',
      file,
      'Marketplace editor state has an invalid structure',
    );
}

import {
  clampCrop,
  createDefaultMarketplaceImageState as defaultState,
  finite,
  normalizeMarketplaceImageState as normalizeState,
} from '../domain/marketplace-editor-policy.js';
export async function createDefaultMarketplaceImageState() {
  return defaultState(await getMarketplaceImageTargets());
}
export async function normalizeMarketplaceImageState(value: unknown) {
  return normalizeState(value, await getMarketplaceImageTargets());
}
export async function loadMarketplaceImageState(root: string) {
  const file = statePath(root);
  const stored = await readJson<unknown>(file);
  if (stored !== null) assertMarketplaceState(stored, file);
  return normalizeMarketplaceImageState(stored);
}

export async function restoreMarketplaceImageState(root: string) {
  const file = statePath(root);
  return withTemplateStoreLock(file, async () => {
    try {
      await loadMarketplaceImageState(root);
    } catch (error) {
      if (!(error instanceof PersistedJsonError)) throw error;
      await restoreValidatedJsonFromBackup(file, assertMarketplaceState);
      return loadMarketplaceImageState(root);
    }
    throw new Error('編集データは正常です。復元は必要ありません。');
  });
}

export async function initializeCorruptMarketplaceImageState(root: string) {
  const file = statePath(root);
  return withTemplateStoreLock(file, async () => {
    try {
      await loadMarketplaceImageState(root);
    } catch (error) {
      if (!(error instanceof PersistedJsonError) || error.code !== 'PERSISTED_JSON_CORRUPT')
        throw error;
      await initializeCorruptProtectedJson(file, await createDefaultMarketplaceImageState());
      return loadMarketplaceImageState(root);
    }
    throw new Error('編集データは正常です。初期化は必要ありません。');
  });
}

export async function saveMarketplaceImageState(root: string, value: unknown) {
  const normalized = await normalizeMarketplaceImageState(value);
  const file = statePath(root);
  return withTemplateStoreLock(file, async () => {
    const current = await readJson<MarketplaceImageEditorState>(file);
    if (current !== null) assertMarketplaceState(current, file);
    const lastRevision = current?.saveRevision ?? 0;
    if (normalized.saveRevision !== undefined && normalized.saveRevision < lastRevision)
      return normalizeMarketplaceImageState(current);
    if (
      normalized.saveRevision !== undefined &&
      normalized.saveRevision === lastRevision &&
      current
    ) {
      const proposed = { ...normalized, saveRevision: lastRevision };
      if (JSON.stringify(proposed) !== JSON.stringify(current))
        throw new Error('EDITOR_SAVE_CONFLICT: Marketplace state was modified by another editor.');
      return normalizeMarketplaceImageState(current);
    }
    const committed = {
      ...normalized,
      saveRevision: normalized.saveRevision ?? Math.max(lastRevision + 1, Date.now() * 1000),
    };
    await writeJsonAtomic(file, committed);
    return committed;
  });
}

function normalizedPngImage(dataUrl: string | undefined) {
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,'))
    throw new Error('WebP入力画像の正規化PNGデータが不足しています。');
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (!bytes.length || bytes.length > 200 * 1024 * 1024)
    throw new Error('WebP入力画像の正規化PNGデータが不正です。');
  const dimensions = encodedImageDimensions(bytes);
  if (dimensions) assertInputDimensions(dimensions.width, dimensions.height, bytes.length);
  const image = nativeImage.createFromBuffer(bytes);
  if (!image.isEmpty()) {
    const size = image.getSize();
    assertInputDimensions(size.width, size.height, bytes.length);
  }
  if (image.isEmpty()) throw new Error('WebP入力画像の正規化PNGを読み込めませんでした。');
  return image;
}

export async function assertMarketplaceSource(
  root: string,
  imagePath: string,
  sourceType: MarketplaceSourceType,
) {
  return sourceType === 'thumbnail'
    ? assertExportedThumbnail(root, imagePath)
    : assertFinalArtifactImage(root, imagePath);
}

export async function readMarketplaceSource(
  root: string,
  imagePath: string,
  sourceType: MarketplaceSourceType,
) {
  return readImageSource(await assertMarketplaceSource(root, imagePath, sourceType));
}

export async function readMarketplaceSourcePreview(
  root: string,
  imagePath: string,
  sourceType: MarketplaceSourceType,
  userDataRoot?: string,
  timing?: ThumbnailCacheTiming,
) {
  const resolved = await assertMarketplaceSource(root, imagePath, sourceType);
  if (userDataRoot) {
    const cached = await readCachedThumbnailImage(userDataRoot, resolved, 'gallery', timing);
    if (cached) return cached;
  }
  // WebP may require Chromium decoding. The picker scales this fallback to
  // 320px and stores it in the shared gallery cache for subsequent opens.
  return readImagePreview(resolved);
}

async function loadSource(
  root: string,
  sourceImagePath: string,
  sourcePngDataUrl?: string,
  sourceType: MarketplaceSourceType = 'final-artifact',
) {
  if (!sourceImagePath) throw new Error('入力画像を選択してください。');
  const resolved = await assertMarketplaceSource(root, sourceImagePath, sourceType);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('入力画像が見つかりません。');
  if (info.size > MAX_INPUT_BYTES) throw new Error('入力画像は100MB以下にしてください。');

  if (path.extname(resolved).toLowerCase() === '.webp') {
    const sourceBytes = await readFile(resolved);
    const sourceDimensions = encodedImageDimensions(sourceBytes);
    if (sourceDimensions)
      assertInputDimensions(sourceDimensions.width, sourceDimensions.height, sourceBytes.length);
    const image = normalizedPngImage(sourcePngDataUrl);
    const normalizedSize = image.getSize();
    if (
      sourceDimensions &&
      (sourceDimensions.width !== normalizedSize.width ||
        sourceDimensions.height !== normalizedSize.height)
    )
      throw new Error(
        `WebP入力画像の寸法 ${sourceDimensions.width}×${sourceDimensions.height}px と正規化画像 ${normalizedSize.width}×${normalizedSize.height}px が一致しません。画像を選択し直してください。`,
      );
    return { resolved, image, size: normalizedSize };
  }

  const oriented = await readOrientedNativeImage(resolved);
  return {
    resolved,
    image: oriented.image,
    size: { width: oriented.width, height: oriented.height },
  };
}

function webpBuffer(dataUrl: string | undefined) {
  if (!dataUrl || !dataUrl.startsWith('data:image/webp;base64,'))
    throw new Error('WebP画像データが不足しています。');
  const bytes = Buffer.from(dataUrl.slice('data:image/webp;base64,'.length), 'base64');
  const dimensions = encodedImageDimensions(bytes);
  if (dimensions) assertOutputDimensions(dimensions.width, dimensions.height);
  if (!bytes.length || bytes.length > 100 * 1024 * 1024)
    throw new Error('WebP画像データが不正です。');
  return bytes;
}

async function writeAtomic(outputPath: string, bytes: Buffer) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temp = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${randomUUID()}.tmp`,
  );
  await writeFile(temp, bytes);
  await rename(temp, outputPath);
}

export async function marketplaceOutputDirectory(root: string): Promise<string> {
  const meta = await readProjectMeta(root);
  const base = meta?.settings.artifactOutputPath?.trim();
  if (!base) throw new Error('成果物フォルダを設定してください。');
  return path.join(path.resolve(base), 'marketplace');
}

function generationManifestPath(outputDirectory: string) {
  return path.join(outputDirectory, '._generation-manifest.json');
}

export async function generateMarketplaceImages(
  root: string,
  value: unknown,
  webpDataUrls?: Record<string, string>,
  sourcePngDataUrl?: string,
): Promise<MarketplaceGenerationResult> {
  return generateMarketplaceOutputs(
    marketplaceGenerationIO(webpDataUrls, sourcePngDataUrl),
    root,
    value,
  );
}

function marketplaceGenerationIO(
  webpDataUrls?: Record<string, string>,
  sourcePngDataUrl?: string,
): CustomMarketplaceIO<NativeImage> {
  return {
    targets: getMarketplaceImageTargets,
    writeState: saveMarketplaceImageState,
    readState: loadMarketplaceImageState,
    loadSource: (projectId, state) =>
      loadSource(projectId, state.sourceImagePath, sourcePngDataUrl, state.sourceType),
    fingerprint: fingerprintMarketplaceSource,
    outputDirectory: marketplaceOutputDirectory,
    join: path.join,
    readManifest: (dir) => readJson<MarketplaceGenerationManifest>(generationManifestPath(dir)),
    removeManifest: (dir) => rm(generationManifestPath(dir), { force: true }),
    writeManifest: (dir, manifest) => writeJsonAtomic(generationManifestPath(dir), manifest),
    encode: async (image, crop, target, format) =>
      format === 'webp'
        ? webpBuffer(webpDataUrls?.[target.id])
        : encodeLanczosImage(renderLanczosCrop(image, crop, target.width, target.height), format),
    writeImage: (file, bytes) => writeAtomic(file, Buffer.from(bytes)),
    hashBytes: (bytes) => sha256Bytes(Buffer.from(bytes)),
    nextId: randomUUID,
    now: () => new Date().toISOString(),
    cleanupTrackedOutput,
    readTracked: (file) => readJson(file),
    writeTracked: writeJsonAtomic,
    cleanupCustom: cleanupTrackedOutput,
  };
}

export async function exportCustomMarketplaceImage(
  root: string,
  value: unknown,
  webpDataUrl?: string,
  sourcePngDataUrl?: string,
): Promise<MarketplaceGenerationResult> {
  return generateCustomMarketplaceOutput(
    marketplaceGenerationIO(webpDataUrl ? { custom: webpDataUrl } : undefined, sourcePngDataUrl),
    root,
    value,
  );
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function storedZip(entries: Array<{ name: string; bytes: Buffer }>) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const stamp = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name.replaceAll('\\', '/'), 'utf8');
    const crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.bytes.length, 18);
    local.writeUInt32LE(entry.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.bytes);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.bytes.length, 20);
    central.writeUInt32LE(entry.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.bytes.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

export async function renderMarketplacePng(
  root: string,
  sourceImagePath: string,
  cropValue: MarketplaceCropRect,
  widthValue: number,
  heightValue: number,
  sourcePngDataUrl?: string,
  sourceType: MarketplaceSourceType = 'final-artifact',
) {
  const width = Math.round(finite(widthValue, 1, 1, 20000));
  const height = Math.round(finite(heightValue, 1, 1, 20000));
  assertOutputDimensions(width, height);
  const { image, size } = await loadSource(root, sourceImagePath, sourcePngDataUrl, sourceType);
  const crop = clampCrop(cropValue, size.width, size.height, width, height);
  return renderLanczosCrop(image, crop, width, height).toDataURL();
}

export async function generateMarketplaceZip(
  root: string,
  format: unknown,
  currentEditorState?: unknown,
): Promise<MarketplaceGenerationResult> {
  const normalizedFormat: MarketplaceOutputFormat =
    format === 'png' || format === 'webp' || format === 'jpeg' ? format : 'jpeg';
  return packageMarketplaceOutputs(
    {
      targets: getMarketplaceImageTargets,
      readState: loadMarketplaceImageState,
      outputDirectory: marketplaceOutputDirectory,
      join: path.join,
      readManifest: (dir) => readJson<MarketplaceGenerationManifest>(generationManifestPath(dir)),
      resolveSource: (root, state) =>
        assertMarketplaceSource(root, state.sourceImagePath, state.sourceType),
      fingerprint: fingerprintMarketplaceSource,
      readBytes: (file) => readFile(file).catch(() => null),
      hashBytes: (bytes) => sha256Bytes(Buffer.from(bytes)),
      encodeZip: (entries) =>
        storedZip(entries.map((entry) => ({ ...entry, bytes: Buffer.from(entry.bytes) }))),
      writeBytes: (file, bytes) => writeAtomic(file, Buffer.from(bytes)),
    },
    root,
    normalizedFormat,
    currentEditorState,
  );
}
