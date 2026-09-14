import type {
  ModelsArtifact,
  PromptPlanArtifact,
  ProjectBriefInput,
  ValidationIssue,
  ValidationResult,
  WorkflowManifest,
} from '../shared/types.js';

const idRe = /^[a-z][a-z0-9._-]{0,63}$/;
const projectIdRe = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const loraRefRe = /^lora\.[a-z][a-z0-9._-]{0,58}$/;
const semverRe = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const sha256Re = /^[a-f0-9]{64}$/;
const ok = (issues: ValidationIssue[]): ValidationResult => ({
  valid: !issues.some((x) => x.severity === 'error'),
  issues,
});
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function extraKeys(v: unknown, allowed: string[], path: string, issues: ValidationIssue[]) {
  if (!object(v)) return;
  const allow = new Set(allowed);
  for (const key of Object.keys(v))
    if (!allow.has(key))
      issues.push({
        severity: 'error',
        code: 'UNKNOWN_PROPERTY',
        message: `許可されていない項目です: ${path ? path + '.' : ''}${key}`,
        path: path ? `${path}.${key}` : key,
      });
}
function required(v: unknown, keys: string[], path: string, issues: ValidationIssue[]) {
  if (!object(v)) return;
  for (const key of keys)
    if (!(key in v))
      issues.push({
        severity: 'error',
        code: 'REQUIRED_PROPERTY',
        message: `必須項目がありません: ${path ? path + '.' : ''}${key}`,
        path: path ? `${path}.${key}` : key,
      });
}
function isDateTime(v: unknown) {
  return typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Date.parse(v));
}
function isUri(v: unknown) {
  if (typeof v !== 'string' || !v.trim()) return false;
  try {
    const u = new URL(v);
    return !!u.protocol;
  } catch {
    return false;
  }
}
function uniqueNumbers(v: unknown) {
  return (
    Array.isArray(v) &&
    v.every((x) => Number.isInteger(x) && x >= 0) &&
    new Set(v).size === v.length
  );
}
export function parseModels(text: string): ModelsArtifact | null {
  try {
    return JSON.parse(text) as ModelsArtifact;
  } catch {
    return null;
  }
}
export function parsePromptPlan(text: string): PromptPlanArtifact | null {
  try {
    return JSON.parse(text) as PromptPlanArtifact;
  } catch {
    return null;
  }
}
export function validateProjectBrief(v: ProjectBriefInput): ValidationResult {
  const i: ValidationIssue[] = [];
  if (!v || typeof v !== 'object')
    return ok([{ severity: 'error', code: 'BRIEF_TYPE', message: '基本設定が不正です。' }]);
  if (!projectIdRe.test(v.project?.id || ''))
    i.push({
      severity: 'error',
      code: 'PROJECT_ID',
      message: 'プロジェクトIDが不正です。',
      path: 'project.id',
    });
  if (!v.project?.title?.trim())
    i.push({ severity: 'error', code: 'PROJECT_TITLE', message: 'プロジェクト名は必須です。' });
  if (v.subject?.copyrightedCharacter === true && !v.subject.characterName?.trim())
    i.push({
      severity: 'error',
      code: 'CHARACTER_REQUIRED',
      message: '版権キャラクターの場合はキャラクター名が必須です。',
      path: 'subject.characterName',
    });
  if (typeof v.audience !== 'string' || !v.audience.trim())
    i.push({
      severity: 'error',
      code: 'AUDIENCE_REQUIRED',
      message: 'ターゲット読者の特徴は必須です。',
      path: 'audience',
    });
  if (!Number.isInteger(v.generation?.target_image_count) || v.generation.target_image_count < 1)
    i.push({
      severity: 'error',
      code: 'TARGET_COUNT',
      message: '目標画像枚数は1以上の整数にしてください。',
    });
  if (
    v.generation?.modelFamily != null &&
    !['illustrious', 'anima'].includes(String(v.generation.modelFamily).toLowerCase())
  )
    i.push({
      severity: 'error',
      code: 'MODEL_FAMILY',
      message: 'modelFamilyは illustrious または anima を指定してください。',
      path: 'generation.modelFamily',
    });
  if (v.assumptions?.adultCharacters !== true)
    i.push({
      severity: 'error',
      code: 'ADULT_REQUIRED',
      message: '登場人物が成人である前提を確認してください。',
    });
  if (v.assumptions?.consensual !== true)
    i.push({
      severity: 'error',
      code: 'CONSENT_REQUIRED',
      message: '合意前提を確認してください。',
    });
  return ok(i);
}
function validateBaseline(x: unknown, path: string, i: ValidationIssue[]) {
  if (!object(x)) {
    i.push({
      severity: 'error',
      code: 'BASELINE_TYPE',
      message: 'Civitai基準値が不正です。',
      path,
    });
    return;
  }
  extraKeys(x, ['value', 'provenance'], path, i);
  required(x, ['value', 'provenance'], path, i);
  if (typeof x.value !== 'number' || !Number.isFinite(x.value))
    i.push({
      severity: 'error',
      code: 'BASELINE_VALUE',
      message: 'Civitai基準値が不正です。',
      path: `${path}.value`,
    });
  const p = x.provenance;
  if (!object(p)) {
    i.push({
      severity: 'error',
      code: 'BASELINE_PROVENANCE',
      message: 'Civitai基準値の根拠が不正です。',
      path: `${path}.provenance`,
    });
    return;
  }
  extraKeys(p, ['source', 'basis', 'method', 'sampleCount'], `${path}.provenance`, i);
  required(p, ['source', 'basis'], `${path}.provenance`, i);
  if (
    p.source !== 'civitai' ||
    !['creator-declared', 'observed-usage-derived'].includes(String(p.basis))
  )
    i.push({
      severity: 'error',
      code: 'BASELINE_PROVENANCE',
      message: 'Civitai基準値の根拠が不正です。',
      path: `${path}.provenance`,
    });
  if ('method' in p && (typeof p.method !== 'string' || !p.method.trim()))
    i.push({
      severity: 'error',
      code: 'BASELINE_METHOD',
      message: 'baseline methodが不正です。',
      path: `${path}.provenance.method`,
    });
  if ('sampleCount' in p && (!Number.isInteger(p.sampleCount) || Number(p.sampleCount) < 1))
    i.push({
      severity: 'error',
      code: 'BASELINE_SAMPLE',
      message: 'baseline sampleCountが不正です。',
      path: `${path}.provenance.sampleCount`,
    });
  if (
    p.basis === 'observed-usage-derived' &&
    (p.method !== 'median-of-post-medians:newest-200' ||
      !Number.isInteger(p.sampleCount) ||
      Number(p.sampleCount) < 5)
  )
    i.push({
      severity: 'error',
      code: 'BASELINE_METHOD',
      message: 'observed baselineのmethod/sampleCountが不正です。',
      path: `${path}.provenance`,
    });
}
type SelectionKind = 'checkpoint' | 'diffusion_model' | 'text_encoder' | 'clip' | 'lora';
function validateSelection(x: unknown, kind: SelectionKind, path: string): ValidationIssue[] {
  const i: ValidationIssue[] = [];
  const allowed = [
    'ref',
    'modelId',
    'modelName',
    'versionId',
    'versionName',
    'fileId',
    'fileName',
    'modelUrl',
    'trainedWords',
    'reason',
    ...(kind === 'lora' ? ['strengthBaseline'] : []),
  ];
  const requiredKeys = [
    'ref',
    'modelId',
    'modelName',
    'versionId',
    'versionName',
    'fileId',
    'fileName',
    'modelUrl',
    'trainedWords',
    'reason',
  ];
  if (!object(x))
    return [
      { severity: 'error', code: 'MODEL_SELECTION', message: 'モデル選定形式が不正です。', path },
    ];
  extraKeys(x, allowed, path, i);
  required(x, requiredKeys, path, i);
  const expected =
    kind === 'checkpoint'
      ? 'checkpoint.main'
      : kind === 'diffusion_model'
        ? 'diffusion_model.main'
        : kind === 'text_encoder'
          ? 'text_encoder.main'
          : kind === 'clip'
            ? 'clip.main'
            : null;
  if (expected ? x.ref !== expected : !loraRefRe.test(String(x.ref ?? '')))
    i.push({
      severity: 'error',
      code: 'MODEL_REF',
      message: `model refが不正です: ${String(x.ref ?? '')}`,
      path: `${path}.ref`,
    });
  for (const k of ['modelId', 'versionId', 'fileId'])
    if (!Number.isInteger(x[k]) || Number(x[k]) < 1)
      i.push({
        severity: 'error',
        code: 'MODEL_ID',
        message: `${k}が不正です。`,
        path: `${path}.${k}`,
      });
  for (const k of ['modelName', 'versionName', 'fileName', 'reason'])
    if (typeof x[k] !== 'string' || !String(x[k]).trim())
      i.push({
        severity: 'error',
        code: 'MODEL_FIELD',
        message: `${k}が不正です。`,
        path: `${path}.${k}`,
      });
  if (!isUri(x.modelUrl))
    i.push({
      severity: 'error',
      code: 'MODEL_URL',
      message: 'modelUrlは有効なURIが必要です。',
      path: `${path}.modelUrl`,
    });
  if (!Array.isArray(x.trainedWords) || !x.trainedWords.every((w) => typeof w === 'string'))
    i.push({
      severity: 'error',
      code: 'TRAINED_WORDS',
      message: 'trainedWordsは文字列配列が必要です。',
      path: `${path}.trainedWords`,
    });
  if (kind === 'lora' && 'strengthBaseline' in x && x.strengthBaseline !== undefined)
    validateBaseline(x.strengthBaseline, `${path}.strengthBaseline`, i);
  return i;
}
function validateFileSelection(
  x: unknown,
  kind: 'text_encoder' | 'clip' | 'vae',
  path: string,
): ValidationIssue[] {
  const i: ValidationIssue[] = [];
  if (!object(x))
    return [
      {
        severity: 'error',
        code: 'MODEL_FILE_SELECTION',
        message: 'モデルファイル選定形式が不正です。',
        path,
      },
    ];
  extraKeys(x, ['ref', 'fileName', 'reason'], path, i);
  required(x, ['ref', 'fileName', 'reason'], path, i);
  const expected =
    kind === 'text_encoder' ? 'text_encoder.main' : kind === 'clip' ? 'clip.main' : 'vae.main';
  if (x.ref !== expected)
    i.push({
      severity: 'error',
      code: 'MODEL_REF',
      message: `model refが不正です: ${String(x.ref ?? '')}`,
      path: `${path}.ref`,
    });
  const fileName = typeof x.fileName === 'string' ? x.fileName.trim() : '';
  if (!fileName)
    i.push({
      severity: 'error',
      code: 'MODEL_FILE_NAME',
      message: 'fileNameは必須です。',
      path: `${path}.fileName`,
    });
  else {
    const normalized = fileName.replace(/\\/g, '/');
    if (
      fileName.includes('\\') ||
      normalized.startsWith('/') ||
      /^[a-zA-Z]:\//.test(normalized) ||
      normalized.split('/').some((part) => !part || part === '..')
    )
      i.push({
        severity: 'error',
        code: 'MODEL_FILE_PATH',
        message: 'fileNameはモデル種別ディレクトリからの相対パスを / 区切りで指定してください。',
        path: `${path}.fileName`,
      });
  }
  if (typeof x.reason !== 'string' || !String(x.reason).trim())
    i.push({
      severity: 'error',
      code: 'MODEL_FIELD',
      message: 'reasonが不正です。',
      path: `${path}.reason`,
    });
  return i;
}
export function validateModels(m: ModelsArtifact): ValidationResult {
  const i: ValidationIssue[] = [];
  if (!object(m))
    return ok([
      { severity: 'error', code: 'MODELS_TYPE', message: 'models.jsonのrootはobjectが必要です。' },
    ]);
  const legacyExplicit = m.schemaVersion >= 2 && m.schemaVersion <= 4,
    isV4 = m.schemaVersion === 4,
    isV5 = m.schemaVersion === 5;
  const allowed = isV5
    ? [
        'schemaVersion',
        'modelFamily',
        'catalog',
        'checkpoint',
        'diffusionModel',
        'textEncoder',
        'vae',
        'loras',
      ]
    : isV4
      ? ['schemaVersion', 'modelFamily', 'catalog', 'checkpoint', 'textEncoder', 'vae', 'loras']
      : legacyExplicit
        ? ['schemaVersion', 'modelFamily', 'catalog', 'checkpoint', 'textEncoder', 'clip', 'loras']
        : ['schemaVersion', 'catalog', 'checkpoint', 'loras'];
  extraKeys(m, allowed, '', i);
  if (isV5) required(m, ['schemaVersion', 'modelFamily', 'catalog', 'loras'], '', i);
  else
    required(
      m,
      legacyExplicit
        ? ['schemaVersion', 'modelFamily', 'catalog', 'checkpoint', 'loras']
        : ['schemaVersion', 'catalog', 'checkpoint', 'loras'],
      '',
      i,
    );
  if (![1, 2, 3, 4, 5].includes(m.schemaVersion))
    i.push({
      severity: 'error',
      code: 'MODELS_SCHEMA',
      message: 'models.json schemaVersionは1〜5のいずれかが必要です。',
    });
  if (!object(m.catalog))
    i.push({
      severity: 'error',
      code: 'CATALOG_PROVENANCE',
      message: 'catalog provenanceが不正です。',
      path: 'catalog',
    });
  else {
    extraKeys(m.catalog, ['schemaVersion', 'generation', 'generatedAt'], 'catalog', i);
    required(m.catalog, ['schemaVersion', 'generation', 'generatedAt'], 'catalog', i);
    if (!Number.isInteger(m.catalog.schemaVersion) || m.catalog.schemaVersion < 1)
      i.push({
        severity: 'error',
        code: 'CATALOG_SCHEMA_VERSION',
        message: 'catalog.schemaVersionが不正です。',
        path: 'catalog.schemaVersion',
      });
    if (!Number.isInteger(m.catalog.generation) || m.catalog.generation < 0)
      i.push({
        severity: 'error',
        code: 'CATALOG_GENERATION',
        message: 'catalog.generationが不正です。',
        path: 'catalog.generation',
      });
    if (!isDateTime(m.catalog.generatedAt))
      i.push({
        severity: 'error',
        code: 'CATALOG_GENERATED_AT',
        message: 'catalog.generatedAtはdate-time形式が必要です。',
        path: 'catalog.generatedAt',
      });
  }
  if (m.schemaVersion <= 4) {
    if (m.checkpoint) i.push(...validateSelection(m.checkpoint, 'checkpoint', 'checkpoint'));
  }
  if (legacyExplicit || isV5) {
    if (m.modelFamily !== 'illustrious' && m.modelFamily !== 'anima')
      i.push({
        severity: 'error',
        code: 'MODEL_FAMILY',
        message: 'modelFamilyは illustrious または anima が必要です。',
        path: 'modelFamily',
      });
    if (isV5) {
      if (m.modelFamily === 'illustrious') {
        if (!m.checkpoint)
          i.push({
            severity: 'error',
            code: 'ILLUSTRIOUS_CHECKPOINT_REQUIRED',
            message: 'IllustriousではCheckpointの選択が必須です。',
            path: 'checkpoint',
          });
        else i.push(...validateSelection(m.checkpoint, 'checkpoint', 'checkpoint'));
        if (m.diffusionModel || m.textEncoder || m.clip || m.vae)
          i.push({
            severity: 'error',
            code: 'ILLUSTRIOUS_EXTRA_COMPONENTS',
            message:
              'IllustriousではDiffusion Model / Text Encoder / VAEをmodels.jsonへ指定しません。',
          });
      } else if (m.modelFamily === 'anima') {
        if (m.checkpoint)
          i.push({
            severity: 'error',
            code: 'ANIMA_LEGACY_CHECKPOINT',
            message:
              'schemaVersion 5のAnimaではcheckpointではなくdiffusionModelを使用してください。',
            path: 'checkpoint',
          });
        if (!m.diffusionModel)
          i.push({
            severity: 'error',
            code: 'ANIMA_DIFFUSION_MODEL_REQUIRED',
            message: 'AnimaではDiffusion Modelの選択が必須です。',
            path: 'diffusionModel',
          });
        else i.push(...validateSelection(m.diffusionModel, 'diffusion_model', 'diffusionModel'));
        if (!m.textEncoder)
          i.push({
            severity: 'error',
            code: 'ANIMA_TEXT_ENCODER_REQUIRED',
            message: 'AnimaではText Encoderの選択が必須です。',
            path: 'textEncoder',
          });
        else i.push(...validateFileSelection(m.textEncoder, 'text_encoder', 'textEncoder'));
        if (!m.vae)
          i.push({
            severity: 'error',
            code: 'ANIMA_VAE_REQUIRED',
            message: 'AnimaではVAEの選択が必須です。',
            path: 'vae',
          });
        else i.push(...validateFileSelection(m.vae, 'vae', 'vae'));
        if (m.clip)
          i.push({
            severity: 'error',
            code: 'ANIMA_LEGACY_CLIP',
            message: 'schemaVersion 5のAnimaではclipを使用しません。',
            path: 'clip',
          });
      }
    } else if (m.modelFamily === 'anima') {
      if (!m.textEncoder)
        i.push({
          severity: 'error',
          code: 'ANIMA_TEXT_ENCODER_REQUIRED',
          message: 'AnimaではText Encoderの選択が必須です。',
          path: 'textEncoder',
        });
      else
        i.push(
          ...(m.schemaVersion >= 3
            ? validateFileSelection(m.textEncoder, 'text_encoder', 'textEncoder')
            : validateSelection(m.textEncoder, 'text_encoder', 'textEncoder')),
        );
      if (isV4) {
        if (!m.vae)
          i.push({
            severity: 'error',
            code: 'ANIMA_VAE_REQUIRED',
            message: 'AnimaではVAEの選択が必須です。',
            path: 'vae',
          });
        else i.push(...validateFileSelection(m.vae, 'vae', 'vae'));
      } else {
        if (!m.clip)
          i.push({
            severity: 'error',
            code: 'LEGACY_ANIMA_CLIP_REQUIRED',
            message:
              '旧schemaのAnimaではCLIP選択が必要です。新規設定ではschemaVersion 5へ移行してください。',
            path: 'clip',
          });
        else
          i.push(
            ...(m.schemaVersion === 3
              ? validateFileSelection(m.clip, 'clip', 'clip')
              : validateSelection(m.clip, 'clip', 'clip')),
          );
      }
    } else if (m.modelFamily === 'illustrious' && (m.textEncoder || m.clip || m.vae))
      i.push({
        severity: 'error',
        code: 'ILLUSTRIOUS_EXTRA_ENCODERS',
        message: 'IllustriousではText Encoder / VAEをmodels.jsonへ指定しません。',
      });
  }
  if (!Array.isArray(m.loras))
    i.push({ severity: 'error', code: 'LORAS', message: 'lorasは配列が必要です。', path: 'loras' });
  else m.loras.forEach((x, n) => i.push(...validateSelection(x, 'lora', `loras.${n}`)));
  const refs = [
    m.checkpoint?.ref,
    m.diffusionModel?.ref,
    ...(m.textEncoder ? [m.textEncoder.ref] : []),
    ...(m.clip ? [m.clip.ref] : []),
    ...(m.vae ? [m.vae.ref] : []),
    ...(m.loras ?? []).map((x) => x.ref),
  ].filter(Boolean);
  if (new Set(refs).size !== refs.length)
    i.push({ severity: 'error', code: 'DUPLICATE_REF', message: 'モデルrefが重複しています。' });
  return ok(i);
}
function validateUsage(
  u: unknown,
  path: string,
  modelRefs: Set<string>,
  models: ModelsArtifact | null,
  i: ValidationIssue[],
) {
  if (!object(u)) {
    i.push({ severity: 'error', code: 'LORA_USAGE', message: 'LoRA適用値が不正です。', path });
    return;
  }
  extraKeys(u, ['modelRef', 'strengthModel', 'strengthClip'], path, i);
  required(u, ['modelRef', 'strengthModel', 'strengthClip'], path, i);
  if (
    typeof u.modelRef !== 'string' ||
    !u.modelRef.trim() ||
    typeof u.strengthModel !== 'number' ||
    !Number.isFinite(u.strengthModel) ||
    typeof u.strengthClip !== 'number' ||
    !Number.isFinite(u.strengthClip)
  )
    i.push({ severity: 'error', code: 'LORA_USAGE', message: 'LoRA適用値が不正です。', path });
  else if (models && !modelRefs.has(u.modelRef))
    i.push({
      severity: 'error',
      code: 'MODEL_REF_UNKNOWN',
      message: `未解決modelRef: ${u.modelRef}`,
      path,
    });
}
function validatePromptPlanV1(p: any, models: ModelsArtifact | null): ValidationResult {
  const i: ValidationIssue[] = [];
  if (!object(p))
    return ok([
      {
        severity: 'error',
        code: 'PLAN_TYPE',
        message: 'prompt_plan.jsonのrootはobjectが必要です。',
      },
    ]);
  extraKeys(p, ['schemaVersion', 'common', 'rootLoras', 'branches'], '', i);
  required(p, ['schemaVersion', 'common', 'rootLoras', 'branches'], '', i);
  if (p.schemaVersion !== 1)
    i.push({
      severity: 'error',
      code: 'PLAN_SCHEMA',
      message: 'prompt_plan.json schemaVersionは1が必要です。',
    });
  if (!object(p.common))
    i.push({
      severity: 'error',
      code: 'COMMON',
      message: '共通プロンプトが不正です。',
      path: 'common',
    });
  else {
    extraKeys(p.common, ['positive', 'negative'], 'common', i);
    required(p.common, ['positive', 'negative'], 'common', i);
    if (typeof p.common.positive !== 'string' || typeof p.common.negative !== 'string')
      i.push({
        severity: 'error',
        code: 'COMMON',
        message: '共通プロンプトが不正です。',
        path: 'common',
      });
  }
  if (!Array.isArray(p.rootLoras))
    i.push({
      severity: 'error',
      code: 'PLAN_ROOT_LORAS',
      message: 'rootLorasは配列が必要です。',
      path: 'rootLoras',
    });
  if (!Array.isArray(p.branches) || p.branches.length < 1)
    i.push({
      severity: 'error',
      code: 'PLAN_STRUCTURE',
      message: 'branchesは1件以上必要です。',
      path: 'branches',
    });
  const modelRefs = new Set<string>(models ? models.loras.map((x) => x.ref) : []);
  const rootLoras = Array.isArray(p.rootLoras) ? p.rootLoras : [];
  const branches = Array.isArray(p.branches) ? p.branches : [];
  rootLoras.forEach((u: unknown, n: number) =>
    validateUsage(u, `rootLoras.${n}`, modelRefs, models, i),
  );
  const branchIds: string[] = [];
  const leafIds: string[] = [];
  for (const [bi, b] of branches.entries()) {
    const bp = `branches.${bi}`;
    if (!object(b)) {
      i.push({ severity: 'error', code: 'BRANCH_TYPE', message: 'Branchが不正です。', path: bp });
      continue;
    }
    extraKeys(b, ['id', 'label', 'loras', 'leaves'], bp, i);
    required(b, ['id', 'label', 'loras', 'leaves'], bp, i);
    if (!idRe.test(String(b.id ?? '')))
      i.push({
        severity: 'error',
        code: 'BRANCH_ID',
        message: `Branch IDが不正です: ${String(b.id ?? '')}`,
        path: `${bp}.id`,
      });
    branchIds.push(String(b.id ?? ''));
    if (typeof b.label !== 'string' || !b.label.trim())
      i.push({
        severity: 'error',
        code: 'BRANCH_LABEL',
        message: 'Branch labelは必須です。',
        path: `${bp}.label`,
      });
    if (!Array.isArray(b.loras))
      i.push({
        severity: 'error',
        code: 'BRANCH_LORAS',
        message: 'Branch lorasは配列が必要です。',
        path: `${bp}.loras`,
      });
    else
      b.loras.forEach((u: unknown, n: number) =>
        validateUsage(u, `${bp}.loras.${n}`, modelRefs, models, i),
      );
    const leaves = Array.isArray(b.leaves) ? b.leaves : [];
    if (!leaves.length)
      i.push({
        severity: 'error',
        code: 'LEAVES_EMPTY',
        message: `${b.id ?? bp}に生成項目がありません。`,
        path: `${bp}.leaves`,
      });
    for (const [li, l] of leaves.entries()) {
      const lp = `${bp}.leaves.${li}`;
      if (!object(l)) {
        i.push({ severity: 'error', code: 'LEAF_TYPE', message: '生成項目が不正です。', path: lp });
        continue;
      }
      extraKeys(l, ['id', 'name', 'positive', 'negative'], lp, i);
      required(l, ['id', 'name', 'positive', 'negative'], lp, i);
      if (!idRe.test(String(l.id ?? '')))
        i.push({
          severity: 'error',
          code: 'LEAF_ID',
          message: `生成項目IDが不正です: ${String(l.id ?? '')}`,
          path: `${lp}.id`,
        });
      leafIds.push(String(l.id ?? ''));
      if (typeof l.name !== 'string' || !l.name.trim())
        i.push({
          severity: 'error',
          code: 'LEAF_NAME',
          message: '生成項目名は必須です。',
          path: `${lp}.name`,
        });
      if (typeof l.positive !== 'string' || typeof l.negative !== 'string')
        i.push({
          severity: 'error',
          code: 'LEAF_PROMPT',
          message: 'Positive/Negativeが不正です。',
          path: lp,
        });
    }
  }
  if (new Set(branchIds).size !== branchIds.length)
    i.push({ severity: 'error', code: 'DUP_BRANCH_ID', message: 'Branch IDが重複しています。' });
  if (new Set(leafIds).size !== leafIds.length)
    i.push({ severity: 'error', code: 'DUP_LEAF_ID', message: '生成項目IDが重複しています。' });
  return ok(i);
}

