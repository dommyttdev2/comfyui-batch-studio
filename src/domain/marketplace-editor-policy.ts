import type {
  MarketplaceCropRect,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
} from './artifact-types.js';
export function finite(value: unknown, fallback: number, min: number, max: number) {
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

export function validateMarketplaceTargets(value: unknown): MarketplaceImageTarget[] {
  const raw = value as { schemaVersion: number; targets: MarketplaceImageTarget[] };
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

export function createDefaultMarketplaceImageState(
  targets: MarketplaceImageTarget[],
): MarketplaceImageEditorState {
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

export function normalizeMarketplaceImageState(
  value: unknown,
  targets: MarketplaceImageTarget[],
): MarketplaceImageEditorState {
  const defaults = createDefaultMarketplaceImageState(targets);
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

export function clampCrop(
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

export function validMarketplaceState(value: unknown): boolean {
  const state = value as Partial<MarketplaceImageEditorState> | null;
  return !(
    !state ||
    typeof state !== 'object' ||
    state.schemaVersion !== 1 ||
    !state.targets ||
    typeof state.targets !== 'object' ||
    Array.isArray(state.targets) ||
    !state.custom ||
    typeof state.custom !== 'object' ||
    !Number.isFinite(state.custom.width) ||
    !Number.isFinite(state.custom.height) ||
    (state.saveRevision !== undefined &&
      (!Number.isSafeInteger(state.saveRevision) || state.saveRevision < 0))
  );
}
