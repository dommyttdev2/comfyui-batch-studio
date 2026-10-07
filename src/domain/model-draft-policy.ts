import type {
  ImportResult,
  MissingRequirement,
  ModelsArtifact,
  PromptFallback,
  ValidationResult,
} from './artifact-types.js';
import { validateModels } from './artifact-validation.js';
export function missing(parsed: any): MissingRequirement[] {
  return Array.isArray(parsed?.missingRequirements)
    ? parsed.missingRequirements.filter(
        (x: any) =>
          x &&
          typeof x.role === 'string' &&
          typeof x.requirement === 'string' &&
          typeof x.reason === 'string',
      )
    : [];
}
export function fallbackTags(value: unknown) {
  if (Array.isArray(value))
    return value
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim())
      .filter(Boolean);
  if (typeof value === 'string')
    return value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  return [];
}
export function normalizePromptFallback(x: any): PromptFallback | null {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return null;
  const allowed = new Set([
    'requirement',
    'positiveTags',
    'negativeTags',
    'positive',
    'negative',
    'reason',
  ]);
  if (Object.keys(x).some((key) => !allowed.has(key))) return null;
  if (typeof x.requirement !== 'string' || !x.requirement.trim()) return null;
  if (typeof x.reason !== 'string' || !x.reason.trim()) return null;
  const positiveTags = fallbackTags(x.positiveTags ?? x.positive);
  const negativeTags = fallbackTags(x.negativeTags ?? x.negative);
  if (!positiveTags.length && !negativeTags.length) return null;
  if ([...positiveTags, ...negativeTags].some((tag) => /[\r\n,]/.test(tag) || !tag.trim()))
    return null;
  return {
    requirement: x.requirement.trim(),
    positiveTags,
    negativeTags,
    reason: x.reason.trim(),
  };
}
export function validPromptFallback(x: any) {
  return normalizePromptFallback(x) != null;
}
export function promptFallbacks(parsed: any): PromptFallback[] {
  return Array.isArray(parsed?.promptFallbacks)
    ? parsed.promptFallbacks
        .map(normalizePromptFallback)
        .filter((value: PromptFallback | null): value is PromptFallback => value != null)
    : [];
}
export function promptFallbacksValid(parsed: any) {
  return (
    !Object.prototype.hasOwnProperty.call(parsed ?? {}, 'promptFallbacks') ||
    (Array.isArray(parsed.promptFallbacks) && parsed.promptFallbacks.every(validPromptFallback))
  );
}
export function splitModelDraft(
  value: ModelsArtifact & { promptFallbacks?: unknown; missingRequirements?: unknown },
) {
  const models = JSON.parse(JSON.stringify(value)) as typeof value;
  delete models.promptFallbacks;
  delete models.missingRequirements;
  return { models, fallbacks: promptFallbacks(value), missingRequirements: missing(value) };
}
export function validateModelDraft(value: ModelsArtifact): ValidationResult {
  const raw: any = value;
  const hasMissing = Object.hasOwn(raw, 'missingRequirements'),
    hasFallbacks = Object.hasOwn(raw, 'promptFallbacks'),
    unresolved = missing(raw);
  const base = validateModels(splitModelDraft(raw).models);
  if (hasFallbacks && !promptFallbacksValid(raw))
    base.issues.push({
      severity: 'error',
      code: 'PROMPT_FALLBACKS_FORMAT',
      message:
        'promptFallbacksの形式が不正です。requirement/reasonは必須で、positiveTags/negativeTagsの少なくとも一方が必要です。',
    });
  if (hasMissing) {
    if (
      !Array.isArray(raw.missingRequirements) ||
      raw.missingRequirements.some(
        (x: any) =>
          !x ||
          typeof x.role !== 'string' ||
          typeof x.requirement !== 'string' ||
          typeof x.reason !== 'string',
      )
    )
      base.issues.push({
        severity: 'error',
        code: 'MISSING_REQUIREMENTS_FORMAT',
        message: 'missingRequirementsの形式が不正です。',
      });
    else if (unresolved.length)
      base.issues.push({
        severity: 'error',
        code: 'MISSING_REQUIREMENTS',
        message: `未解決の不足モデルが${unresolved.length}件あります。`,
      });
    else
      base.issues.push({
        severity: 'error',
        code: 'DRAFT_ONLY_FIELD',
        message:
          'missingRequirementsは確定models.jsonに保存できません。空の場合は削除してください。',
      });
  }
  base.valid = !base.issues.some((x) => x.severity === 'error');
  return base;
}
export function mergeLoraImport(base: ModelsArtifact | null, payload: unknown, currentOnly = true) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload))
    throw new Error('GROK_MODELS_SHAPE');
  const input = payload as Record<string, unknown>;
  const rejected = validateLoraImportPayload(input, JSON.stringify(input));
  if (rejected) throw new Error(rejected.validation.issues[0].code);
  if (
    Object.hasOwn(input, 'missingRequirements') &&
    (!Array.isArray(input.missingRequirements) ||
      input.missingRequirements.some(
        (x: any) =>
          !x ||
          typeof x.role !== 'string' ||
          typeof x.requirement !== 'string' ||
          typeof x.reason !== 'string',
      ))
  )
    throw new Error('MISSING_REQUIREMENTS_FORMAT');
  if (
    !base ||
    (currentOnly ? base.schemaVersion !== 5 : ![2, 3, 4, 5].includes(base.schemaVersion))
  )
    throw new Error('BASE_MODELS_REQUIRED');
  const merged: any = { ...splitModelDraft(base).models, loras: input.loras };
  const fallbacks = promptFallbacks(input),
    unresolved = missing(input);
  if (fallbacks.length) merged.promptFallbacks = fallbacks;
  if (unresolved.length) merged.missingRequirements = unresolved;
  return merged as ModelsArtifact;
}

