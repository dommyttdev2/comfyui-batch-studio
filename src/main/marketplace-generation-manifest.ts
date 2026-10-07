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

export function sha256Bytes(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

export async function sha256File(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function fingerprintMarketplaceSource(
  file: string,
): Promise<MarketplaceSourceFingerprint> {
  const resolved = path.resolve(file);
  const before = await stat(resolved);
  if (!before.isFile()) throw new Error('入力画像が見つかりません。');
  const sha256 = await sha256File(resolved);
  const after = await stat(resolved);
  if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
    throw new Error('入力画像が読み込み中に変更されました。もう一度生成してください。');
  return { path: resolved, size: after.size, mtimeMs: after.mtimeMs, sha256 };
}

export type {
  MarketplaceGeneratedOutput,
  MarketplaceGenerationManifest,
  MarketplaceSourceFingerprint,
} from '../domain/marketplace-generation-policy.js';
export { MARKETPLACE_REGENERATION_REQUIRED } from '../domain/marketplace-generation-policy.js';

import type {
  MarketplaceGeneratedOutput,
  MarketplaceGenerationManifest,
  MarketplaceSourceFingerprint,
} from '../domain/marketplace-generation-policy.js';
import {
  assertMarketplaceOutput,
  marketplaceInputSignature as inputSignature,
  MARKETPLACE_REGENERATION_REQUIRED,
  validateMarketplaceGeneration as validateGeneration,
} from '../domain/marketplace-generation-policy.js';
export function marketplaceInputSignature(
  state: MarketplaceImageEditorState,
  targets: MarketplaceImageTarget[],
) {
  return inputSignature(
    { ...state, sourceImagePath: path.resolve(state.sourceImagePath) },
    targets,
  );
}
export function validateMarketplaceGeneration(
  manifest: MarketplaceGenerationManifest | null,
  state: MarketplaceImageEditorState,
  targets: MarketplaceImageTarget[],
  source: MarketplaceSourceFingerprint,
) {
  return validateGeneration(
    manifest,
    { ...state, sourceImagePath: path.resolve(state.sourceImagePath) },
    targets,
    source,
  );
}
export async function verifiedMarketplaceOutput(
  outputDirectory: string,
  expected: MarketplaceGeneratedOutput | undefined,
  target: MarketplaceImageTarget,
  extension: string,
) {
  const relativePath = `${target.service}/${target.fileName}.${extension}`;
  const targetPath = path.join(outputDirectory, ...relativePath.split('/'));
  const bytes = await readFile(targetPath).catch(() => null);
  assertMarketplaceOutput(
    expected,
    target,
    extension,
    bytes ? { size: bytes.length, sha256: sha256Bytes(bytes) } : null,
  );
  if (!bytes) throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  return { targetPath, relativePath, bytes };
}
