import {
  assertEligibleThumbnailSource,
  type ThumbnailSourceFacts,
} from '../domain/thumbnail-source-policy.js';
import type {
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
} from '../domain/artifact-types.js';
import { assertOutputDimensions } from '../domain/image-size-policy.js';
import { clampCrop, normalizeMarketplaceImageState } from '../domain/marketplace-editor-policy.js';
import {
  assertMarketplaceOutput,
  MARKETPLACE_REGENERATION_REQUIRED,
  type MarketplaceGeneratedOutput,
  type MarketplaceGenerationManifest,
  type MarketplaceSourceFingerprint,
  marketplaceInputSignature,
  validateMarketplaceGeneration,
} from '../domain/marketplace-generation-policy.js';
import type { ThumbnailOutputRecord, TrackedOutput } from '../domain/output-tracking-policy.js';

const FORMAT_EXTENSIONS = { png: 'png', jpeg: 'jpg', webp: 'webp' };
export interface MarketplaceGenerationIO<Image> {
  targets(): Promise<MarketplaceImageTarget[]>;
  thumbnailSourceFacts(projectId: string): Promise<ThumbnailSourceFacts>;
  resourceName(resourceId: string): string;
  writeState(projectId: string, state: MarketplaceImageEditorState): Promise<unknown>;
  readState(projectId: string): Promise<MarketplaceImageEditorState>;
  loadSource(
    projectId: string,
    state: MarketplaceImageEditorState,
  ): Promise<{ resolved: string; image: Image; size: { width: number; height: number } }>;
  fingerprint(resourceId: string): Promise<MarketplaceSourceFingerprint>;
  outputDirectory(projectId: string): Promise<string>;
  join(...parts: string[]): string;
  readManifest(resourceId: string): Promise<MarketplaceGenerationManifest | null>;
  removeManifest(resourceId: string): Promise<unknown>;
  writeManifest(resourceId: string, manifest: MarketplaceGenerationManifest): Promise<unknown>;
  encode(
    image: Image,
    crop: { x: number; y: number; width: number; height: number },
    target: MarketplaceImageTarget,
    format: MarketplaceOutputFormat,
  ): Promise<Uint8Array>;
  writeImage(resourceId: string, bytes: Uint8Array): Promise<void>;
  hashBytes(bytes: Uint8Array): string;
  nextId(): string;
  now(): string;
  cleanupTrackedOutput(
    resourceId: string,
    expected: MarketplaceGeneratedOutput,
  ): Promise<string | null>;
}
export async function generateMarketplaceOutputs<Image>(
  io: MarketplaceGenerationIO<Image>,
  root: string,
  value: unknown,
) {
  const state = normalizeMarketplaceImageState(value, await io.targets());
  await io.writeState(root, state);
  const targets = await io.targets();
  if (state.sourceType === 'thumbnail' && state.sourceImagePath)
    assertEligibleThumbnailSource(
      io.resourceName(state.sourceImagePath),
      await io.thumbnailSourceFacts(root),
    );
  const { resolved, image, size } = await io.loadSource(root, state);
  const source = await io.fingerprint(resolved);
  const inputSignature = marketplaceInputSignature(state, targets);
  const outputDirectory = await io.outputDirectory(root);
  const previousManifest = await io.readManifest(outputDirectory);
  const extension = FORMAT_EXTENSIONS[state.format];
  const outputPaths: string[] = [];
  const staged: Array<{ outputPath: string; bytes: Uint8Array }> = [];
  const outputs: MarketplaceGeneratedOutput[] = [];

  for (const target of targets) {
    const crop = clampCrop(
      state.targets[target.id]?.crop ?? null,
      size.width,
      size.height,
      target.width,
      target.height,
    );
    const relativePath = `${target.service}/${target.fileName}.${extension}`;
    const outputPath = io.join(outputDirectory, target.service, `${target.fileName}.${extension}`);
    const bytes = await io.encode(image, crop, target, state.format);
    staged.push({ outputPath, bytes });
    outputs.push({
      targetId: target.id,
      relativePath,
      size: bytes.length,
      sha256: io.hashBytes(bytes),
    });
    outputPaths.push(outputPath);
  }

  // Revalidate after rendering; edits or source replacement during processing cannot
  // turn four images from an old input into a newly certified generation.
  const sourceAfter = await io.fingerprint(resolved);
  const persisted = await io.readState(root);
  if (
    JSON.stringify(source) !== JSON.stringify(sourceAfter) ||
    marketplaceInputSignature(persisted, targets) !== inputSignature
  )
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  // Keep the old manifest if rendering fails before any output changes.
  await io.removeManifest(outputDirectory);
  for (const { outputPath, bytes } of staged) await io.writeImage(outputPath, bytes);
  const manifest: MarketplaceGenerationManifest = {
    schemaVersion: 1,
    generationId: io.nextId(),
    generatedAt: io.now(),
    source,
    format: state.format,
    inputSignature,
    outputs,
  };
  // The manifest is the commit marker. ZIP generation accepts only a complete,
  // content-verified set of outputs with the same generation identity.
  await io.writeManifest(outputDirectory, manifest);
  const cleanupWarnings: string[] = [];
  if (previousManifest?.schemaVersion === 1 && Array.isArray(previousManifest.outputs)) {
    const previousExtension = FORMAT_EXTENSIONS[previousManifest.format];
    for (const target of targets) {
      const old = previousManifest.outputs.find((entry) => entry.targetId === target.id);
      const expectedPath = `${target.service}/${target.fileName}.${previousExtension}`;
      if (!old || old.relativePath !== expectedPath || previousExtension === extension) continue;
      const warning = await io.cleanupTrackedOutput(
        io.join(outputDirectory, target.service, `${target.fileName}.${previousExtension}`),
        old,
      );
      if (warning) cleanupWarnings.push(`${target.label}: ${warning}`);
    }
  }
  return {
    outputDirectory,
    outputPaths,
    zipPath: null,
    cleanupWarning: cleanupWarnings.join(' / ') || undefined,
  };
}