export function rejectedModelsImport(
  extracted: string,
  code: string,
  message: string,
  miss: MissingRequirement[] = [],
): ImportResult {
  return {
    extracted,
    validation: { valid: false, issues: [{ severity: 'error', code, message }] },
    summary: {},
    missingRequirements: miss,
  };
}
export function validateLoraImportPayload(payload: any, extracted: string): ImportResult | null {
  const miss = missing(payload);
  const allowed = new Set(['schemaVersion', 'loras', 'promptFallbacks', 'missingRequirements']);
  const unknown = Object.keys(payload ?? {}).filter((k) => !allowed.has(k));
  const forbidden = [
    'checkpoint',
    'diffusionModel',
    'textEncoder',
    'clip',
    'vae',
    'modelFamily',
  ].filter((k) => Object.prototype.hasOwnProperty.call(payload ?? {}, k));
  if (forbidden.length)
    return rejectedModelsImport(
      extracted,
      'GROK_BASE_MODEL_OVERRIDE',
      `Grokはユーザー選択済み基盤モデルを変更できません: ${forbidden.join(', ')}`,
      miss,
    );
  if (unknown.length)
    return rejectedModelsImport(
      extracted,
      'GROK_MODELS_SHAPE',
      `LoRA選定ファイルに未定義fieldがあります: ${unknown.join(', ')}`,
      miss,
    );
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload?.loras))
    return rejectedModelsImport(
      extracted,
      'GROK_MODELS_SHAPE',
      'LoRA選定ファイルは schemaVersion: 1 と loras 配列が必要です。',
      miss,
    );
  if (!promptFallbacksValid(payload))
    return rejectedModelsImport(
      extracted,
      'PROMPT_FALLBACKS_FORMAT',
      'promptFallbacksは requirement / positiveTags / negativeTags / reason を持ち、positiveTags / negativeTags の少なくとも一方を指定してください。',
      miss,
    );
  return null;
}
