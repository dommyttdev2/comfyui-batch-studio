import { randomUUID } from 'node:crypto';
import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArtifactKey,
  ArtifactReadResult,
  ImportResult,
  MissingRequirement,
  ModelsArtifact,
  PromptPlanArtifact,
  ProjectBriefInput,
  ValidationResult,
} from '../shared/types.js';
import {
  backupIfExists,
  exists,
  readJson,
  readText,
  removeIfExists,
  writeJsonAtomic,
  writeTextAtomic,
} from './fs-utils.js';
import {
  parseModels,
  parsePromptPlan,
  validateModels,
  validateProjectBrief,
  validatePromptPlan,
} from './validation.js';
import { loadCatalog, validateModelsAgainstCatalog } from './model-catalog.js';
import { isRenderablePromptPlan } from '../shared/prompt-plan-shape.js';
import { modelGenerationInputsChanged, resetModelDownstream } from './model-downstream-reset.js';
const FILES: Partial<Record<ArtifactKey, string>> = {
  projectBrief: 'project_brief.json',
  story: 'story.md',
  models: 'models.json',
  promptPlan: 'prompt_plan.json',
};
const DRAFTS: Partial<Record<ArtifactKey, string>> = {
  story: 'story.md',
  models: 'models.json',
  promptPlan: 'prompt_plan.json',
};
type GrokImportKey = 'story' | 'models' | 'promptPlan';
type GrokResponseStage =
  | 'story-finalize'
  | 'story-fix'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'prompt-plan-fix';