export interface CustomMarketplaceIO<Image> extends MarketplaceGenerationIO<Image> {
  readTracked(resourceId: string): Promise<ThumbnailOutputRecord | null>;
  writeTracked(resourceId: string, value: ThumbnailOutputRecord): Promise<void>;
  cleanupCustom(resourceId: string, expected: TrackedOutput): Promise<string | null>;
}
export async function generateCustomMarketplaceOutput<Image>(
  io: CustomMarketplaceIO<Image>,
  projectId: string,
  value: unknown,
) {
  const state = normalizeMarketplaceImageState(value, await io.targets());
  assertOutputDimensions(state.custom.width, state.custom.height);
  await io.writeState(projectId, state);
  const { image, size } = await io.loadSource(projectId, state),
    crop = clampCrop(
      state.custom.crop,
      size.width,
      size.height,
      state.custom.width,
      state.custom.height,
    );
  const directory = io.join(await io.outputDirectory(projectId), 'custom'),
    name = `custom-output.${FORMAT_EXTENSIONS[state.format]}`,
    outputPath = io.join(directory, name),
    ledger = io.join(directory, '._custom-output.json'),
    previous = await io.readTracked(ledger);
  const bytes = await io.encode(
    image,
    crop,
    {
      id: 'custom',
      service: 'custom',
      fileName: 'custom-output',
      label: 'Custom',
      imageType: 'custom',
      width: state.custom.width,
      height: state.custom.height,
    },
    state.format,
  );
  await io.writeImage(outputPath, bytes);
  await io.writeTracked(ledger, {
    fileName: name,
    size: bytes.length,
    sha256: io.hashBytes(bytes),
  });
  const tracked = Object.values(FORMAT_EXTENSIONS).some(
    (extension) => previous?.fileName === `custom-output.${extension}`,
  );
  const warning =
    previous && tracked && previous.fileName !== name
      ? await io.cleanupCustom(io.join(directory, previous.fileName), previous)
      : null;
  return {
    outputDirectory: directory,
    outputPaths: [outputPath],
    zipPath: null,
    cleanupWarning: warning ?? undefined,
  };
}

export interface MarketplacePackageIO {
  thumbnailSourceFacts(projectId: string): Promise<ThumbnailSourceFacts>;
  resourceName(resourceId: string): string;
  targets(): Promise<MarketplaceImageTarget[]>;
  readState(projectId: string): Promise<MarketplaceImageEditorState>;
  outputDirectory(projectId: string): Promise<string>;
  join(...parts: string[]): string;
  readManifest(resourceId: string): Promise<MarketplaceGenerationManifest | null>;
  resolveSource(projectId: string, state: MarketplaceImageEditorState): Promise<string>;
  fingerprint(resourceId: string): Promise<MarketplaceSourceFingerprint>;
  readBytes(resourceId: string): Promise<Uint8Array | null>;
  hashBytes(bytes: Uint8Array): string;
  encodeZip(entries: { name: string; bytes: Uint8Array }[]): Uint8Array;
  writeBytes(resourceId: string, bytes: Uint8Array): Promise<void>;
}
export async function packageMarketplaceOutputs(
  io: MarketplacePackageIO,
  projectId: string,
  format: MarketplaceOutputFormat,
  currentEditorState?: unknown,
) {
  if (!['png', 'jpeg', 'webp'].includes(format))
    throw new Error('Invalid marketplace output format.');
  const targets = await io.targets(),
    state =
      currentEditorState === undefined
        ? await io.readState(projectId)
        : normalizeMarketplaceImageState(currentEditorState, targets),
    extension = FORMAT_EXTENSIONS[format],
    outputDirectory = await io.outputDirectory(projectId),
    manifest = await io.readManifest(outputDirectory);
  if (state.format !== format || !manifest) throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  let sourcePath: string, source: MarketplaceSourceFingerprint;
  try {
    if (state.sourceType === 'thumbnail')
      assertEligibleThumbnailSource(
        io.resourceName(state.sourceImagePath),
        await io.thumbnailSourceFacts(projectId),
      );
    sourcePath = await io.resolveSource(projectId, state);
    source = await io.fingerprint(sourcePath);
  } catch {
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  }
  validateMarketplaceGeneration(manifest, state, targets, source);
  const entries: { name: string; bytes: Uint8Array }[] = [],
    outputPaths: string[] = [];
  for (const [index, target] of targets.entries()) {
    const name = `${target.service}/${target.fileName}.${extension}`,
      file = io.join(outputDirectory, target.service, `${target.fileName}.${extension}`),
      bytes = await io.readBytes(file);
    assertMarketplaceOutput(
      manifest.outputs[index],
      target,
      extension,
      bytes ? { size: bytes.length, sha256: io.hashBytes(bytes) } : null,
    );
    if (!bytes) throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
    entries.push({ name, bytes });
    outputPaths.push(file);
  }
  const sourceAfter = await io.fingerprint(sourcePath),
    currentManifest = await io.readManifest(outputDirectory);
  validateMarketplaceGeneration(currentManifest, state, targets, sourceAfter);
  if (currentManifest?.generationId !== manifest.generationId)
    throw new Error(MARKETPLACE_REGENERATION_REQUIRED);
  const zipPath = io.join(outputDirectory, 'marketplace-images.zip');
  await io.writeBytes(zipPath, io.encodeZip(entries));
  return { outputDirectory, outputPaths, zipPath };
}
