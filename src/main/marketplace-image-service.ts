import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nativeImage } from 'electron';
import type {
  MarketplaceCropRect,
  MarketplaceGenerationResult,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
  MarketplaceSourceType,
} from '../shared/types.js';
import { readJson, withTemplateStoreLock, writeJsonAtomic } from './fs-utils.js';
import { assertFinalArtifactImage, readImageSource, readImagePreview } from './final-artifact-image-service.js';
import { assertExportedThumbnail } from './thumbnail-service.js';
import {
  fingerprintMarketplaceSource,
  marketplaceInputSignature,
  MARKETPLACE_REGENERATION_REQUIRED,
  sha256Bytes,
  validateMarketplaceGeneration,
  verifiedMarketplaceOutput,
  type MarketplaceGenerationManifest,
  type MarketplaceGeneratedOutput,
} from './marketplace-generation-manifest.js';
import {
  encodeLanczosImage,
  readOrientedNativeImage,
  renderLanczosCrop,
} from './image-pipeline.js';

const MAX_INPUT_BYTES = 100 * 1024 * 1024;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TARGETS_PATH = path.resolve(__dirname, '../marketplace-image-targets.json');
const FORMAT_EXTENSIONS: Record<MarketplaceOutputFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
};

interface MarketplaceTargetCatalog {
  schemaVersion: 1;
  targets: MarketplaceImageTarget[];
}

function finite(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function cropFromUnknown(value: unknown): MarketplaceCropRect | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<MarketplaceCropRect>;
  if (
    typeof candidate.x !== 'number' ||
    !Number.isFinite(candidate.x) ||
    typeof candidate.y !== 'number' ||
    !Number.isFinite(candidate.y) ||
    typeof candidate.width !== 'number' ||
    !Number.isFinite(candidate.width) ||
    typeof candidate.height !== 'number' ||
    !Number.isFinite(candidate.height) ||
    candidate.width <= 0 ||
    candidate.height <= 0
  )
    return null;
  return {
    x: Math.max(0, candidate.x),
    y: Math.max(0, candidate.y),
    width: candidate.width,
    height: candidate.height,
  };
}

export async function getMarketplaceImageTargets(): Promise<MarketplaceImageTarget[]> {
  const raw = JSON.parse(await readFile(TARGETS_PATH, 'utf8')) as MarketplaceTargetCatalog;
  if (
    raw?.schemaVersion !== 1 ||
    !Array.isArray(raw.targets) ||
    raw.targets.length < 1 ||
    raw.targets.some(
      (target) =>
        !target ||
        typeof target.id !== 'string' ||
        typeof target.service !== 'string' ||
        typeof target.imageType !== 'string' ||
        typeof target.label !== 'string' ||
        !Number.isInteger(target.width) ||
        target.width < 1 ||
        !Number.isInteger(target.height) ||
        target.height < 1 ||
        typeof target.fileName !== 'string',
    )
  )
    throw new Error('販売サイト用画像のターゲット定義が不正です。');
  // Read the current catalog when generating or exporting: target dimensions may change.
  return raw.targets.map((target) => ({ ...target }));
}

function statePath(root: string) {
  return path.join(root, '._batch_studio', 'marketplace-images.json');
}

export async function createDefaultMarketplaceImageState(): Promise<MarketplaceImageEditorState> {
  const targets = await getMarketplaceImageTargets();
  return {
    schemaVersion: 1,
    sourceImagePath: '',
    sourceType: 'final-artifact',
    mode: 'marketplace',
    activeTargetId: targets[0]?.id ?? '',
    format: 'jpeg',
    targets: Object.fromEntries(targets.map((target) => [target.id, { crop: null }])),
    custom: {
      width: 1024,
      height: 1024,
      lockAspect: true,
      crop: null,
    },
  };
}

export async function normalizeMarketplaceImageState(
  value: unknown,
): Promise<MarketplaceImageEditorState> {
  const defaults = await createDefaultMarketplaceImageState();
  const targets = await getMarketplaceImageTargets();
  const candidate =
    value && typeof value === 'object' ? (value as Partial<MarketplaceImageEditorState>) : {};
  const format: MarketplaceOutputFormat =
    candidate.format === 'png' || candidate.format === 'webp' || candidate.format === 'jpeg'
      ? candidate.format
      : 'jpeg';
  const normalizedTargets: MarketplaceImageEditorState['targets'] = {};
  for (const target of targets) {
    const raw =
      candidate.targets && typeof candidate.targets === 'object'
        ? candidate.targets[target.id]
        : undefined;
    normalizedTargets[target.id] = {
      crop:
        raw && typeof raw === 'object' ? cropFromUnknown((raw as { crop?: unknown }).crop) : null,
    };
  }
  const activeTargetId = targets.some((target) => target.id === candidate.activeTargetId)
    ? (candidate.activeTargetId as string)
    : defaults.activeTargetId;
  const custom =
    candidate.custom && typeof candidate.custom === 'object' ? candidate.custom : defaults.custom;
  return {
    schemaVersion: 1,
    ...(typeof candidate.saveRevision === 'number' &&
    Number.isSafeInteger(candidate.saveRevision) &&
    candidate.saveRevision >= 0
      ? { saveRevision: candidate.saveRevision }
      : {}),
    sourceImagePath: typeof candidate.sourceImagePath === 'string' ? candidate.sourceImagePath : '',
    sourceType: candidate.sourceType === 'thumbnail' ? 'thumbnail' : 'final-artifact',
    mode: candidate.mode === 'custom' ? 'custom' : 'marketplace',
    activeTargetId,
    format,
    targets: normalizedTargets,
    custom: {
      width: Math.round(finite(custom.width, 1024, 1, 20000)),
      height: Math.round(finite(custom.height, 1024, 1, 20000)),
      lockAspect: custom.lockAspect !== false,
      crop: cropFromUnknown(custom.crop),
    },
  };
}

