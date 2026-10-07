import type {
  ThumbnailDocument,
  ThumbnailEditorState,
  ThumbnailPattern,
  ThumbnailSlotKey,
  ThumbnailTextState,
} from './artifact-types.js';
export const PATTERNS = new Set<ThumbnailPattern>([
  '3-images',
  '4-images-left-split',
  '4-images-right-split',
  '5-images-both-split',
]);
const SLOT_KEYS = new Set<ThumbnailSlotKey>([
  'LEFT',
  'LEFT_TOP',
  'LEFT_BOTTOM',
  'CENTER_MAIN',
  'RIGHT',
  'RIGHT_TOP',
  'RIGHT_BOTTOM',
]);
function defaultText(
  text: string,
  y: number,
  fontSize: number,
  fontFamily: string,
): ThumbnailTextState {
  return {
    text,
    x: 800,
    y,
    fontSize,
    fontFamily,
    color: '#ffffff',
  };
}

export function createThumbnailDocument(id: number, fontFamily: string): ThumbnailDocument {
  return {
    id,
    pattern:
      id === 1
        ? '3-images'
        : id === 2
          ? '4-images-left-split'
          : id === 3
            ? '4-images-right-split'
            : '5-images-both-split',
    slots: {},
    title: defaultText(`Scene ${String(id).padStart(2, '0')}`, 985, 154, fontFamily),
    subtitle: defaultText('Midnight Elegance', 1100, 50, fontFamily),
  };
}

export function createDefaultThumbnailState(
  defaultFontFamily = 'Times New Roman',
): ThumbnailEditorState {
  return {
    schemaVersion: 1,
    activeDocumentId: 1,
    nextDocumentId: 6,
    documents: Array.from({ length: 5 }, (_, index) =>
      createThumbnailDocument(index + 1, defaultFontFamily),
    ),
  };
}

function finite(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function cleanText(value: unknown, fallback: ThumbnailTextState): ThumbnailTextState {
  const input = value && typeof value === 'object' ? (value as Partial<ThumbnailTextState>) : {};
  return {
    text: typeof input.text === 'string' ? input.text.slice(0, 200) : fallback.text,
    x: finite(input.x, fallback.x, -1600, 3200),
    y: finite(input.y, fallback.y, -1200, 2400),
    fontSize: finite(input.fontSize, fallback.fontSize, 12, 400),
    fontFamily:
      typeof input.fontFamily === 'string' && input.fontFamily.trim()
        ? input.fontFamily.trim().slice(0, 100)
        : fallback.fontFamily,
    color:
      typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color)
        ? input.color
        : fallback.color,
  };
}

export function normalizeThumbnailState(
  value: unknown,
  defaultFontFamily = 'Times New Roman',
): ThumbnailEditorState {
  const defaults = createDefaultThumbnailState(defaultFontFamily);
  const input = value && typeof value === 'object' ? (value as Partial<ThumbnailEditorState>) : {};
  const sourceDocuments =
    Array.isArray(input.documents) && input.documents.length ? input.documents : defaults.documents;
  const seenIds = new Set<number>();
  const validDocuments = sourceDocuments
    .filter((candidate): candidate is ThumbnailDocument => {
      if (
        !candidate ||
        typeof candidate !== 'object' ||
        !Number.isSafeInteger(candidate.id) ||
        candidate.id < 1 ||
        seenIds.has(candidate.id)
      )
        return false;
      seenIds.add(candidate.id);
      return true;
    })
    .map((candidate) => {
      const fallback = createThumbnailDocument(candidate.id, defaultFontFamily);
      const slots: ThumbnailDocument['slots'] = {};
      if (candidate.slots && typeof candidate.slots === 'object') {
        for (const [key, raw] of Object.entries(candidate.slots)) {
          if (!SLOT_KEYS.has(key as ThumbnailSlotKey) || !raw || typeof raw !== 'object') continue;
          const slot = raw as {
            imagePath?: unknown;
            offsetX?: unknown;
            offsetY?: unknown;
            scale?: unknown;
          };
          slots[key as ThumbnailSlotKey] = {
            imagePath: typeof slot.imagePath === 'string' ? slot.imagePath : '',
            offsetX: finite(slot.offsetX, 0, -1600, 1600),
            offsetY: finite(slot.offsetY, 0, -1200, 1200),
            scale: finite(slot.scale, 1, 0.1, 8),
          };
        }
      }
      return {
        id: fallback.id,
        pattern: PATTERNS.has(candidate.pattern) ? candidate.pattern : fallback.pattern,
        slots,
        title: cleanText(candidate.title, fallback.title),
        subtitle: cleanText(candidate.subtitle, fallback.subtitle),
      };
    });
  const documents = validDocuments.length ? validDocuments : defaults.documents;
  return {
    schemaVersion: 1,
    activeDocumentId: documents.some((item) => item.id === input.activeDocumentId)
      ? (input.activeDocumentId as number)
      : (documents[0]?.id ?? 1),
    documents,
    nextDocumentId: Math.max(
      ...documents.map((item) => item.id + 1),
      Number.isSafeInteger(input.nextDocumentId) && (input.nextDocumentId as number) > 0
        ? (input.nextDocumentId as number)
        : 1,
    ),
    ...(typeof input.saveRevision === 'number' &&
    Number.isSafeInteger(input.saveRevision) &&
    input.saveRevision >= 0
      ? { saveRevision: input.saveRevision }
      : {}),
  };
}

export function validThumbnailState(value: unknown): boolean {
  const state = value as Partial<ThumbnailEditorState> | null;
  return !(
    !state ||
    typeof state !== 'object' ||
    state.schemaVersion !== 1 ||
    !Array.isArray(state.documents) ||
    state.documents.length === 0 ||
    !Number.isSafeInteger(state.activeDocumentId) ||
    !Number.isSafeInteger(state.nextDocumentId) ||
    state.documents.some(
      (item) => !item || !Number.isSafeInteger(item.id) || typeof item.slots !== 'object',
    ) ||
    (state.saveRevision !== undefined &&
      (!Number.isSafeInteger(state.saveRevision) || state.saveRevision < 0))
  );
}
