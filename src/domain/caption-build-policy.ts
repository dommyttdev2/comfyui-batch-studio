import type {
  CaptionBuildInfo,
  CaptionContent,
  CaptionStatus,
  ValidationResult,
} from './artifact-types.js';
import { renderCaption } from './caption-policy.js';
export function captionBodyContent(content: CaptionContent): CaptionContent {
  if (content.schemaVersion === 1) return content;
  // v2 Pixiv titles are independent of caption.txt and its build fingerprints.
  const { pixivTitle: _pixivTitle, ...body } = content;
  return { ...body, schemaVersion: 1 };
}

export function captionContentHash(content: CaptionContent, sha256: (value: string) => string) {
  return sha256(JSON.stringify(captionBodyContent(content)));
}

// Increment when fixed text, formatting, or localization in renderCaption changes.
const CAPTION_TEMPLATE_VERSION = 2;

export function captionRenderInputHash(
  content: CaptionContent,
  imageCount: number,
  sourceDirectory: string,
  copyrightedCharacter: boolean,
  sha256: (value: string) => string,
) {
  return sha256(
    JSON.stringify({
      templateVersion: CAPTION_TEMPLATE_VERSION,
      content: captionBodyContent(content),
      imageCount,
      sourceDirectory: sourceDirectory,
      copyrightedCharacter,
    }),
  );
}

export interface CaptionBuildFacts {
  sourceDirectory: string | null;
  sourceExists: boolean;
  imageCount: number;
  content: CaptionContent | null;
  validation: ValidationResult;
  actualCaption: string | null;
  build: CaptionBuildInfo | null;
  copyrightedCharacter: boolean;
}
export function assessCaptionBuild(facts: CaptionBuildFacts, sha256: (value: string) => string) {
  const {
    sourceDirectory,
    sourceExists,
    imageCount,
    content,
    validation,
    actualCaption,
    build,
    copyrightedCharacter,
  } = facts;
  const captionExists = actualCaption !== null;
  const preview =
    content && sourceExists && imageCount > 0
      ? renderCaption(content, imageCount, copyrightedCharacter)
      : null;
  const expectedInputHash =
    content && sourceDirectory
      ? captionRenderInputHash(content, imageCount, sourceDirectory, copyrightedCharacter, sha256)
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
        !content ||
        build.contentSha256 !== captionContentHash(content, sha256) ||
        !build.renderInputSha256 ||
        build.renderInputSha256 !== expectedInputHash ||
        !build.outputSha256 ||
        build.outputSha256 !== sha256(actualCaption ?? '') ||
        preview !== actualCaption
      : false;

  let state: CaptionStatus['state'];
  if (!sourceDirectory) state = 'unconfigured';
  else if (!sourceExists) state = 'source-missing';
  else if (!content && validation.issues.some((issue) => issue.code === 'CAPTION_CONTENT_MISSING'))
    state = 'missing-content';
  else if (!validation.valid) state = 'invalid-content';
  else if (stale) state = 'stale';
  else if (!captionExists) state = 'ready';
  else state = 'generated';
  return { state, stale, preview, captionExists };
}
export function assertCaptionBuildable(
  facts: CaptionBuildFacts,
  preview: string | null,
): asserts preview is string {
  if (!facts.sourceDirectory) throw new Error('最終成果物ディレクトリを指定してください。');
  if (!facts.sourceExists) throw new Error('指定された最終成果物ディレクトリが見つかりません。');
  if (!facts.content || !facts.validation.valid)
    throw new Error('有効な caption_content.json をGrokから取り込んでください。');
  if (facts.imageCount < 1) throw new Error('最終成果物ディレクトリに対象画像がありません。');
  if (!preview) throw new Error('caption.txt の生成内容を構築できません。');
}
