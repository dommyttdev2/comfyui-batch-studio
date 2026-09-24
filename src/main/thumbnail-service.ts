import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ThumbnailDocument,
  ThumbnailEditorState,
  ThumbnailExportResult,
  ThumbnailImageItem,
  ThumbnailImageSource,
  ThumbnailPattern,
  ThumbnailSlotKey,
  ThumbnailTextState,
  ThumbnailTemplateSource,
} from '../shared/types.js';
import {
  initializeCorruptProtectedJson,
  PersistedJsonError,
  readJson,
  restoreValidatedJsonFromBackup,
  withTemplateStoreLock,
  writeJsonAtomic,
} from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
import {
  listImageFiles,
  readImagePreview,
  readImageSource,
} from './final-artifact-image-service.js';

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
const WINDOWS_FONT_FALLBACK = ['Segoe UI', 'Times New Roman', 'Meiryo', 'Yu Mincho'];

function runPowerShell(command: string) {
  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  return new Promise<string>((resolve, reject) => {
    execFile(
      powershell,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
}

export async function listThumbnailFonts(): Promise<string[]> {
  if (process.platform !== 'win32') return WINDOWS_FONT_FALLBACK;
  const command = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'Add-Type -AssemblyName System.Drawing',
    '$collection = New-Object System.Drawing.Text.InstalledFontCollection',
    '$collection.Families | ForEach-Object { $_.Name } | Where-Object { $_ } | Sort-Object -Unique | ConvertTo-Json -Compress',
  ].join('; ');
  try {
    const stdout = (await runPowerShell(command)).trim();
    if (!stdout) return WINDOWS_FONT_FALLBACK;
    const parsed: unknown = JSON.parse(stdout);
    const values = Array.isArray(parsed) ? parsed : typeof parsed === 'string' ? [parsed] : [];
    const fonts = values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean);
    return fonts.length
      ? [...new Set(fonts)].sort((a, b) => a.localeCompare(b))
      : WINDOWS_FONT_FALLBACK;
  } catch {
    return WINDOWS_FONT_FALLBACK;
  }
}

function statePath(root: string) {
  return path.join(root, '._batch_studio', 'thumbnail-editor.json');
}

function assertThumbnailState(value: unknown, file: string): asserts value is ThumbnailEditorState {
  const state = value as Partial<ThumbnailEditorState> | null;
  if (
    !state ||
    typeof state !== 'object' ||
    state.schemaVersion !== 1 ||
    !Array.isArray(state.documents) ||
    state.documents.length === 0 ||
    !Number.isSafeInteger(state.activeDocumentId) ||
    !Number.isSafeInteger(state.nextDocumentId) ||
    state.documents.some(
      (document) =>
        !document || !Number.isSafeInteger(document.id) || typeof document.slots !== 'object',
    ) ||
    (state.saveRevision !== undefined &&
      (!Number.isSafeInteger(state.saveRevision) || state.saveRevision < 0))
  )
    throw new PersistedJsonError(
      'PERSISTED_JSON_CORRUPT',
      file,
      'Thumbnail editor state has an invalid structure',
    );
}

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
    activeDocumentId: documents.some((document) => document.id === input.activeDocumentId)
      ? (input.activeDocumentId as number)
      : (documents[0]?.id ?? 1),
    documents,
    nextDocumentId: Math.max(
      ...documents.map((document) => document.id + 1),
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

export async function loadThumbnailState(root: string): Promise<ThumbnailEditorState> {
  const file = statePath(root);
  const stored = await readJson<unknown>(file);
  if (stored !== null) assertThumbnailState(stored, file);
  // Font enumeration launches PowerShell on Windows. Existing projects carry
  // their selected fonts in the saved editor state, so do not block image display on it.
  if (stored) return normalizeThumbnailState(stored);
  const fonts = await listThumbnailFonts();
  return normalizeThumbnailState(
    null,
    fonts.includes('Meiryo UI') ? 'Meiryo UI' : 'Times New Roman',
  );
}

export async function restoreThumbnailState(root: string): Promise<ThumbnailEditorState> {
  const file = statePath(root);
  return withTemplateStoreLock(file, async () => {
    try {
      await loadThumbnailState(root);
    } catch (error) {
      if (!(error instanceof PersistedJsonError)) throw error;
      await restoreValidatedJsonFromBackup(file, assertThumbnailState);
      return loadThumbnailState(root);
    }
    throw new Error('編集データは正常です。復元は必要ありません。');
  });
}

export async function initializeCorruptThumbnailState(root: string) {
  const file = statePath(root);
  return withTemplateStoreLock(file, async () => {
    try {
      await loadThumbnailState(root);
    } catch (error) {
      if (!(error instanceof PersistedJsonError) || error.code !== 'PERSISTED_JSON_CORRUPT')
        throw error;
      await initializeCorruptProtectedJson(file, createDefaultThumbnailState());
      return loadThumbnailState(root);
    }
    throw new Error('編集データは正常です。初期化は必要ありません。');
  });
}

export async function saveThumbnailState(
  root: string,
  state: unknown,
): Promise<ThumbnailEditorState> {
  const normalized = normalizeThumbnailState(state);
  const file = statePath(root);
  return withTemplateStoreLock(file, async () => {
    const current = await readJson<ThumbnailEditorState>(file);
    if (current !== null) assertThumbnailState(current, file);
    const lastRevision = current?.saveRevision ?? 0;
    if (normalized.saveRevision !== undefined && normalized.saveRevision < lastRevision)
      return normalizeThumbnailState(current);
    if (
      normalized.saveRevision !== undefined &&
      normalized.saveRevision === lastRevision &&
      current
    ) {
      const proposed = { ...normalized, saveRevision: lastRevision };
      if (JSON.stringify(proposed) !== JSON.stringify(current))
        throw new Error('EDITOR_SAVE_CONFLICT: Thumbnail state was modified by another editor.');
      return normalizeThumbnailState(current);
    }
    const committed = {
      ...normalized,
      saveRevision: normalized.saveRevision ?? Math.max(lastRevision + 1, Date.now() * 1000),
    };
    await writeJsonAtomic(file, committed);
    return committed;
  });
}

export async function listThumbnailImages(directory: string): Promise<ThumbnailImageItem[]> {
  return listImageFiles(directory);
}

export async function readThumbnailPreview(
  imagePath: string,
): Promise<ThumbnailImageSource | null> {
  return readImagePreview(imagePath);
}

export async function readThumbnailImage(imagePath: string): Promise<ThumbnailImageSource | null> {
  return readImageSource(imagePath);
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

export async function thumbnailOutputDirectory(root: string): Promise<string> {
  const meta = await readProjectMeta(root);
  const base = meta?.settings.artifactOutputPath?.trim();
  if (!base) throw new Error('成果物フォルダを設定してください。');
  return path.join(path.resolve(base), 'thumbnails');
}

export async function listExportedThumbnails(root: string): Promise<ThumbnailImageItem[]> {
  const directory = await thumbnailOutputDirectory(root);
  // Avoid system-font enumeration for every gallery preview/source validation.
  const raw = await readJson<unknown>(statePath(root));
  const editor = normalizeThumbnailState(raw);
  const allowed = new Set(editor.documents.map((document) => document.id));
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const items: ThumbnailImageItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = /^thumbnail-(\d+)\.(png|jpe?g)$/i.exec(entry.name);
    if (!match || !allowed.has(Number(match[1]))) continue;
    items.push({ name: entry.name, path: path.join(directory, entry.name) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function assertExportedThumbnail(root: string, imagePath: string): Promise<string> {
  const resolved = path.resolve(imagePath);
  const allowed = (await listExportedThumbnails(root)).some((item) =>
    process.platform === 'win32'
      ? path.resolve(item.path).toLowerCase() === resolved.toLowerCase()
      : path.resolve(item.path) === resolved,
  );
  if (!allowed) throw new Error('現在有効なサムネイルの出力済み画像を選択してください。');
  if (!(await stat(resolved)).isFile()) throw new Error('サムネイル画像が見つかりません。');
  return resolved;
}

export async function deleteThumbnailOutputs(root: string, documentId: number): Promise<void> {
  if (!Number.isSafeInteger(documentId) || documentId < 1)
    throw new Error('Invalid thumbnail document');
  const directory = await thumbnailOutputDirectory(root);
  for (const ext of ['png', 'jpg', 'jpeg'])
    await rm(path.join(directory, `thumbnail-${String(documentId).padStart(2, '0')}.${ext}`), {
      force: true,
    });
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
  const outputDirectory = await thumbnailOutputDirectory(root);
  await mkdir(outputDirectory, { recursive: true });
  const extension = format === 'png' ? 'png' : 'jpg';
  const outputPath = path.join(
    outputDirectory,
    `thumbnail-${String(documentId).padStart(2, '0')}.${extension}`,
  );
  await writeFile(outputPath, bytes);
  return { path: outputPath };
}
