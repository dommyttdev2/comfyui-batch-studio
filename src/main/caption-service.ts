import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  assertCaptionBuildable,
  assessCaptionBuild,
  captionContentHash,
  captionRenderInputHash,
} from '../domain/caption-build-policy.js';
import { importCaptionResponse, updatePixivTitle } from '../domain/caption-import-policy.js';
import type {
  CaptionBuildInfo,
  CaptionContent,
  CaptionStatus,
  ImportResult,
  ProjectBriefInput,
  ValidationIssue,
  ValidationResult,
} from '../shared/types.js';
import { getFinalArtifactStatus } from './final-artifact-service.js';
import { exists, readJson, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';

function internalDir(root: string) {
  return path.join(root, '._batch_studio');
}

function draftPath(root: string) {
  return path.join(internalDir(root), 'drafts', 'caption_content.json');
}

function buildPath(root: string) {
  return path.join(internalDir(root), 'caption-build.json');
}

function outputPath(root: string) {
  return path.join(root, 'caption.txt');
}

function sha256(value: string) {
  return createHash('sha256').update(Buffer.from(value, 'utf8')).digest('hex');
}

import {
  renderCaption,
  validateCaptionContent,
  validatePixivTitle,
} from '../domain/caption-policy.js';

export {
  renderCaption,
  validateCaptionContent,
  validatePixivTitle,
} from '../domain/caption-policy.js';

async function readDraft(root: string) {
  const value = await readJson<unknown>(draftPath(root));
  if (value == null)
    return {
      content: null,
      validation: {
        valid: false,
        issues: [
          {
            severity: 'error' as const,
            code: 'CAPTION_CONTENT_MISSING',
            message: 'caption_content.json の下書きがありません。',
          },
        ],
      },
    };
  const validation = validateCaptionContent(value);
  return { content: validation.valid ? (value as CaptionContent) : null, validation };
}

export async function getCaptionStatus(root: string): Promise<CaptionStatus> {
  const finalArtifact = await getFinalArtifactStatus(root);
  const sourceDirectory = finalArtifact.directory;
  const sourceExists = finalArtifact.exists;
  const imageCount = finalArtifact.imageCount;
  const draft = await readDraft(root);
  const captionPath = outputPath(root);
  const actualCaption = await readFile(captionPath, 'utf8').catch(() => null);
  const captionExists = actualCaption !== null;
  const build = await readJson<CaptionBuildInfo>(buildPath(root));
  const brief = await readJson<ProjectBriefInput & { schemaVersion?: number }>(
    path.join(root, 'project_brief.json'),
  );
  const copyrightedCharacter = brief?.subject?.copyrightedCharacter === true;
  const { state, stale, preview } = assessCaptionBuild(
    {
      sourceDirectory: sourceDirectory ? path.resolve(sourceDirectory) : null,
      sourceExists,
      imageCount,
      content: draft.content,
      validation: draft.validation,
      actualCaption,
      build: build
        ? {
            ...build,
            sourceDirectory: build.sourceDirectory ? path.resolve(build.sourceDirectory) : '',
          }
        : null,
      copyrightedCharacter,
    },
    sha256,
  );

  return {
    state,
    sourceDirectory,
    sourceExists,
    imageCount,
    imageExtensions: finalArtifact.imageExtensions,
    content: draft.content,
    contentValidation: draft.validation,
    captionPath,
    captionExists,
    stale,
    build,
    preview,
  };
}

async function saveRawResponse(root: string, raw: string, provider: 'grok' | 'codex') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(
    internalDir(root),
    provider === 'codex' ? 'codex-responses' : 'grok-responses',
    'caption',
    `${stamp}-${randomUUID()}.txt`,
  );
  await writeTextAtomic(file, raw);
}

export async function importCaptionGrok(
  root: string,
  raw: string,
  options: { automatic?: boolean; provider?: 'grok' | 'codex' } = {},
): Promise<ImportResult> {
  await saveRawResponse(root, raw, options.provider ?? 'grok');
  const result = importCaptionResponse(raw);
  if (result.validation.valid) await writeJsonAtomic(draftPath(root), JSON.parse(result.extracted));
  return result;
}

export async function savePixivTitle(root: string, value: unknown): Promise<CaptionStatus> {
  const draft = await readDraft(root);
  if (!draft.content) throw new Error('有効な caption_content.json の下書きがありません。');
  const next = updatePixivTitle(draft.content, value);
  await writeJsonAtomic(draftPath(root), next);
  return getCaptionStatus(root);
}

export async function generateCaption(root: string): Promise<CaptionStatus> {
  const status = await getCaptionStatus(root);
  assertCaptionBuildable(
    {
      sourceDirectory: status.sourceDirectory,
      sourceExists: status.sourceExists,
      content: status.content,
      validation: status.contentValidation,
      imageCount: status.imageCount,
      actualCaption: null,
      build: null,
      copyrightedCharacter: false,
    },
    status.preview,
  );

  await writeTextAtomic(status.captionPath, status.preview!);
  const brief = await readJson<ProjectBriefInput>(path.join(root, 'project_brief.json'));
  const build: CaptionBuildInfo = {
    schemaVersion: 1,
    sourceDirectory: status.sourceDirectory!,
    imageCount: status.imageCount,
    contentSha256: captionContentHash(status.content!, sha256),
    renderInputSha256: captionRenderInputHash(
      status.content!,
      status.imageCount,
      path.resolve(status.sourceDirectory!),
      brief?.subject?.copyrightedCharacter === true,
      sha256,
    ),
    outputSha256: sha256(status.preview!),
    generatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(buildPath(root), build);
  return getCaptionStatus(root);
}