export async function loadMarketplaceImageState(root: string) {
  return normalizeMarketplaceImageState(await readJson<unknown>(statePath(root)));
}

export async function saveMarketplaceImageState(root: string, value: unknown) {
  const normalized = await normalizeMarketplaceImageState(value);
  const file = statePath(root);
  return withTemplateStoreLock(file, async () => {
    const current = await readJson<MarketplaceImageEditorState>(file);
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

function clampCrop(
  crop: MarketplaceCropRect | null,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
) {
  if (!crop) throw new Error('クロップ範囲が設定されていません。');
  const expectedAspect = outputWidth / outputHeight;
  let width = Math.max(1, Math.min(sourceWidth, Math.round(crop.width)));
  let height = Math.max(1, Math.min(sourceHeight, Math.round(crop.height)));
  if (Math.abs(width / height - expectedAspect) > 0.01) {
    if (width / height > expectedAspect) width = Math.max(1, Math.round(height * expectedAspect));
    else height = Math.max(1, Math.round(width / expectedAspect));
  }
  if (width > sourceWidth || height > sourceHeight)
    throw new Error('クロップ範囲が元画像より大きくなっています。');
  const x = Math.max(0, Math.min(sourceWidth - width, Math.round(crop.x)));
  const y = Math.max(0, Math.min(sourceHeight - height, Math.round(crop.y)));
  return { x, y, width, height };
}

function normalizedPngImage(dataUrl: string | undefined) {
  if (!dataUrl || !dataUrl.startsWith('data:image/png;base64,'))
    throw new Error('WebP入力画像の正規化PNGデータが不足しています。');
  const bytes = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  if (!bytes.length || bytes.length > 200 * 1024 * 1024)
    throw new Error('WebP入力画像の正規化PNGデータが不正です。');
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('WebP入力画像の正規化PNGを読み込めませんでした。');
  return image;
}

export async function assertMarketplaceSource(root: string, imagePath: string, sourceType: MarketplaceSourceType) {
  return sourceType === 'thumbnail'
    ? assertExportedThumbnail(root, imagePath)
    : assertFinalArtifactImage(root, imagePath);
}

export async function readMarketplaceSource(root: string, imagePath: string, sourceType: MarketplaceSourceType) {
  return readImageSource(await assertMarketplaceSource(root, imagePath, sourceType));
}

export async function readMarketplaceSourcePreview(root: string, imagePath: string, sourceType: MarketplaceSourceType) {
  return readImagePreview(await assertMarketplaceSource(root, imagePath, sourceType));
}

async function loadSource(root: string, sourceImagePath: string, sourcePngDataUrl?: string, sourceType: MarketplaceSourceType = 'final-artifact') {
  if (!sourceImagePath) throw new Error('入力画像を選択してください。');
  const resolved = await assertMarketplaceSource(root, sourceImagePath, sourceType);
  const info = await stat(resolved);
  if (!info.isFile()) throw new Error('入力画像が見つかりません。');
  if (info.size > MAX_INPUT_BYTES) throw new Error('入力画像は100MB以下にしてください。');

  if (path.extname(resolved).toLowerCase() === '.webp') {
    const image = normalizedPngImage(sourcePngDataUrl);
    return { resolved, image, size: image.getSize() };
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

function generationManifestPath(root: string) {
  return path.join(root, 'marketplace', '._generation-manifest.json');
}

export async function generateMarketplaceImages(
  root: string,
  value: unknown,
  webpDataUrls?: Record<string, string>,
  sourcePngDataUrl?: string,
): Promise<MarketplaceGenerationResult> {
  const state = await saveMarketplaceImageState(root, value);
  const targets = await getMarketplaceImageTargets();
  const { resolved, image, size } = await loadSource(root, state.sourceImagePath, sourcePngDataUrl, state.sourceType);
  const source = await fingerprintMarketplaceSource(resolved);
  const inputSignature = marketplaceInputSignature(state, targets);
  const outputDirectory = path.join(root, 'marketplace');
  const extension = FORMAT_EXTENSIONS[state.format];
  const outputPaths: string[] = [];
  const staged: Array<{ outputPath: string; bytes: Buffer }> = [];
  const outputs: MarketplaceGeneratedOutput[] = [];

  // A previous successful manifest must never certify a partial new generation.
  await rm(generationManifestPath(root), { force: true });
  for (const target of targets) {
    const crop = clampCrop(
      state.targets[target.id]?.crop ?? null,
      size.width,
      size.height,
      target.width,
      target.height,
    );
    const relativePath = `${target.service}/${target.fileName}.${extension}`;
    const outputPath = path.join(
      outputDirectory,
      target.service,
      `${target.fileName}.${extension}`,
    );
    const bytes =
      state.format === 'webp'
        ? webpBuffer(webpDataUrls?.[target.id])
        : encodeLanczosImage(
            renderLanczosCrop(image, crop, target.width, target.height),
            state.format,
          );
    staged.push({ outputPath, bytes });
    outputs.push({
      targetId: target.id,
      relativePath,
      size: bytes.length,
      sha256: sha256Bytes(bytes),
    });
    outputPaths.push(outputPath);
  }

  // Revalidate after rendering; edits or source replacement during processing cannot
  // turn four images from an old input into a newly certified generation.
  const sourceAfter = await fingerprintMarketplaceSource(resolved);
  const persisted = await loadMarketplaceImageState(root);
  if (
    JSON.stringify(source) !== JSON.stringify(sourceAfter) ||
    marketplaceInputSignature(persisted, targets) !== inputSignature
  )
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  for (const { outputPath, bytes } of staged) await writeAtomic(outputPath, bytes);
  const manifest: MarketplaceGenerationManifest = {
    schemaVersion: 1,
    generationId: randomUUID(),
    generatedAt: new Date().toISOString(),
    source,
    format: state.format,
    inputSignature,
    outputs,
  };
  // The manifest is the commit marker. ZIP generation accepts only a complete,
  // content-verified set of outputs with the same generation identity.
  await writeJsonAtomic(generationManifestPath(root), manifest);
  return { outputDirectory, outputPaths, zipPath: null };
}

export async function exportCustomMarketplaceImage(
  root: string,
  value: unknown,
  webpDataUrl?: string,
  sourcePngDataUrl?: string,
): Promise<MarketplaceGenerationResult> {
  const state = await saveMarketplaceImageState(root, value);
  const { image, size } = await loadSource(root, state.sourceImagePath, sourcePngDataUrl, state.sourceType);
  const crop = clampCrop(
    state.custom.crop,
    size.width,
    size.height,
    state.custom.width,
    state.custom.height,
  );
  const extension = FORMAT_EXTENSIONS[state.format];
  const outputDirectory = path.join(root, 'marketplace', 'custom');
  const outputPath = path.join(outputDirectory, `custom-output.${extension}`);
  const bytes =
    state.format === 'webp'
      ? webpBuffer(webpDataUrl)
      : encodeLanczosImage(
          renderLanczosCrop(image, crop, state.custom.width, state.custom.height),
          state.format,
        );
  await writeAtomic(outputPath, bytes);
  return { outputDirectory, outputPaths: [outputPath], zipPath: null };
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
  const state =
    currentEditorState === undefined
      ? await loadMarketplaceImageState(root)
      : await normalizeMarketplaceImageState(currentEditorState);
  const targets = await getMarketplaceImageTargets();
  const extension = FORMAT_EXTENSIONS[normalizedFormat];
  const outputDirectory = path.join(root, 'marketplace');
  const manifest = await readJson<MarketplaceGenerationManifest>(generationManifestPath(root));
  if (state.format !== normalizedFormat || !manifest)
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  const sourcePath = await assertMarketplaceSource(root, state.sourceImagePath, state.sourceType).catch(() => {
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  });
  const source = await fingerprintMarketplaceSource(sourcePath).catch(() => {
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  });
  validateMarketplaceGeneration(manifest, state, targets, source);

  const entries: Array<{ name: string; bytes: Buffer }> = [];
  const outputPaths: string[] = [];
  for (const [index, target] of targets.entries()) {
    const verified = await verifiedMarketplaceOutput(
      outputDirectory,
      manifest.outputs[index],
      target,
      extension,
    );
    entries.push({ name: verified.relativePath, bytes: verified.bytes });
    outputPaths.push(verified.targetPath);
  }

  // Source and generation may change while the four files are read.
  const sourceAfter = await fingerprintMarketplaceSource(sourcePath);
  const currentManifest = await readJson<MarketplaceGenerationManifest>(
    generationManifestPath(root),
  );
  validateMarketplaceGeneration(currentManifest, state, targets, sourceAfter);
  if (currentManifest?.generationId !== manifest.generationId)
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  const zipPath = path.join(outputDirectory, 'marketplace-images.zip');
  await writeAtomic(zipPath, storedZip(entries));
  return { outputDirectory, outputPaths, zipPath };
}
