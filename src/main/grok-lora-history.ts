import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createLoraSelectionHistory } from '../application/lora-selection-history.js';
import { readText } from './fs-utils.js';
export const { readGrokLoraSelectionHistory } = createLoraSelectionHistory({
  path,
  readText,
  listFiles: async (directory) =>
    (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  modifiedAt: async (file) => (await stat(file)).mtime.toISOString(),
});
