import { createHash, randomUUID } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
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
import { exists, readJson, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

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

function contentHash(content: CaptionContent) {
  return sha256(JSON.stringify(content));
}

function jsonCandidate(raw: string) {
  const fence = raw.match(/```json\s*\n([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  return first >= 0 && last > first ? raw.slice(first, last + 1).trim() : raw.trim();
}

function onlyKeys(value: Record<string, unknown>, allowed: string[]) {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function nonEmptyStringArray(value: unknown) {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0)
  );
}

export function validateCaptionContent(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      valid: false,
      issues: [
        {
          severity: 'error',
          code: 'CAPTION_CONTENT_OBJECT',
          message: 'caption_content.json のrootはobjectである必要があります。',
        },
      ],
    };
  }
  const root = value as Record<string, unknown>;
  if (!onlyKeys(root, ['schemaVersion', 'title', 'description', 'contents']))
    issues.push({
      severity: 'error',
      code: 'CAPTION_CONTENT_FIELDS',
      message: 'caption_content.json に未定義fieldがあります。',
    });
  if (root.schemaVersion !== 1)
    issues.push({
      severity: 'error',
      code: 'CAPTION_CONTENT_SCHEMA_VERSION',
      message: 'caption_content.json の schemaVersion は 1 である必要があります。',
    });

  const title = root.title;
  if (
    !title ||
    typeof title !== 'object' ||
    Array.isArray(title) ||
    !onlyKeys(title as Record<string, unknown>, ['ja', 'en']) ||
    !nonEmptyString((title as Record<string, unknown>).ja) ||
    !nonEmptyString((title as Record<string, unknown>).en)
  )
    issues.push({
      severity: 'error',
      code: 'CAPTION_CONTENT_TITLE',
      message: 'title.ja / title.en は空でない文字列で指定してください。',
    });

  const description = root.description;
  if (
    !description ||
    typeof description !== 'object' ||
    Array.isArray(description) ||
    !onlyKeys(description as Record<string, unknown>, ['ja', 'en']) ||
    !nonEmptyStringArray((description as Record<string, unknown>).ja) ||
    !nonEmptyStringArray((description as Record<string, unknown>).en)
  )
    issues.push({
      severity: 'error',
      code: 'CAPTION_CONTENT_DESCRIPTION',
      message: 'description.ja / description.en は1件以上の空でない文字列配列で指定してください。',
    });

  if (root.contents !== undefined) {
    const contents = root.contents;
    if (
      !contents ||
      typeof contents !== 'object' ||
      Array.isArray(contents) ||
      !onlyKeys(contents as Record<string, unknown>, ['ja', 'en']) ||
      !nonEmptyStringArray((contents as Record<string, unknown>).ja) ||
      !nonEmptyStringArray((contents as Record<string, unknown>).en)
    )
      issues.push({
        severity: 'error',
        code: 'CAPTION_CONTENT_CONTENTS',
        message: 'contentsを指定する場合は ja / en を1件以上の空でない文字列配列で指定してください。',
      });
  }

  return { valid: !issues.some((issue) => issue.severity === 'error'), issues };
}

async function isDirectory(directory: string) {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function countImages(directory: string): Promise<number> {
  let count = 0;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) count += await countImages(full);
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) count += 1;
  }
  return count;
}

function renderContents(lines: string[], prefix: string) {
  return lines.map((line) => `${prefix}${line.trim()}`).join('\n');
}

export function renderCaption(
  content: CaptionContent,
  imageCount: number,
  copyrightedCharacter: boolean,
) {
  const japanese: string[] = [
    content.title.ja.trim(),
    '',
    content.description.ja.map((line) => line.trim()).join('\n\n'),
  ];
  if (content.contents) {
    japanese.push('', '■内容', renderContents(content.contents.ja, '　'));
  }
  japanese.push('', '■収録枚数', `　全${imageCount}枚`, '');
  if (copyrightedCharacter) japanese.push('※二次創作です。公式とは無関係です。');
  japanese.push('※AI生成作品です。', '', '--- English ---', '');

  const english: string[] = [
    content.title.en.trim(),
    '',
    content.description.en.map((line) => line.trim()).join('\n\n'),
  ];
  if (content.contents) {
    english.push('', '■ Contents', renderContents(content.contents.en, '  '));
  }
  english.push('', '■ Images', `  Total ${imageCount} images.`, '');
  if (copyrightedCharacter) english.push('※ Fan work. Unrelated to the official series.');
  english.push('※ AI-generated.');

  return [...japanese, ...english].join('\n').trimEnd() + '\n';
}

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
  const meta = await readProjectMeta(root);
  const configured = meta?.settings.captionSourceDirectory?.trim() ?? '';
  const sourceDirectory = configured || null;
  const sourceExists = sourceDirectory ? await isDirectory(sourceDirectory) : false;
  const imageCount = sourceExists && sourceDirectory ? await countImages(sourceDirectory) : 0;
  const draft = await readDraft(root);
  const captionPath = outputPath(root);
  const captionExists = await exists(captionPath);
  const build = await readJson<CaptionBuildInfo>(buildPath(root));
  const brief = await readJson<ProjectBriefInput & { schemaVersion?: number }>(
    path.join(root, 'project_brief.json'),
  );
  const preview =
    draft.content && sourceExists && imageCount > 0
      ? renderCaption(draft.content, imageCount, brief?.subject?.copyrightedCharacter === true)
      : null;
  const stale =
    captionExists &&
    (!build ||
      !sourceDirectory ||
      build.sourceDirectory !== sourceDirectory ||
      build.imageCount !== imageCount ||
      !draft.content ||
      build.contentSha256 !== contentHash(draft.content));

  let state: CaptionStatus['state'];
  if (!sourceDirectory) state = 'unconfigured';
  else if (!sourceExists) state = 'source-missing';
  else if (!draft.content && draft.validation.issues.some((issue) => issue.code === 'CAPTION_CONTENT_MISSING'))
    state = 'missing-content';
  else if (!draft.validation.valid) state = 'invalid-content';
  else if (!captionExists) state = 'ready';
  else state = stale ? 'stale' : 'generated';

  return {
    state,
    sourceDirectory,
    sourceExists,
    imageCount,
    imageExtensions: [...IMAGE_EXTENSIONS],
    content: draft.content,
    contentValidation: draft.validation,
    captionPath,
    captionExists,
    stale,
    build,
    preview,
  };
}

async function saveRawResponse(root: string, raw: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(
    internalDir(root),
    'grok-responses',
    'caption',
    `${stamp}-${randomUUID()}.txt`,
  );
  await writeTextAtomic(file, raw);
}

export async function importCaptionGrok(root: string, raw: string): Promise<ImportResult> {
  await saveRawResponse(root, raw);
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
  await writeJsonAtomic(draftPath(root), parsed);
  const summary: ImportResult['summary'] = {};
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const value = parsed as Partial<CaptionContent>;
    summary.titleJa = value.title?.ja ?? null;
    summary.titleEn = value.title?.en ?? null;
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

export async function generateCaption(root: string): Promise<CaptionStatus> {
  const status = await getCaptionStatus(root);
  if (!status.sourceDirectory)
    throw new Error('最終成果物ディレクトリを指定してください。');
  if (!status.sourceExists)
    throw new Error('指定された最終成果物ディレクトリが見つかりません。');
  if (!status.content || !status.contentValidation.valid)
    throw new Error('有効な caption_content.json をGrokから取り込んでください。');
  if (status.imageCount < 1)
    throw new Error('最終成果物ディレクトリに対象画像がありません。');
  if (!status.preview) throw new Error('caption.txt の生成内容を構築できません。');

  await writeTextAtomic(status.captionPath, status.preview);
  const build: CaptionBuildInfo = {
    schemaVersion: 1,
    sourceDirectory: status.sourceDirectory,
    imageCount: status.imageCount,
    contentSha256: contentHash(status.content),
    generatedAt: new Date().toISOString(),
  };
  await writeJsonAtomic(buildPath(root), build);
  return getCaptionStatus(root);
}