const positivePromptKeys = [
  'subject',
  'identity',
  'appearance',
  'style',
  'outfit',
  'expression',
  'action',
  'pose',
  'camera',
  'environment',
  'lighting',
  'effects',
] as const;
const cameraPromptKeys = ['pov', 'angle', 'framing', 'gaze', 'focus'] as const;
const negativePromptKeys = [
  'anatomy',
  'identity',
  'appearance',
  'subject',
  'outfit',
  'action',
  'camera',
  'environment',
  'artifacts',
  'content',
] as const;

function validateTagArray(
  value: unknown,
  path: string,
  family: ModelsArtifact['modelFamily'] | undefined,
  issues: ValidationIssue[],
) {
  if (!Array.isArray(value)) {
    issues.push({
      severity: 'error',
      code: 'PROMPT_TAG_ARRAY',
      message: 'Prompt categoryは文字列配列が必要です。',
      path,
    });
    return;
  }
  const seen = new Set<string>();
  value.forEach((raw, index) => {
    const tagPath = `${path}.${index}`;
    if (typeof raw !== 'string' || !raw.trim()) {
      issues.push({
        severity: 'error',
        code: 'PROMPT_TAG',
        message: 'Prompt tagは空でない文字列が必要です。',
        path: tagPath,
      });
      return;
    }
    const tag = raw.trim();
    if (tag !== raw || /[\r\n,]/.test(tag))
      issues.push({
        severity: 'error',
        code: 'PROMPT_TAG_FORMAT',
        message: '1配列要素には前後空白・改行・カンマを含まない1タグだけを指定してください。',
        path: tagPath,
      });
    if (family === 'illustrious' && /\s/.test(tag))
      issues.push({
        severity: 'error',
        code: 'ILLUSTRIOUS_TAG_DIALECT',
        message: 'Illustriousの通常タグはunderscore形式で指定してください。',
        path: tagPath,
      });
    if (seen.has(tag))
      issues.push({
        severity: 'warning',
        code: 'DUPLICATE_TAG',
        message: `同じcategory内でタグが重複しています: ${tag}`,
        path,
      });
    seen.add(tag);
  });
}

