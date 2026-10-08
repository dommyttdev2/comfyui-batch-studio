import { saveEditorDocument } from '../application/editor-document-persistence.js';
import { recoverCurrentFormat } from '../application/current-format-recovery.js';
import { deleteThumbnailDocument as deleteThumbnailDocumentCore } from '../application/thumbnail-document-use-cases.js';
import {
  isEligibleThumbnailSource,
  assertEligibleThumbnailSource,
} from '../domain/thumbnail-source-policy.js';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { nativeImage } from 'electron';
import {
  deleteThumbnailOutput,
  exportThumbnailOutput,
  type ThumbnailOutputIO,
} from '../application/thumbnail-output-generation.js';
import type { ThumbnailOutputManifest } from '../domain/output-tracking-policy.js';
import { validThumbnailState } from '../domain/thumbnail-editor-policy.js';
import type {
  ThumbnailDocument,
  ThumbnailEditorState,
  ThumbnailExportResult,
  ThumbnailImageItem,
  ThumbnailImageSource,
  ThumbnailPattern,
  ThumbnailSlotKey,
  ThumbnailTemplateSource,
  ThumbnailTextState,
} from '../shared/types.js';
import { writeImageAtomic } from './atomic-image-output.js';
import {
  listImageFiles,
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
import { readProjectMeta } from './project-meta.js';
import { cleanupTrackedOutput } from './tracked-output-cleanup.js';

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
  if (!validThumbnailState(value))
    throw new PersistedJsonError(
      'PERSISTED_JSON_CORRUPT',
      file,
      'Thumbnail editor state has an invalid structure',
    );
}

import {
  createDefaultThumbnailState,
  createThumbnailDocument,
  normalizeThumbnailState,
  PATTERNS,
} from '../domain/thumbnail-editor-policy.js';

export {
  createDefaultThumbnailState,
  createThumbnailDocument,
  normalizeThumbnailState,
  PATTERNS,
} from '../domain/thumbnail-editor-policy.js';
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

function currentEditorRecovery(root: string) {
  const file = statePath(root);
  return {
    exclusive: <T>(work: () => Promise<T>) => withTemplateStoreLock(file, work),
    load: () => loadThumbnailState(root),
    corruption: (error: unknown) =>
      error instanceof PersistedJsonError && error.code === 'PERSISTED_JSON_CORRUPT'
        ? ('corrupt' as const)
        : null,
    restore: async () => {
      await restoreValidatedJsonFromBackup(file, assertThumbnailState);
    },
    initialize: async () => {
      await initializeCorruptProtectedJson(file, createDefaultThumbnailState());
    },
  };
}
export async function restoreThumbnailState(root: string): Promise<ThumbnailEditorState> {
  return recoverCurrentFormat(currentEditorRecovery(root), 'restore');
}
export async function initializeCorruptThumbnailState(root: string): Promise<ThumbnailEditorState> {
  return recoverCurrentFormat(currentEditorRecovery(root), 'initialize');
}

