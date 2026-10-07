import type { CaptionContent, ValidationIssue, ValidationResult } from './artifact-types.js';

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

export function validatePixivTitle(value: unknown): ValidationIssue[] {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !onlyKeys(value as Record<string, unknown>, ['ja', 'en'])
  ) {
    return [
      {
        severity: 'error',
        code: 'CAPTION_PIXIV_TITLE',
        message: 'pixivTitle.ja / pixivTitle.en を指定してください。',
      },
    ];
  }
  const title = value as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  for (const lang of ['ja', 'en'] as const) {
    const text = title[lang];
    if (
      typeof text !== 'string' ||
      !text.trim() ||
      /[\r\n\u2028\u2029]/.test(text) ||
      Array.from(text).length > 32
    ) {
      issues.push({
        severity: 'error',
        code: 'CAPTION_PIXIV_TITLE_' + lang.toUpperCase(),
        message:
          'pixivTitle.' +
          lang +
          ' は改行を含まない1～32文字で指定してください。' +
          (typeof text === 'string' ? ' 現在 ' + Array.from(text).length + '文字。' : ''),
      });
    }
  }
  return issues;
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
  if (!onlyKeys(root, ['schemaVersion', 'title', 'pixivTitle', 'description', 'contents']))
    issues.push({
      severity: 'error',
      code: 'CAPTION_CONTENT_FIELDS',
      message: 'caption_content.json に未定義fieldがあります。',
    });
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2)
    issues.push({
      severity: 'error',
      code: 'CAPTION_CONTENT_SCHEMA_VERSION',
      message: 'caption_content.json の schemaVersion は 1 または 2 である必要があります。',
    });
  if (root.schemaVersion === 1 && root.pixivTitle !== undefined)
    issues.push({
      severity: 'error',
      code: 'CAPTION_CONTENT_LEGACY_PIXIV_TITLE',
      message: 'schemaVersion 1 に pixivTitle は指定できません。',
    });
  if (root.schemaVersion === 2) issues.push(...validatePixivTitle(root.pixivTitle));

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
        message:
          'contentsを指定する場合は ja / en を1件以上の空でない文字列配列で指定してください。',
      });
  }

  return { valid: !issues.some((issue) => issue.severity === 'error'), issues };
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
