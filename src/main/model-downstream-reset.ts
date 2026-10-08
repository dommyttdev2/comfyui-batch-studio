import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { createModelDownstreamFileService } from '../application/model-downstream-file-service.js';
import { exists, readJson, writeJsonAtomic } from './fs-utils.js';
import { updateProjectMeta } from './project-meta.js';
import { projectTransactionCheckpoint, withProjectTransaction } from './project-transaction.js';
export type { ManualResetScope } from '../application/model-downstream-file-service.js';
export { modelGenerationInputs, modelGenerationInputsChanged } from '../domain/model-impact.js';
export const { resetModelDownstream, manualResetFrom } = createModelDownstreamFileService({
  path,
  mkdir: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  readdir,
  readFile: (file) => readFile(file, 'utf8'),
  rename,
  exists,
  readJson,
  writeJsonAtomic,
  updateProjectMeta,
  projectTransactionCheckpoint,
  withProjectTransaction,
  now: () => new Date().toISOString(),
  nextId: randomUUID,
});
