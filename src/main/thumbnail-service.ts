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
    const match = /^thumbnail-(\d+)\.(png|jpe?g)$/i.exec(entry.name);
    if (!match || !allowed.has(Number(match[1]))) continue;
    const tracked = manifest.outputs[String(Number(match[1]))];
    if (tracked && tracked.fileName !== entry.name) continue;
    items.push({ name: entry.name, path: path.join(directory, entry.name) });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export async function assertExportedThumbnail(root: string, imagePath: string): Promise<string> {
  const resolved = path.resolve(imagePath);
  const directory = await thumbnailOutputDirectory(root);
  const match = /^thumbnail-(\d+)\.(png|jpe?g)$/i.exec(path.basename(resolved));
  const raw = await readJson<unknown>(statePath(root));
  const editor = normalizeThumbnailState(raw);
  const allowed = new Set(editor.documents.map((document) => document.id));
  const tracked = match
    ? (await thumbnailOutputManifest(root)).outputs[String(Number(match[1]))]
    : null;
  if (
    !match ||
    !allowed.has(Number(match[1])) ||
    (tracked && tracked.fileName !== path.basename(resolved))
  )
    throw new Error('現在有効なサムネイルの出力済み画像を選択してください。');
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