type PromptFallback = {
  requirement: string;
  positiveTags: string[];
  negativeTags: string[];
  reason: string;
};
type ModelsDraftSource = { schemaVersion: 1; stage: 'models' | 'models-fix' };
export const internalDir = (root: string) => path.join(root, '._batch_studio');
export function draftPath(root: string, key: ArtifactKey) {
  const n = DRAFTS[key];
  if (!n) throw new Error(`No draft mapping for ${key}`);
  return path.join(internalDir(root), 'drafts', n);
}
export function confirmedPath(root: string, key: ArtifactKey) {
  const n = FILES[key];
  if (!n) throw new Error(`No artifact mapping for ${key}`);
  return path.join(root, n);
}
function promptFallbacksPath(root: string) {
  return path.join(internalDir(root), 'model_prompt_fallbacks.json');
}
function modelsDraftSourcePath(root: string) {
  return path.join(internalDir(root), 'draft-sources', 'models.json');
}
async function readModelsDraftSource(root: string): Promise<ModelsDraftSource | null> {
  const value = await readJson<ModelsDraftSource>(modelsDraftSourcePath(root));
  return value?.schemaVersion === 1 && (value.stage === 'models' || value.stage === 'models-fix')
    ? value
    : null;
}
function fence(raw: string, lang?: string) {
  const spec = lang ?? '[a-zA-Z0-9_-]*';
  const m = raw.match(new RegExp('```' + spec + '\\s*\\n([\\s\\S]*?)```', 'i'));
  return m?.[1]?.trim() ?? null;
}
function jsonCandidate(raw: string) {
  const f = fence(raw, 'json');
  if (f) return f;
  const a = raw.indexOf('{'),
    b = raw.lastIndexOf('}');
  return a >= 0 && b > a ? raw.slice(a, b + 1).trim() : raw.trim();
}
function storyCandidate(raw: string) {
  return fence(raw, 'markdown') ?? fence(raw, 'md') ?? fence(raw) ?? raw.trim();
}
function missing(parsed: any): MissingRequirement[] {
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
function fallbackTags(value: unknown) {
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
function normalizePromptFallback(x: any): PromptFallback | null {
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
function validPromptFallback(x: any) {
  return normalizePromptFallback(x) != null;
}
function promptFallbacks(parsed: any): PromptFallback[] {
  return Array.isArray(parsed?.promptFallbacks)
    ? parsed.promptFallbacks
        .map(normalizePromptFallback)
        .filter((value: PromptFallback | null): value is PromptFallback => value != null)
    : [];
}
function promptFallbacksValid(parsed: any) {
  return (
    !Object.prototype.hasOwnProperty.call(parsed ?? {}, 'promptFallbacks') ||
    (Array.isArray(parsed.promptFallbacks) && parsed.promptFallbacks.every(validPromptFallback))
  );
}
function grokResponseStage(key: GrokImportKey, isFix: boolean): GrokResponseStage {
  if (key === 'story') return isFix ? 'story-fix' : 'story-finalize';
  if (key === 'models') return isFix ? 'models-fix' : 'models';
  return isFix ? 'prompt-plan-fix' : 'prompt-plan';
}
function stageMatchesKey(key: GrokImportKey, stage: GrokResponseStage) {
  if (key === 'story') return stage === 'story-finalize' || stage === 'story-fix';
  if (key === 'models') return stage === 'models' || stage === 'models-fix';
  return stage === 'prompt-plan' || stage === 'prompt-plan-fix';
}
async function saveRawGrokResponse(
  root: string,
  key: GrokImportKey,
  raw: string,
  stageOverride?: GrokResponseStage,
) {
  const isFix = await exists(confirmedPath(root, key)),
    inferred = grokResponseStage(key, isFix),
    stage = stageOverride ?? inferred;
  if (!stageMatchesKey(key, stage))
    throw new Error(`Invalid Grok response stage for ${key}: ${stage}`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(
    internalDir(root),
    'grok-responses',
    stage,
    `${stamp}-${randomUUID()}.txt`,
  );
  await writeTextAtomic(file, raw);
  return { file, stage };
}
async function validateContent(
  root: string,
  key: ArtifactKey,
  content: string,
): Promise<ValidationResult> {
  if (key === 'story')
    return {
      valid: !!content.trim(),
      issues: content.trim()
        ? []
        : [{ severity: 'error', code: 'STORY_EMPTY', message: 'ストーリーが空です。' }],
    };
  if (key === 'models') {
    const p = parseModels(content);
    if (!p)
      return {
        valid: false,
        issues: [
          {
            severity: 'error',
            code: 'MODELS_PARSE',
            message: 'models.jsonをJSONとして解析できません。',
          },
        ],
      };
    const raw: any = p;
    const hasMissing = Object.prototype.hasOwnProperty.call(raw, 'missingRequirements');
    const hasFallbacks = Object.prototype.hasOwnProperty.call(raw, 'promptFallbacks');
    const unresolved = missing(raw);
    const schemaCandidate = structuredClone(raw);
    delete schemaCandidate.missingRequirements;
    delete schemaCandidate.promptFallbacks;
    const base = validateModels(schemaCandidate);
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
    return base.valid ? validateModelsAgainstCatalog(root, schemaCandidate, base) : base;
  }
  if (key === 'promptPlan') {
    const p = parsePromptPlan(content);
    if (!p)
      return {
        valid: false,
        issues: [
          {
            severity: 'error',
            code: 'PLAN_PARSE',
            message: 'prompt_plan.jsonをJSONとして解析できません。',
          },
        ],
      };
    const mt = await readText(path.join(root, 'models.json'));
    return validatePromptPlan(p, mt ? parseModels(mt) : null);
  }
  if (key === 'projectBrief') {
    try {
      return validateProjectBrief(JSON.parse(content) as ProjectBriefInput);
    } catch {
      return {
        valid: false,
        issues: [
          {
            severity: 'error',
            code: 'BRIEF_PARSE',
            message: 'project_brief.jsonを解析できません。',
          },
        ],
      };
    }
  }
  return { valid: true, issues: [] };
}
async function refreshModelsCatalogProvenance(
  root: string,
  source: 'confirmed' | 'draft',
  file: string,
  content: string,
) {
  if (source === 'confirmed' && (await exists(draftPath(root, 'models')))) return content;
  const parsed: any = parseModels(content);
  if (!parsed) return content;
  const schemaCandidate = structuredClone(parsed);
  delete schemaCandidate.missingRequirements;
  delete schemaCandidate.promptFallbacks;
  const base = validateModels(schemaCandidate);
  if (!base.valid) return content;
  const checked = await validateModelsAgainstCatalog(root, schemaCandidate, base);
  if (!checked.valid) return content;
  const catalog = await loadCatalog(root);
  if (!catalog) return content;
  const current = parsed.catalog;
  if (
    current?.schemaVersion === catalog.schemaVersion &&
    current?.generation === catalog.generation &&
    current?.generatedAt === catalog.generatedAt
  )
    return content;
  parsed.catalog = {
    schemaVersion: catalog.schemaVersion,
    generation: catalog.generation,
    generatedAt: catalog.generatedAt,
  };
  const updated = JSON.stringify(parsed, null, 2) + '\n';
  await writeTextAtomic(file, updated);
  return updated;
}
export async function readArtifact(
  root: string,
  key: ArtifactKey,
  source: 'confirmed' | 'draft',
): Promise<ArtifactReadResult> {
  if (!FILES[key] && source === 'confirmed')
    return {
      key,
      source,
      content: null,
      exists: false,
      validation: {
        valid: false,
        issues: [{ severity: 'error', code: 'MISSING', message: '対象Artifactではありません。' }],
      },
    };
  if (!DRAFTS[key] && source === 'draft')
    return {
      key,
      source,
      content: null,
      exists: false,
      validation: {
        valid: false,
        issues: [{ severity: 'error', code: 'MISSING', message: '下書き対象ではありません。' }],
      },
    };
  const file = source === 'confirmed' ? confirmedPath(root, key) : draftPath(root, key);
  let content = await readText(file);
  if (key === 'models' && content != null)
    content = await refreshModelsCatalogProvenance(root, source, file, content);
  if (key === 'promptPlan' && source === 'draft' && content != null) {
    const parsed = parsePromptPlan(content);
    if (!parsed || !isRenderablePromptPlan(parsed)) content = null;
  }
  return {
    key,
    source,
    content,
    exists: content != null,
    validation:
      content == null
        ? {
            valid: false,
            issues: [{ severity: 'error', code: 'MISSING', message: 'ファイルがありません。' }],
          }
        : await validateContent(root, key, content),
  };
}
export async function saveDraft(
  root: string,
  key: 'story' | 'models' | 'promptPlan',
  content: string,
) {
  if (key === 'models') await removeIfExists(modelsDraftSourcePath(root));
  await writeTextAtomic(draftPath(root, key), content.endsWith('\n') ? content : content + '\n');
  return readArtifact(root, key, 'draft');
}
function rejectedModelsImport(
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
export async function importGrok(
  root: string,
  key: 'story' | 'models' | 'promptPlan',
  raw: string,
  stageOverride?: GrokResponseStage,
): Promise<ImportResult> {
  const response = await saveRawGrokResponse(root, key, raw, stageOverride);
  let extracted = key === 'story' ? storyCandidate(raw) : jsonCandidate(raw),
    miss: MissingRequirement[] = [];
  if (key === 'models') {
    let payload: any;
    try {
      payload = JSON.parse(extracted);
    } catch {
      return rejectedModelsImport(
        extracted,
        'MODELS_PARSE',
        'GrokのLoRA選定ファイルをJSONとして解析できません。',
      );
    }
    miss = missing(payload);
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
    const fallbacks = promptFallbacks(payload);
    const baseText =
      (await readText(draftPath(root, 'models'))) ??
      (await readText(confirmedPath(root, 'models')));
    const base = baseText ? parseModels(baseText) : null;
    if (!base || ![2, 3, 4, 5].includes(base.schemaVersion))
      return rejectedModelsImport(
        extracted,
        'BASE_MODELS_REQUIRED',
        '先にModel系統とユーザー選択モデルを保存してください。',
        miss,
      );
    const merged: any = { ...base, loras: payload.loras };
    delete merged.promptFallbacks;
    delete merged.missingRequirements;
    if (fallbacks.length) merged.promptFallbacks = fallbacks;
    if (miss.length) merged.missingRequirements = miss;
    extracted = JSON.stringify(merged, null, 2);
  }
  if (key === 'promptPlan') {
    const parsed = parsePromptPlan(extracted);
    if (!parsed || !isRenderablePromptPlan(parsed)) {
      const checked = await validateContent(root, key, extracted),
        issues = checked.issues.length
          ? checked.issues
          : [
              {
                severity: 'error' as const,
                code: 'PLAN_RENDER_SHAPE',
                message:
                  'prompt_plan.jsonの構造が不正なため、現在のPrompt Plan下書きは更新されませんでした。',
              },
            ];
      return {
        extracted,
        validation: { valid: false, issues },
        summary: {},
        missingRequirements: [],
      };
    }
  }
  const saved = await saveDraft(root, key, extracted);
  if (key === 'models' && (response.stage === 'models' || response.stage === 'models-fix'))
    await writeJsonAtomic(modelsDraftSourcePath(root), {
      schemaVersion: 1,
      stage: response.stage,
    } satisfies ModelsDraftSource);
  const issues = [...saved.validation.issues];
  if (miss.length && !issues.some((x) => x.code === 'MISSING_REQUIREMENTS'))
    issues.push({
      severity: 'error',
      code: 'MISSING_REQUIREMENTS',
      message: `未解決の不足モデルが${miss.length}件あります。`,
    });
  const validation = { valid: !issues.some((x) => x.severity === 'error'), issues };
  const summary: Record<string, string | number | boolean | null> = {};
  if (key === 'models') {
    const p: any = parseModels(saved.content ?? extracted);
    if (p) {
      summary.loras = p.loras.length;
      summary.promptFallbacks = promptFallbacks(p).length;
    }
  }
  if (key === 'promptPlan') {
    const p = parsePromptPlan(extracted);
    if (p) {
      summary.branches = p.branches.length;
      summary.items = p.branches.reduce((n, b) => n + b.leaves.length, 0);
      summary.images = summary.items;
    }
  }
  return { extracted: saved.content ?? extracted, validation, summary, missingRequirements: miss };
}
export async function confirmArtifact(root: string, key: 'story' | 'models' | 'promptPlan') {
  const d = await readArtifact(root, key, 'draft');
  if (!d.exists || !d.content) throw new Error('確定する下書きがありません。');
  if (!d.validation.valid) throw new Error('検証エラーがあるため確定できません。');
  const target = confirmedPath(root, key);
  const previousText = key === 'models' ? await readText(target) : null;
  const previousModels = previousText ? parseModels(previousText) : null;
  const previousFallbacks =
    key === 'models' ? promptFallbacks(await readJson<any>(promptFallbacksPath(root))) : [];
  const source = key === 'models' ? await readModelsDraftSource(root) : null;
  await backupIfExists(target, path.join(internalDir(root), 'history', key));
  let downstreamReset = false;
  if (key === 'models') {
    const raw = JSON.parse(d.content) as any;
    const fallbacks = promptFallbacks(raw);
    delete raw.promptFallbacks;
    delete raw.missingRequirements;
    const nextModels = raw as ModelsArtifact;
    downstreamReset =
      previousText != null &&
      (!previousModels ||
        modelGenerationInputsChanged(previousModels, previousFallbacks, nextModels, fallbacks));
    await writeJsonAtomic(target, nextModels);
    if (fallbacks.length)
      await writeJsonAtomic(promptFallbacksPath(root), {
        schemaVersion: 2,
        promptFallbacks: fallbacks,
      });
    else await removeIfExists(promptFallbacksPath(root));
    if (downstreamReset)
      await resetModelDownstream(root, { clearModelFixHistory: source?.stage !== 'models-fix' });
  } else await writeTextAtomic(target, d.content);
  await removeIfExists(draftPath(root, key));
  if (key === 'models') await removeIfExists(modelsDraftSourcePath(root));
  return { downstreamReset };
}
export async function createProject(parent: string, brief: ProjectBriefInput) {
  const v = validateProjectBrief(brief);
  if (!v.valid) throw new Error(v.issues.map((i) => i.message).join('\n'));
  const root = path.join(parent, brief.project.id);
  if (await exists(root)) {
    const es = await readdir(root);
    if (es.length) throw new Error('同名のプロジェクトフォルダーが既に存在します。');
  }
  const artifactRoot = (process.env.BATCH_STUDIO_ARTIFACT_ROOT ?? '').trim(),
    artifactOutputPath = artifactRoot ? path.join(artifactRoot, brief.project.id) : null;
  await mkdir(path.join(root, '._batch_studio', 'drafts'), { recursive: true });
  await mkdir(path.join(root, '._batch_studio', 'history'), { recursive: true });
  if (artifactOutputPath) await mkdir(artifactOutputPath, { recursive: true });
  await writeJsonAtomic(path.join(root, 'project_brief.json'), { schemaVersion: 1, ...brief });
  await writeJsonAtomic(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: artifactOutputPath ? { artifactOutputPath } : {},
  });
  return root;
}
export async function savePromptPlan(root: string, plan: PromptPlanArtifact) {
  return saveDraft(root, 'promptPlan', JSON.stringify(plan, null, 2));
}
export async function beginEditArtifact(root: string, key: 'story' | 'models' | 'promptPlan') {
  const currentDraft = await readArtifact(root, key, 'draft');
  if (currentDraft.exists) return currentDraft;
  const confirmed = await readArtifact(root, key, 'confirmed');
  if (!confirmed.exists || confirmed.content == null) return currentDraft;
  return saveDraft(root, key, confirmed.content);
}
export async function saveProjectBrief(root: string, brief: ProjectBriefInput) {
  const v = validateProjectBrief(brief);
  if (!v.valid) throw new Error(v.issues.map((i) => i.message).join('\n'));
  const target = path.join(root, 'project_brief.json'),
    next = { schemaVersion: 1, ...brief },
    current = await readText(target);
  let currentId: string | null = null,
    currentValue: any = null;
  if (current) {
    try {
      currentValue = JSON.parse(current);
      currentId = currentValue?.project?.id ?? null;
    } catch {}
  }
  if (currentId && currentId !== brief.project.id)
    throw new Error('既存プロジェクトのproject.idは変更できません。');
  if (currentValue && JSON.stringify(currentValue) === JSON.stringify(next)) return;
  await backupIfExists(target, path.join(internalDir(root), 'history', 'projectBrief'));
  await writeJsonAtomic(target, next);
}