function validateStructuredPrompt(
  value: unknown,
  path: string,
  family: ModelsArtifact['modelFamily'] | undefined,
  issues: ValidationIssue[],
) {
  if (!object(value)) {
    issues.push({
      severity: 'error',
      code: 'STRUCTURED_PROMPT',
      message: '構造化Promptはobjectが必要です。',
      path,
    });
    return;
  }
  extraKeys(value, ['positive', 'negative'], path, issues);
  required(value, ['positive', 'negative'], path, issues);
  if (object(value.positive)) {
    extraKeys(value.positive, [...positivePromptKeys], `${path}.positive`, issues);
    for (const key of positivePromptKeys) {
      if (!(key in value.positive)) continue;
      if (key === 'camera') {
        const camera = value.positive.camera;
        if (!object(camera)) {
          issues.push({
            severity: 'error',
            code: 'CAMERA_PROMPT',
            message: 'cameraはobjectが必要です。',
            path: `${path}.positive.camera`,
          });
          continue;
        }
        extraKeys(camera, [...cameraPromptKeys], `${path}.positive.camera`, issues);
        for (const cameraKey of cameraPromptKeys)
          if (cameraKey in camera)
            validateTagArray(
              camera[cameraKey],
              `${path}.positive.camera.${cameraKey}`,
              family,
              issues,
            );
      } else validateTagArray(value.positive[key], `${path}.positive.${key}`, family, issues);
    }
  } else
    issues.push({
      severity: 'error',
      code: 'POSITIVE_PROMPT',
      message: 'positiveはobjectが必要です。',
      path: `${path}.positive`,
    });
  if (object(value.negative)) {
    extraKeys(value.negative, [...negativePromptKeys], `${path}.negative`, issues);
    for (const key of negativePromptKeys)
      if (key in value.negative)
        validateTagArray(value.negative[key], `${path}.negative.${key}`, family, issues);
  } else
    issues.push({
      severity: 'error',
      code: 'NEGATIVE_PROMPT',
      message: 'negativeはobjectが必要です。',
      path: `${path}.negative`,
    });
}

