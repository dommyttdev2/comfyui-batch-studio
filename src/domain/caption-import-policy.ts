import type { CaptionContent, ImportResult } from './artifact-types.js';
import { validateCaptionContent, validatePixivTitle } from './caption-policy.js';
export function updatePixivTitle(content: CaptionContent, value: unknown) {
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
    ...content,
    schemaVersion: 2,
    pixivTitle: title as { ja: string; en: string },
  };
  const validation = validateCaptionContent(next);
  if (!validation.valid)
    throw new Error(validation.issues.map((issue) => issue.message).join(' / '));
  return next;
}
function jsonCandidate(raw: string) {
  const fence = raw.match(/```json\s*\n([\s\S]*?)```/i);
  if (fence?.[1]) return fence[1].trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  return first >= 0 && last > first ? raw.slice(first, last + 1).trim() : raw.trim();
}

export function importCaptionResponse(raw: string): ImportResult {
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
