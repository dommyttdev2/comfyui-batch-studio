import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createCaptionFileService } from '../application/caption-file-service.js';
import { getFinalArtifactStatus } from './final-artifact-service.js';
import { readJson, readText, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';
export {
  renderCaption,
  validateCaptionContent,
  validatePixivTitle,
} from '../domain/caption-policy.js';
export const { getCaptionStatus, importCaptionGrok, savePixivTitle, generateCaption } =
  createCaptionFileService({
    path,
    readJson,
    readText,
    writeJsonAtomic,
    writeTextAtomic,
    getFinalArtifactStatus,
    sha256: (value) => createHash('sha256').update(value, 'utf8').digest('hex'),
    now: () => new Date().toISOString(),
    nextId: randomUUID,
  });