export async function saveThumbnailState(
  root: string,
  state: unknown,
): Promise<ThumbnailEditorState> {
  const file = statePath(root);
  return saveEditorDocument(
    {
      exclusive: (work) => withTemplateStoreLock(file, work),
      read: () => readJson<ThumbnailEditorState>(file),
      write: (value) => writeJsonAtomic(file, value),
      assertCurrent: (value: unknown) => assertThumbnailState(value, file),
      normalize: normalizeThumbnailState,
      revision: (last) => Math.max(last + 1, Date.now() * 1000),
    },
    state,
  );
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

function thumbnailOutputManifestPath(root: string) {
  return path.join(root, '._batch_studio', 'thumbnail-outputs.json');
}

async function thumbnailOutputManifest(root: string): Promise<ThumbnailOutputManifest> {
  const stored = await readJson<ThumbnailOutputManifest>(thumbnailOutputManifestPath(root));
  return stored?.schemaVersion === 1 && stored.outputs && typeof stored.outputs === 'object'
    ? stored
    : { schemaVersion: 1, outputs: {} };
}

export async function listExportedThumbnails(root: string): Promise<ThumbnailImageItem[]> {
  const directory = await thumbnailOutputDirectory(root);
  // Avoid system-font enumeration for every gallery preview/source validation.
  const raw = await readJson<unknown>(statePath(root));
  const editor = normalizeThumbnailState(raw);
  const allowed = new Set(editor.documents.map((document) => document.id));
  const manifest = await thumbnailOutputManifest(root);
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
    if (
      !isEligibleThumbnailSource(entry.name, {
        documentIds: [...allowed],
        outputs: manifest.outputs,
      })
    )
      continue;
    items.push({ name: entry.name, path: path.join(directory, entry.name) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function assertExportedThumbnail(root: string, imagePath: string): Promise<string> {
  const resolved = path.resolve(imagePath);
  const directory = await thumbnailOutputDirectory(root);
  const raw = await readJson<unknown>(statePath(root));
  const editor = normalizeThumbnailState(raw);
  assertEligibleThumbnailSource(path.basename(resolved), {
    documentIds: editor.documents.map((x) => x.id),
    outputs: (await thumbnailOutputManifest(root)).outputs,
  });
  try {
    const canonicalDirectory = await realpath(directory);
    const info = await lstat(resolved);
    const canonical = await realpath(resolved);
    const sameDirectory =
      process.platform === 'win32'
        ? path.dirname(canonical).toLowerCase() === canonicalDirectory.toLowerCase()
        : path.dirname(canonical) === canonicalDirectory;
    if (!info.isFile() || !sameDirectory)
      throw new Error('現在有効なサムネイルの出力済み画像を選択してください。');
  } catch {
    throw new Error('サムネイル画像が見つかりません。');
  }
  return resolved;
}

export async function deleteThumbnailOutputs(root: string, id: number) {
  return deleteThumbnailOutput(thumbnailOutputIO, root, id);
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
  return exportThumbnailOutput(thumbnailOutputIO, root, documentId, format, bytes);
}

const thumbnailOutputIO: ThumbnailOutputIO = {
  directory: async (root) => {
    const dir = await thumbnailOutputDirectory(root);
    await mkdir(dir, { recursive: true });
    return dir;
  },
  join: path.join,
  exclusive: (root, work) => withTemplateStoreLock(thumbnailOutputManifestPath(root), work),
  readManifest: thumbnailOutputManifest,
  writeManifest: (root, manifest) => writeJsonAtomic(thumbnailOutputManifestPath(root), manifest),
  writeImage: (root, id, file, bytes, format) =>
    writeImageAtomic(
      file,
      Buffer.from(bytes),
      format,
      (content) => {
        const image = nativeImage.createFromBuffer(content);
        return image.isEmpty() ? null : image.getSize();
      },
      `${path.resolve(root)}:${id}`,
    ),
  hash: (bytes) => createHash('sha256').update(bytes).digest('hex'),
  cleanup: cleanupTrackedOutput,
  remove: (file) => rm(file, { force: true }),
};

export async function thumbnailSourceFacts(root: string) {
  const editor = normalizeThumbnailState(await readJson<unknown>(statePath(root)));
  return {
    documentIds: editor.documents.map((x) => x.id),
    outputs: (await thumbnailOutputManifest(root)).outputs,
  };
}

export async function deleteThumbnailDocument(
  root: string,
  id: number,
  expectedRevision: number,
  deleteOutputs: boolean,
) {
  return deleteThumbnailDocumentCore(
    {
      exclusive: (_p, work) => withTemplateStoreLock(statePath(root), work),
      load: loadThumbnailState,
      write: (project, state) => writeJsonAtomic(statePath(project), state),
      deleteOutputs: deleteThumbnailOutputs,
    },
    root,
    { id, expectedRevision, deleteOutputs },
  );
}
