import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ThumbnailDocument,
  ThumbnailEditorState,
  ThumbnailExportResult,
  ThumbnailImageSource,
  ThumbnailPattern,
  ThumbnailSlotKey,
  ThumbnailTextState,
  ThumbnailTemplateSource,
} from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';

const PATTERNS = new Set<ThumbnailPattern>([
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
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function statePath(root: string) {
  return path.join(root, '._batch_studio', 'thumbnail-editor.json');
}

function defaultText(text: string, y: number, fontSize: number): ThumbnailTextState {
  return {
    text,
    x: 800,
    y,
    fontSize,
    fontFamily: 'Times New Roman',
    color: '#ffffff',
  };
}

function defaultDocument(id: number): ThumbnailDocument {
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
    title: defaultText(`Scene ${String(id).padStart(2, '0')}`, 985, 154),
    subtitle: defaultText('Midnight Elegance', 1100, 50),
  };
}

export function createDefaultThumbnailState(): ThumbnailEditorState {
  return {
    schemaVersion: 1,
    activeDocumentId: 1,
    documents: Array.from({ length: 6 }, (_, index) => defaultDocument(index + 1)),
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

export function normalizeThumbnailState(value: unknown): ThumbnailEditorState {
  const defaults = createDefaultThumbnailState();
  const input = value && typeof value === 'object' ? (value as Partial<ThumbnailEditorState>) : {};
  const sourceDocuments = Array.isArray(input.documents) ? input.documents : [];
  const documents = defaults.documents.map((fallback) => {
    const candidate = sourceDocuments.find((item): item is ThumbnailDocument =>
      Boolean(item && typeof item === 'object' && (item as ThumbnailDocument).id === fallback.id),
    );
    if (!candidate) return fallback;
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
  return {
    schemaVersion: 1,
    activeDocumentId: Math.round(finite(input.activeDocumentId, 1, 1, 6)),
    documents,
  };
}

export async function loadThumbnailState(root: string): Promise<ThumbnailEditorState> {
  return normalizeThumbnailState(await readJson<unknown>(statePath(root)));
}

export async function saveThumbnailState(
  root: string,
  state: unknown,
): Promise<ThumbnailEditorState> {
  const normalized = normalizeThumbnailState(state);
  await writeJsonAtomic(statePath(root), normalized);
  return normalized;
}

export async function readThumbnailImage(imagePath: string): Promise<ThumbnailImageSource | null> {
  const resolved = path.resolve(imagePath);
  const mime = IMAGE_TYPES[path.extname(resolved).toLowerCase()];
  if (!mime) return null;
  try {
    const bytes = await readFile(resolved);
    return {
      path: resolved,
      name: path.basename(resolved),
      dataUrl: `data:${mime};base64,${bytes.toString('base64')}`,
    };
  } catch {
    return null;
  }
}

export async function readThumbnailTemplate(
  templateDirectory: string,
  pattern: unknown,
): Promise<ThumbnailTemplateSource> {
  if (typeof pattern !== 'string' || !PATTERNS.has(pattern as ThumbnailPattern))
    throw new Error('Invalid thumbnail template');
  const name = `thumbnail-template-${pattern}.psd`;
  const bytes = await readFile(path.join(templateDirectory, name));
  return {
    name,
    dataUrl: `data:application/octet-stream;base64,${bytes.toString('base64')}`,
  };
}

export async function exportThumbnail(
  root: string,
  documentId: number,
  format: 'png' | 'jpeg',
  dataUrl: string,
): Promise<ThumbnailExportResult> {
  const mime = format === 'png' ? 'image/png' : 'image/jpeg';
  const prefix = `data:${mime};base64,`;
  if (!dataUrl.startsWith(prefix))
    throw new Error('サムネイル画像データの形式が正しくありません。');
  const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64');
  if (!bytes.length || bytes.length > 50 * 1024 * 1024)
    throw new Error('サムネイル画像データのサイズが正しくありません。');
  const outputDirectory = path.join(root, 'thumbnails');
  await mkdir(outputDirectory, { recursive: true });
  const extension = format === 'png' ? 'png' : 'jpg';
  const outputPath = path.join(
    outputDirectory,
    `thumbnail-${String(documentId).padStart(2, '0')}.${extension}`,
  );
  await writeFile(outputPath, bytes);
  return { path: outputPath };
}
