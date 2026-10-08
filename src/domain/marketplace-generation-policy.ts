import type {
  MarketplaceCropRect,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
} from './artifact-types.js';
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

function relevantCrop(crop: MarketplaceCropRect | null) {
  return crop ? { x: crop.x, y: crop.y, width: crop.width, height: crop.height } : null;
}

export function marketplaceInputSignature(
  state: MarketplaceImageEditorState,
  targets: MarketplaceImageTarget[],
) {
  return JSON.stringify({
    targetCatalogVersion: 1,
    sourceImagePath: state.sourceImagePath,
    sourceType: state.sourceType ?? 'final-artifact',
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

export function assertMarketplaceOutput(
  expected: MarketplaceGeneratedOutput | undefined,
  target: MarketplaceImageTarget,
  extension: string,
  actual: { size: number; sha256: string } | null,
) {
  const relativePath = `${target.service}/${target.fileName}.${extension}`;
  if (
    !expected ||
    expected.targetId !== target.id ||
    expected.relativePath !== relativePath ||
    !/^[0-9a-f]{64}$/.test(expected.sha256) ||
    !actual ||
    actual.size !== expected.size ||
    actual.sha256 !== expected.sha256
  )
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  return relativePath;
}
