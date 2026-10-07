import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

function captionBodyContent(content: CaptionContent): CaptionContent {
  if (content.schemaVersion === 1) return content;
  // v2 Pixiv titles are independent of caption.txt and its build fingerprints.
  const { pixivTitle: _pixivTitle, ...body } = content;
  return { ...body, schemaVersion: 1 };
}

function contentHash(content: CaptionContent) {
  return sha256(JSON.stringify(captionBodyContent(content)));
}

// Increment when fixed text, formatting, or localization in renderCaption changes.
const CAPTION_TEMPLATE_VERSION = 2;

function renderInputHash(
  content: CaptionContent,
  imageCount: number,
  sourceDirectory: string,
  copyrightedCharacter: boolean,
) {
  return sha256(
    JSON.stringify({
      templateVersion: CAPTION_TEMPLATE_VERSION,
      content: captionBodyContent(content),
      imageCount,
      sourceDirectory: path.resolve(sourceDirectory),
      copyrightedCharacter,
    }),
  );
}

function jsonCandidate(raw: string) {
  const fence = raw.match(/```json\s*\n([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  return first >= 0 && last > first ? raw.slice(first, last + 1).trim() : raw.trim();
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
  const preview =
    draft.content && sourceExists && imageCount > 0
      ? renderCaption(draft.content, imageCount, copyrightedCharacter)
      : null;
  const expectedInputHash =
    draft.content && sourceDirectory
      ? renderInputHash(draft.content, imageCount, sourceDirectory, copyrightedCharacter)
      : null;
  // Old metadata lacks versioned inputs/output hashes and must be regenerated.
  // A missing caption.txt after an earlier build is stale rather than a fresh ready state.
  const stale =
    Boolean(build) || captionExists
      ? !build ||
        !captionExists ||
        !sourceDirectory ||
        build.sourceDirectory !== sourceDirectory ||
        build.imageCount !== imageCount ||
        !draft.content ||
        build.contentSha256 !== contentHash(draft.content) ||
        !build.renderInputSha256 ||
        build.renderInputSha256 !== expectedInputHash ||
        !build.outputSha256 ||
        build.outputSha256 !== sha256(actualCaption ?? '') ||
        preview !== actualCaption
      : false;

  let state: CaptionStatus['state'];
  if (!sourceDirectory) state = 'unconfigured';
  else if (!sourceExists) state = 'source-missing';
  else if (
    !draft.content &&
    draft.validation.issues.some((issue) => issue.code === 'CAPTION_CONTENT_MISSING')
  )
    state = 'missing-content';
  else if (!draft.validation.valid) state = 'invalid-content';
  else if (stale) state = 'stale';
  else if (!captionExists) state = 'ready';
  else state = 'generated';

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
  const extracted = jsonCandidate(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted);
  } catch {
    return {
      extracted,
      validation: {
        valid: false,
        issues: [
          {
            severity: 'error',
            code: 'CAPTION_CONTENT_PARSE',
            message: 'Grokの caption_content.json をJSONとして解析できません。',
          },
        ],
      },
      summary: {},
      missingRequirements: [],
    };
  }
  const validation = validateCaptionContent(parsed);
  // Invalid manual or automatic imports must not replace a previously valid draft.
  if (validation.valid) await writeJsonAtomic(draftPath(root), parsed);
  const summary: ImportResult['summary'] = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const value = parsed as Partial<CaptionContent>;
    summary.titleJa = value.title?.ja ?? null;
    summary.titleEn = value.title?.en ?? null;
    summary.pixivTitleJa = value.pixivTitle?.ja ?? null;
    summary.pixivTitleEn = value.pixivTitle?.en ?? null;
    summary.descriptionJa = Array.isArray(value.description?.ja) ? value.description.ja.length : 0;
    summary.descriptionEn = Array.isArray(value.description?.en) ? value.description.en.length : 0;
    summary.contentsJa = Array.isArray(value.contents?.ja) ? value.contents.ja.length : 0;
    summary.contentsEn = Array.isArray(value.contents?.en) ? value.contents.en.length : 0;
  }
  return {
    extracted: JSON.stringify(parsed, null, 2),
    validation,
    summary,
    missingRequirements: [],
  };
}

export async function savePixivTitle(root: string, value: unknown): Promise<CaptionStatus> {
  const draft = await readDraft(root);
  if (!draft.content) throw new Error('有効な caption_content.json の下書きがありません。');
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('日本語と英語のPixiv用タイトルを指定してください。');
  const incoming = value as Record<string, unknown>;
  const title = {
    ja: typeof incoming.ja === 'string' ? incoming.ja.trim() : incoming.ja,
    en: typeof incoming.en === 'string' ? incoming.en.trim() : incoming.en,
  };
  const issues = validatePixivTitle(title);
  if (issues.length) throw new Error(issues.map((issue) => issue.message).join(' / '));

  const next: CaptionContent = {
    ...draft.content,
    schemaVersion: 2,
    pixivTitle: title as { ja: string; en: string },
  };
  const validation = validateCaptionContent(next);
  if (!validation.valid)
    throw new Error(validation.issues.map((issue) => issue.message).join(' / '));
  await writeJsonAtomic(draftPath(root), next);
  return getCaptionStatus(root);
}

export async function generateCaption(root: string): Promise<CaptionStatus> {
  const status = await getCaptionStatus(root);
  if (!status.sourceDirectory) throw new Error('最終成果物ディレクトリを指定してください。');
  if (!status.sourceExists) throw new Error('指定された最終成果物ディレクトリが見つかりません。');
  if (!status.content || !status.contentValidation.valid)
    throw new Error('有効な caption_content.json をGrokから取り込んでください。');
  if (status.imageCount < 1) throw new Error('最終成果物ディレクトリに対象画像がありません。');
  if (!status.preview) throw new Error('caption.txt の生成内容を構築できません。');

  await writeTextAtomic(status.captionPath, status.preview);
  const brief = await readJson<ProjectBriefInput>(path.join(root, 'project_brief.json'));
  const build: CaptionBuildInfo = {
    schemaVersion: 1,
    sourceDirectory: status.sourceDirectory,
    imageCount: status.imageCount,
    contentSha256: contentHash(status.content),
    renderInputSha256: renderInputHash(
      status.content,
      status.imageCount,
      status.sourceDirectory,
      brief?.subject?.copyrightedCharacter === true,
    ),
    outputSha256: sha256(status.preview),
    generatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(buildPath(root), build);
  return getCaptionStatus(root);
}
