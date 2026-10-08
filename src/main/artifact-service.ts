import { createArtifactFileService } from '../application/artifact-file-service.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import {
  backupIfExists,
  exists,
  readJson,
  readText,
  removeIfExists,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs-utils.js';
import { loadCatalog } from './model-catalog.js';
import { resetModelDownstream } from './model-downstream-reset.js';
import { initializeProjectMeta } from './project-meta.js';
import { projectTransactionCheckpoint, withProjectTransaction } from './project-transaction.js';

export const {
  internalDir,
  draftPath,
  confirmedPath,
  readArtifact,
  saveDraft,
  importGrok,
  confirmArtifact,
  createProject,
  savePromptPlan,
  beginEditArtifact,
  saveProjectBrief,
} = createArtifactFileService({
  path,
  readJson,
  readText,
  exists,
  backupIfExists,
  removeIfExists,
  writeTextAtomic,
  writeJsonAtomic,
  mkdir: async (directory) => {
    await mkdir(directory, { recursive: true });
  },
  readdir,
  loadCatalog,
  resetModelDownstream,
  initializeProjectMeta,
  projectTransactionCheckpoint,
  withProjectTransaction,
  artifactRoot: () => process.env.BATCH_STUDIO_ARTIFACT_ROOT ?? '',
  now: () => new Date().toISOString(),
  nextId: randomUUID,
});