function values(value: unknown) {
  return Array.isArray(value) ? value.filter((tag): tag is string => typeof tag === 'string') : [];
}

function flattenPositive(value: any) {
  if (!object(value?.positive)) return [] as string[];
  const result: string[] = [];
  for (const key of positivePromptKeys) {
    if (key === 'camera') {
      const camera = value.positive.camera;
      if (!object(camera)) continue;
      for (const cameraKey of cameraPromptKeys) result.push(...values(camera[cameraKey]));
    } else result.push(...values(value.positive[key]));
  }
  return result;
}

function flattenNegative(value: any) {
  if (!object(value?.negative)) return [] as string[];
  return negativePromptKeys.flatMap((key) => values(value.negative[key]));
}

function cameraValues(value: any, key: (typeof cameraPromptKeys)[number]) {
  return object(value?.positive?.camera) ? values(value.positive.camera[key]) : [];
}

function positiveValues(value: any, key: Exclude<(typeof positivePromptKeys)[number], 'camera'>) {
  return object(value?.positive) ? values(value.positive[key]) : [];
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function validateEffectivePrompt(
  common: any,
  branch: any,
  leaf: any,
  path: string,
  issues: ValidationIssue[],
) {
  const scopes = [common, branch, leaf].filter(Boolean);
  const positiveByScope = scopes.map(flattenPositive);
  const negativeByScope = scopes.map(flattenNegative);
  const positive = unique(positiveByScope.flat());
  const negative = unique(negativeByScope.flat());
  const negativeSet = new Set(negative);
  const conflicts = positive.filter((tag) => negativeSet.has(tag));
  if (conflicts.length)
    issues.push({
      severity: 'error',
      code: 'POSITIVE_NEGATIVE_CONFLICT',
      message: `PositiveとNegativeに同じタグがあります: ${conflicts.join(', ')}`,
      path,
    });
  for (const [label, key] of [
    ['angle', 'angle'],
    ['framing', 'framing'],
    ['gaze', 'gaze'],
  ] as const) {
    const tags = unique(scopes.flatMap((scope) => cameraValues(scope, key)));
    if (tags.length > 1)
      issues.push({
        severity: 'error',
        code: `CAMERA_${label.toUpperCase()}_CONFLICT`,
        message: `camera.${label}は最終画像につき原則1タグです: ${tags.join(', ')}`,
        path,
      });
  }
  const expressions = unique(scopes.flatMap((scope) => positiveValues(scope, 'expression')));
  if (expressions.length > 3)
    issues.push({
      severity: 'warning',
      code: 'EXPRESSION_OVERDEFINED',
      message: `expressionが${expressions.length}タグあります。3タグ以内を推奨します。`,
      path,
    });
  const occurrences = new Map<string, number>();
  for (const tags of positiveByScope)
    for (const tag of new Set(tags)) occurrences.set(tag, (occurrences.get(tag) ?? 0) + 1);
  const duplicates = [...occurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([tag]) => tag);
  if (duplicates.length)
    issues.push({
      severity: 'warning',
      code: 'DUPLICATE_TAG',
      message: `親子scopeで同じPositiveタグが重複しています: ${duplicates.join(', ')}`,
      path,
    });
  const subjects = new Set(scopes.flatMap((scope) => positiveValues(scope, 'subject')));
  if (subjects.has('solo') && subjects.has('1girl') && subjects.has('1boy'))
    issues.push({
      severity: 'error',
      code: 'SUBJECT_CONFLICT',
      message: 'solo と 1girl + 1boy は同時指定できません。',
      path,
    });
  const outfits = unique(scopes.flatMap((scope) => positiveValues(scope, 'outfit')));
  if ((positive.includes('nude') || positive.includes('completely_nude')) && outfits.length)
    issues.push({
      severity: 'warning',
      code: 'OUTFIT_STATE_CONFLICT',
      message: 'nude系タグとoutfitタグが同じ最終Promptにあります。意図した併用か確認してください。',
      path,
    });
}

function annotatePromptPlanLeafLocations(issues: ValidationIssue[], branches: unknown[]) {
  for (const issue of issues) {
    const match = issue.path?.match(/^branches\.(\d+)\.leaves\.(\d+)(?:\.|$)/);
    if (!match) continue;
    const branchIndex = Number(match[1]);
    const leafIndex = Number(match[2]);
    const branch = object(branches[branchIndex]) ? branches[branchIndex] : null;
    const leaves = branch && Array.isArray(branch.leaves) ? branch.leaves : [];
    const leaf = object(leaves[leafIndex]) ? leaves[leafIndex] : null;
    issue.location = [
      `Matrix ${leafIndex + 1}行目`,
      branch && typeof branch.id === 'string' ? `Branch ${branch.id}` : `Branch ${branchIndex + 1}`,
      leaf && typeof leaf.id === 'string' ? `Leaf ${leaf.id}` : null,
    ]
      .filter(Boolean)
      .join(' / ');
  }
}

function validatePromptPlanV2(
  p: PromptPlanArtifact,
  models: ModelsArtifact | null,
): ValidationResult {
  const i: ValidationIssue[] = [];
  const plan = p as any;
  extraKeys(plan, ['schemaVersion', 'common', 'rootLoras', 'branches'], '', i);
  required(plan, ['schemaVersion', 'common', 'rootLoras', 'branches'], '', i);
  const family = models?.modelFamily;
  validateStructuredPrompt(plan.common, 'common', family, i);
  if (!Array.isArray(plan.rootLoras))
    i.push({
      severity: 'error',
      code: 'PLAN_ROOT_LORAS',
      message: 'rootLorasは配列が必要です。',
      path: 'rootLoras',
    });
  if (!Array.isArray(plan.branches) || plan.branches.length < 1)
    i.push({
      severity: 'error',
      code: 'PLAN_STRUCTURE',
      message: 'branchesは1件以上必要です。',
      path: 'branches',
    });
  const modelRefs = new Set<string>(models ? models.loras.map((x) => x.ref) : []);
  const rootLoras = Array.isArray(plan.rootLoras) ? plan.rootLoras : [];
  const branches = Array.isArray(plan.branches) ? plan.branches : [];
  rootLoras.forEach((u: unknown, n: number) =>
    validateUsage(u, `rootLoras.${n}`, modelRefs, models, i),
  );
  const branchIds: string[] = [];
  const leafIds: string[] = [];
  for (const [bi, b] of branches.entries()) {
    const bp = `branches.${bi}`;
    if (!object(b)) {
      i.push({ severity: 'error', code: 'BRANCH_TYPE', message: 'Branchが不正です。', path: bp });
      continue;
    }
    extraKeys(b, ['id', 'label', 'loras', 'prompt', 'leaves'], bp, i);
    required(b, ['id', 'label', 'loras', 'leaves'], bp, i);
    if (!idRe.test(String(b.id ?? '')))
      i.push({
        severity: 'error',
        code: 'BRANCH_ID',
        message: `Branch IDが不正です: ${String(b.id ?? '')}`,
        path: `${bp}.id`,
      });
    branchIds.push(String(b.id ?? ''));
    if (typeof b.label !== 'string' || !b.label.trim())
      i.push({
        severity: 'error',
        code: 'BRANCH_LABEL',
        message: 'Branch labelは必須です。',
        path: `${bp}.label`,
      });
    if (!Array.isArray(b.loras))
      i.push({
        severity: 'error',
        code: 'BRANCH_LORAS',
        message: 'Branch lorasは配列が必要です。',
        path: `${bp}.loras`,
      });
    else
      b.loras.forEach((u: unknown, n: number) =>
        validateUsage(u, `${bp}.loras.${n}`, modelRefs, models, i),
      );
    if ('prompt' in b && b.prompt != null)
      validateStructuredPrompt(b.prompt, `${bp}.prompt`, family, i);
    const leaves = Array.isArray(b.leaves) ? b.leaves : [];
    if (!leaves.length)
      i.push({
        severity: 'error',
        code: 'LEAVES_EMPTY',
        message: `${String(b.id ?? bp)}に生成項目がありません。`,
        path: `${bp}.leaves`,
      });
    for (const [li, l] of leaves.entries()) {
      const lp = `${bp}.leaves.${li}`;
      if (!object(l)) {
        i.push({ severity: 'error', code: 'LEAF_TYPE', message: '生成項目が不正です。', path: lp });
        continue;
      }
      extraKeys(l, ['id', 'name', 'prompt'], lp, i);
      required(l, ['id', 'name', 'prompt'], lp, i);
      if (!idRe.test(String(l.id ?? '')))
        i.push({
          severity: 'error',
          code: 'LEAF_ID',
          message: `生成項目IDが不正です: ${String(l.id ?? '')}`,
          path: `${lp}.id`,
        });
      leafIds.push(String(l.id ?? ''));
      if (typeof l.name !== 'string' || !l.name.trim())
        i.push({
          severity: 'error',
          code: 'LEAF_NAME',
          message: '生成項目名は必須です。',
          path: `${lp}.name`,
        });
      validateStructuredPrompt(l.prompt, `${lp}.prompt`, family, i);
      validateEffectivePrompt(plan.common, b.prompt, l.prompt, lp, i);
    }
  }
  if (new Set(branchIds).size !== branchIds.length)
    i.push({ severity: 'error', code: 'DUP_BRANCH_ID', message: 'Branch IDが重複しています。' });
  if (new Set(leafIds).size !== leafIds.length)
    i.push({ severity: 'error', code: 'DUP_LEAF_ID', message: '生成項目IDが重複しています。' });
  annotatePromptPlanLeafLocations(i, branches);
  return ok(i);
}

export function validatePromptPlan(
  p: PromptPlanArtifact,
  models: ModelsArtifact | null,
): ValidationResult {
  if (!object(p))
    return ok([
      {
        severity: 'error',
        code: 'PLAN_TYPE',
        message: 'prompt_plan.jsonのrootはobjectが必要です。',
      },
    ]);
  if ((p as any).schemaVersion === 1) return validatePromptPlanV1(p, models);
  if ((p as any).schemaVersion === 2) return validatePromptPlanV2(p, models);
  return ok([
    {
      severity: 'error',
      code: 'PLAN_SCHEMA',
      message: 'prompt_plan.json schemaVersionは1または2が必要です。',
      path: 'schemaVersion',
    },
  ]);
}

const commonRequiredRoles = ['rootLoraStack', 'planCommonPrompt', 'promptOutput'] as const;
const commonRoleNames = [
  'checkpoint',
  'diffusionModel',
  'textEncoder',
  'vae',
  ...commonRequiredRoles,
] as const;
const branchRequiredRoles = [
  'loraStack',
  'promptIngress',
  'mainMatrix',
  'prompter',
  'counter',
  'latent',
  'expand',
  'positiveEncode',
  'negativeEncode',
  'sampler',
  'vaeDecode',
  'save',
] as const;
const branchRoleNames = [...branchRequiredRoles, 'fixedMatrix', 'animaLatent'] as const;
export function validateWorkflowManifest(m: WorkflowManifest): ValidationResult {
  const i: ValidationIssue[] = [];
  if (!object(m))
    return ok([{ severity: 'error', code: 'MANIFEST_TYPE', message: 'Manifest rootが不正です。' }]);
  extraKeys(
    m,
    ['schemaVersion', 'manifestVersion', 'template', 'common', 'branchPrototype'],
    '',
    i,
  );
  required(m, ['schemaVersion', 'manifestVersion', 'template', 'common', 'branchPrototype'], '', i);
  if (m.schemaVersion !== 1)
    i.push({
      severity: 'error',
      code: 'MANIFEST_SCHEMA',
      message: 'Manifest schemaVersionは1が必要です。',
    });
  if (typeof m.manifestVersion !== 'string' || !semverRe.test(m.manifestVersion))
    i.push({
      severity: 'error',
      code: 'MANIFEST_VERSION',
      message: 'manifestVersionはSemVer x.y.z形式が必要です。',
      path: 'manifestVersion',
    });
  if (!object(m.template))
    i.push({
      severity: 'error',
      code: 'MANIFEST_TEMPLATE',
      message: 'template bindingが不正です。',
      path: 'template',
    });
  else {
    extraKeys(m.template, ['id', 'version', 'sha256'], 'template', i);
    required(m.template, ['id', 'version', 'sha256'], 'template', i);
    if (!idRe.test(String(m.template.id ?? '')))
      i.push({
        severity: 'error',
        code: 'TEMPLATE_ID',
        message: 'template.idが不正です。',
        path: 'template.id',
      });
    if (typeof m.template.version !== 'string' || !semverRe.test(m.template.version))
      i.push({
        severity: 'error',
        code: 'TEMPLATE_VERSION',
        message: 'template.versionが不正です。',
        path: 'template.version',
      });
    if (typeof m.template.sha256 !== 'string' || !sha256Re.test(m.template.sha256))
      i.push({
        severity: 'error',
        code: 'TEMPLATE_SHA',
        message: 'template.sha256が不正です。',
        path: 'template.sha256',
      });
  }
  let actualCommonRoles: string[] = [];
  if (!object(m.common)) {
    i.push({
      severity: 'error',
      code: 'COMMON_AREA',
      message: 'Manifest commonが不正です。',
      path: 'common',
    });
  } else {
    extraKeys(m.common, ['roles'], 'common', i);
    required(m.common, ['roles'], 'common', i);
    const roles = m.common.roles;
    if (!object(roles))
      i.push({
        severity: 'error',
        code: 'COMMON_ROLES',
        message: 'common.rolesが不正です。',
        path: 'common.roles',
      });
    else {
      extraKeys(roles, [...commonRoleNames], 'common.roles', i);
      required(roles, [...commonRequiredRoles], 'common.roles', i);
      actualCommonRoles = Object.keys(roles);
      const checkpointMode = 'checkpoint' in roles;
      const animaMode = ['diffusionModel', 'textEncoder', 'vae'].every((role) => role in roles);
      if (checkpointMode === animaMode)
        i.push({
          severity: 'error',
          code: 'COMMON_MODEL_ROLES',
          message:
            'common.rolesは checkpoint または diffusionModel/textEncoder/vae のどちらか一方の構成が必要です。',
          path: 'common.roles',
        });
      for (const role of actualCommonRoles)
        validateRoleNode(roles[role], `common.roles.${role}`, i);
    }
  }
  const bp = m.branchPrototype;
  if (!object(bp)) {
    i.push({
      severity: 'error',
      code: 'BRANCH_PROTOTYPE',
      message: 'branchPrototypeが不正です。',
      path: 'branchPrototype',
    });
    return ok(i);
  }
  extraKeys(bp, ['nodeIds', 'groupIds', 'roles', 'boundaries', 'layout'], 'branchPrototype', i);
  required(bp, ['nodeIds', 'groupIds', 'roles', 'boundaries', 'layout'], 'branchPrototype', i);
  if (!uniqueNumbers(bp.nodeIds) || !(bp.nodeIds as unknown[]).length)
    i.push({
      severity: 'error',
      code: 'PROTOTYPE_NODE_IDS',
      message: 'branchPrototype.nodeIdsは重複のない非空integer配列が必要です。',
      path: 'branchPrototype.nodeIds',
    });
  if (!uniqueNumbers(bp.groupIds))
    i.push({
      severity: 'error',
      code: 'PROTOTYPE_GROUP_IDS',
      message: 'branchPrototype.groupIdsは重複のないinteger配列が必要です。',
      path: 'branchPrototype.groupIds',
    });
  if (!object(bp.roles))
    i.push({
      severity: 'error',
      code: 'BRANCH_ROLES',
      message: 'branchPrototype.rolesが不正です。',
      path: 'branchPrototype.roles',
    });
  else {
    extraKeys(bp.roles, [...branchRoleNames], 'branchPrototype.roles', i);
    required(bp.roles, [...branchRequiredRoles], 'branchPrototype.roles', i);
    for (const role of branchRoleNames)
      if (role in bp.roles) validateRoleNode(bp.roles[role], `branchPrototype.roles.${role}`, i);
  }
  if (!Array.isArray(bp.boundaries) || bp.boundaries.length < 1)
    i.push({
      severity: 'error',
      code: 'BOUNDARIES',
      message: 'boundariesは1件以上必要です。',
      path: 'branchPrototype.boundaries',
    });
  else {
    const ids: string[] = [];
    bp.boundaries.forEach((b, n) => {
      const p = `branchPrototype.boundaries.${n}`;
      if (!object(b)) {
        i.push({
          severity: 'error',
          code: 'BOUNDARY_TYPE',
          message: 'boundaryが不正です。',
          path: p,
        });
        return;
      }
      extraKeys(b, ['id', 'source', 'target'], p, i);
      required(b, ['id', 'source', 'target'], p, i);
      if (!idRe.test(String(b.id ?? '')))
        i.push({
          severity: 'error',
          code: 'BOUNDARY_ID',
          message: 'boundary.idが不正です。',
          path: `${p}.id`,
        });
      ids.push(String(b.id ?? ''));
      validateEndpoint(b.source, actualCommonRoles, `${p}.source`, i);
      validateEndpoint(b.target, branchRoleNames, `${p}.target`, i);
    });
    if (new Set(ids).size !== ids.length)
      i.push({
        severity: 'error',
        code: 'DUP_BOUNDARY_ID',
        message: 'boundary.idが重複しています。',
      });
  }
  if (!object(bp.layout)) {
    i.push({
      severity: 'error',
      code: 'LAYOUT',
      message: 'layoutが不正です。',
      path: 'branchPrototype.layout',
    });
  } else {
    extraKeys(bp.layout, ['offset'], 'branchPrototype.layout', i);
    required(bp.layout, ['offset'], 'branchPrototype.layout', i);
    const off = bp.layout.offset;
    if (
      !object(off) ||
      typeof off.x !== 'number' ||
      !Number.isFinite(off.x) ||
      typeof off.y !== 'number' ||
      !Number.isFinite(off.y)
    )
      i.push({
        severity: 'error',
        code: 'LAYOUT_OFFSET',
        message: 'layout.offsetのx/yが不正です。',
        path: 'branchPrototype.layout.offset',
      });
    else extraKeys(off, ['x', 'y'], 'branchPrototype.layout.offset', i);
  }
  return ok(i);
}
function validateRoleNode(v: unknown, path: string, i: ValidationIssue[]) {
  if (!object(v)) {
    i.push({ severity: 'error', code: 'ROLE_NODE', message: 'role nodeが不正です。', path });
    return;
  }
  extraKeys(v, ['nodeId'], path, i);
  required(v, ['nodeId'], path, i);
  if (!Number.isInteger(v.nodeId) || Number(v.nodeId) < 0)
    i.push({
      severity: 'error',
      code: 'ROLE_NODE_ID',
      message: 'nodeIdが不正です。',
      path: `${path}.nodeId`,
    });
}
function validateEndpoint(
  v: unknown,
  roles: readonly string[],
  path: string,
  i: ValidationIssue[],
) {
  if (!object(v)) {
    i.push({
      severity: 'error',
      code: 'BOUNDARY_ENDPOINT',
      message: 'boundary endpointが不正です。',
      path,
    });
    return;
  }
  extraKeys(v, ['role', 'slot'], path, i);
  required(v, ['role', 'slot'], path, i);
  if (typeof v.role !== 'string' || !roles.includes(v.role))
    i.push({
      severity: 'error',
      code: 'BOUNDARY_ROLE',
      message: 'boundary roleが不正です。',
      path: `${path}.role`,
    });
  if (!Number.isInteger(v.slot) || Number(v.slot) < 0)
    i.push({
      severity: 'error',
      code: 'BOUNDARY_SLOT',
      message: 'boundary slotが不正です。',
      path: `${path}.slot`,
    });
}
