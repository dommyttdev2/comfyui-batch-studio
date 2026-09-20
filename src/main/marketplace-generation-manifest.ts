import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  MarketplaceCropRect,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
} from '../shared/types.js';

export type MarketplaceSourceFingerprint = {
  path: string;
  size: number;
  mtimeMs: number;
  sha256: string;
};

export type MarketplaceGeneratedOutput = {
  targetId: string;
  relativePath: string;
  size: number;
  sha256: string;
};

export type MarketplaceGenerationManifest = {
  schemaVersion: 1;
  generationId: string;
  generatedAt: string;
  source: MarketplaceSourceFingerprint;
  format: MarketplaceOutputFormat;
  inputSignature: string;
  outputs: MarketplaceGeneratedOutput[];
};

export function sha256Bytes(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function fingerprintMarketplaceSource(file: string): Promise<MarketplaceSourceFingerprint> {
  const resolved = path.resolve(file);
  const before = await stat(resolved);
  if (!before.isFile()) throw new Error('入力画像が見つかりません。');
  const sha256 = await sha256File(resolved);
  const after = await stat(resolved);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new Error('入力画像が読み込み中に変更されました。もう一度生成してください。');
  return { path: resolved, size: after.size, mtimeMs: after.mtimeMs, sha256 };
}

function relevantCrop(crop: MarketplaceCropRect | null) {
  return crop
    ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height }
    : null;
}

export function marketplaceInputSignature(
  state: MarketplaceImageEditorState,
  targets: MarketplaceImageTarget[],
) {
  return JSON.stringify({
    targetCatalogVersion: 1,
    sourceImagePath: path.resolve(state.sourceImagePath),
    format: state.format,
    targets: targets.map((target) => ({
      id: target.id,
      service: target.service,
      fileName: target.fileName,
      width: target.width,
      height: target.height,
      crop: relevantCrop(state.targets[target.id]?.crop ?? null),
    })),
  });
}

export const MARKETPLACE_REGENERATION_REQUIRED =
  '入力画像・クロップ・出力形式・ターゲット定義または生成済み画像が変更されています。販売サイト用画像を4種類すべて再生成してください。';

export function validateMarketplaceGeneration(
  manifest: MarketplaceGenerationManifest | null,
  state: MarketplaceImageEditorState,
  targets: MarketplaceImageTarget[],
  source: MarketplaceSourceFingerprint,
) {
  if (
    !manifest ||
    manifest.schemaVersion !== 1 ||
    !/^[0-9a-f-]{36}$/i.test(manifest.generationId) ||
    manifest.format !== state.format ||
    manifest.inputSignature !== marketplaceInputSignature(state, targets) ||
    manifest.source.path !== source.path ||
    manifest.source.size !== source.size ||
    manifest.source.mtimeMs !== source.mtimeMs ||
    manifest.source.sha256 !== source.sha256 ||
    !Array.isArray(manifest.outputs) ||
    manifest.outputs.length !== targets.length
  )
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
}

export async function verifiedMarketplaceOutput(
  outputDirectory: string,
  expected: MarketplaceGeneratedOutput | undefined,
  target: MarketplaceImageTarget,
  extension: string,
) {
  const relativePath = `${target.service}/${target.fileName}.${extension}`;
  if (
    !expected ||
    expected.targetId !== target.id ||
    expected.relativePath !== relativePath ||
    !/^[0-9a-f]{64}$/.test(expected.sha256)
  )
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  const targetPath = path.join(outputDirectory, ...relativePath.split('/'));
  const bytes = await readFile(targetPath).catch(() => null);
  if (!bytes || bytes.length !== expected.size || sha256Bytes(bytes) !== expected.sha256)
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  return { targetPath, relativePath, bytes };
}
