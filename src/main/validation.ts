import type { ModelsArtifact, PromptPlanArtifact, ProjectBriefInput, ValidationIssue, ValidationResult } from '../shared/types.js';

const projectIdRe = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const stableIdRe = /^[a-z][a-z0-9._-]{0,63}$/;
const loraRefRe = /^lora\.[a-z][a-z0-9._-]{0,58}$/;
const issue = (severity: ValidationIssue['severity'], code: string, message: string, path?: string): ValidationIssue => ({ severity, code, message, path });
const result = (issues: ValidationIssue[]): ValidationResult => ({ valid: !issues.some((i) => i.severity === 'error'), issues });

export function validateProjectBrief(value: ProjectBriefInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!value?.project?.title?.trim()) issues.push(issue('error','BRIEF_TITLE','プロジェクト名は必須です。','project.title'));
  if (!projectIdRe.test(value?.project?.id ?? '')) issues.push(issue('error','BRIEF_ID','プロジェクトIDの形式が不正です。','project.id'));
  if (typeof value?.character?.is_copyrighted !== 'boolean') issues.push(issue('error','BRIEF_COPYRIGHT','版権キャラかどうかを指定してください。','character.is_copyrighted'));
  if (value?.character?.is_copyrighted && !value.character.name?.trim()) issues.push(issue('error','BRIEF_CHARACTER','版権キャラの場合はキャラクター名が必須です。','character.name'));
  if (!value?.audience?.traits?.trim()) issues.push(issue('error','BRIEF_AUDIENCE','ターゲット読者の特徴は必須です。','audience.traits'));
  if (value?.constraints?.adult_and_consent_confirmed !== true) issues.push(issue('error','BRIEF_CONSTRAINT','固定前提の確認が必要です。','constraints.adult_and_consent_confirmed'));
  const target = value?.generation?.target_image_count;
  if (target != null && (!Number.isInteger(target) || target <= 0)) issues.push(issue('error','BRIEF_TARGET','目標画像枚数は正の整数で指定してください。','generation.target_image_count'));
  return result(issues);
}

function requiredString(obj: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]) {
  if (typeof obj[key] !== 'string' || !(obj[key] as string).trim()) issues.push(issue('error','REQUIRED_STRING',`${path}.${key} は空にできません。`,`${path}.${key}`));
}
function requiredPositiveInt(obj: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]) {
  if (!Number.isInteger(obj[key]) || Number(obj[key]) < 1) issues.push(issue('error','REQUIRED_ID',`${path}.${key} は正の整数が必要です。`,`${path}.${key}`));
}

export function validateModels(value: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result([issue('error','MODELS_ROOT','models.json はObjectである必要があります。')]);
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1) issues.push(issue('error','MODELS_SCHEMA','schemaVersionは1である必要があります。','schemaVersion'));
  if (!root.catalog || typeof root.catalog !== 'object') issues.push(issue('error','MODELS_CATALOG','catalogが必要です。','catalog'));
  const selections: Array<[string, unknown]> = [['checkpoint',root.checkpoint], ...((Array.isArray(root.loras) ? root.loras : []).map((v,i)=>[`loras[${i}]`,v] as [string,unknown]))];
  if (!Array.isArray(root.loras)) issues.push(issue('error','MODELS_LORAS','lorasは配列である必要があります。','loras'));
  const refs = new Set<string>();
  for (const [p, raw] of selections) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { issues.push(issue('error','MODEL_SELECTION',`${p} が不正です。`,p)); continue; }
    const obj = raw as Record<string, unknown>;
    requiredString(obj,'ref',p,issues); requiredString(obj,'modelName',p,issues); requiredString(obj,'versionName',p,issues); requiredString(obj,'fileName',p,issues); requiredString(obj,'modelUrl',p,issues); requiredString(obj,'reason',p,issues);
    requiredPositiveInt(obj,'modelId',p,issues); requiredPositiveInt(obj,'versionId',p,issues); requiredPositiveInt(obj,'fileId',p,issues);
    const ref = typeof obj.ref === 'string' ? obj.ref : '';
    if (p === 'checkpoint' && ref !== 'checkpoint.main') issues.push(issue('error','CHECKPOINT_REF','checkpoint.refはcheckpoint.main固定です。',`${p}.ref`));
    if (p !== 'checkpoint' && !loraRefRe.test(ref)) issues.push(issue('error','LORA_REF',`${ref || '(empty)'} は有効なLoRA refではありません。`,`${p}.ref`));
    if (ref && refs.has(ref)) issues.push(issue('error','DUP_MODEL_REF',`model ref ${ref} が重複しています。`,`${p}.ref`)); refs.add(ref);
    if (!Array.isArray(obj.trainedWords) || obj.trainedWords.some((x)=>typeof x !== 'string')) issues.push(issue('error','TRAINED_WORDS',`${p}.trainedWordsは文字列配列である必要があります。`,`${p}.trainedWords`));
    const sb = obj.strengthBaseline as Record<string, unknown> | undefined;
    if (sb && typeof sb === 'object') {
      if (typeof sb.value !== 'number' || !Number.isFinite(sb.value)) issues.push(issue('error','BASELINE_VALUE','Civitai基準値が数値ではありません。',`${p}.strengthBaseline.value`));
      const prov = sb.provenance as Record<string, unknown> | undefined;
      if (!prov || prov.source !== 'civitai' || !['creator-declared','observed-usage-derived'].includes(String(prov.basis))) issues.push(issue('error','BASELINE_PROVENANCE','Civitai基準値の根拠が不正です。',`${p}.strengthBaseline.provenance`));
      if (prov?.basis === 'observed-usage-derived') {
        if (prov.method !== 'median-of-post-medians:newest-200') issues.push(issue('error','BASELINE_METHOD','observed baselineのmethodが想定外です。',`${p}.strengthBaseline.provenance.method`));
        if (!Number.isInteger(prov.sampleCount) || Number(prov.sampleCount) < 5) issues.push(issue('error','BASELINE_SAMPLE','observed baselineは5投稿以上が必要です。',`${p}.strengthBaseline.provenance.sampleCount`));
      }
    }
  }
  return result(issues);
}

export function validatePromptPlan(value: unknown, models?: ModelsArtifact | null): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result([issue('error','PLAN_ROOT','prompt_plan.json はObjectである必要があります。')]);
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1) issues.push(issue('error','PLAN_SCHEMA','schemaVersionは1である必要があります。','schemaVersion'));
  if (!root.common || typeof root.common !== 'object') issues.push(issue('error','PLAN_COMMON','commonが必要です。','common'));
  const branches = Array.isArray(root.branches) ? root.branches : [];
  if (!Array.isArray(root.branches) || branches.length === 0) issues.push(issue('error','PLAN_BRANCHES','branchesには1件以上必要です。','branches'));
  if (!Array.isArray(root.rootLoras)) issues.push(issue('error','PLAN_ROOT_LORAS','rootLorasは配列である必要があります。','rootLoras'));
  const modelRefs = new Set<string>(models ? [models.checkpoint.ref, ...models.loras.map((l)=>l.ref)] : []);
  const branchIds = new Set<string>(); const leafIds = new Set<string>();
  const validateLoras=(list: unknown, p:string)=>{ if(!Array.isArray(list)){issues.push(issue('error','PLAN_LORAS',`${p}は配列である必要があります。`,p));return;} list.forEach((raw,i)=>{ const q=`${p}[${i}]`; if(!raw||typeof raw!=='object'||Array.isArray(raw)){issues.push(issue('error','PLAN_LORA',`${q}が不正です。`,q));return;} const l=raw as Record<string,unknown>; if(typeof l.modelRef!=='string'||!l.modelRef)issues.push(issue('error','PLAN_MODEL_REF','modelRefは必須です。',`${q}.modelRef`)); else if(models&&!modelRefs.has(l.modelRef))issues.push(issue('error','PLAN_MODEL_REF_UNKNOWN',`models.jsonに${l.modelRef}がありません。`,`${q}.modelRef`)); if(typeof l.strengthModel!=='number'||!Number.isFinite(l.strengthModel))issues.push(issue('error','PLAN_STRENGTH','Model強度は数値必須です。',`${q}.strengthModel`)); if(typeof l.strengthClip!=='number'||!Number.isFinite(l.strengthClip))issues.push(issue('error','PLAN_STRENGTH','CLIP強度は数値必須です。',`${q}.strengthClip`)); }); };
  validateLoras(root.rootLoras,'rootLoras');
  branches.forEach((raw,bi)=>{ const p=`branches[${bi}]`; if(!raw||typeof raw!=='object'||Array.isArray(raw)){issues.push(issue('error','PLAN_BRANCH',`${p}が不正です。`,p));return;} const b=raw as Record<string,unknown>; const id=typeof b.id==='string'?b.id:''; if(!stableIdRe.test(id))issues.push(issue('error','BRANCH_ID',`${p}.idが不正です。`,`${p}.id`)); if(branchIds.has(id))issues.push(issue('error','BRANCH_ID_DUP',`Branch ID ${id} が重複しています。`,`${p}.id`)); branchIds.add(id); if(typeof b.label!=='string'||!b.label.trim())issues.push(issue('error','BRANCH_LABEL','Branch labelは必須です。',`${p}.label`)); validateLoras(b.loras,`${p}.loras`); const leaves=Array.isArray(b.leaves)?b.leaves:[]; if(leaves.length===0)issues.push(issue('error','LEAVES_EMPTY','各Branchには1件以上の生成項目が必要です。',`${p}.leaves`)); leaves.forEach((lr,li)=>{const q=`${p}.leaves[${li}]`; if(!lr||typeof lr!=='object'||Array.isArray(lr)){issues.push(issue('error','LEAF',`${q}が不正です。`,q));return;} const l=lr as Record<string,unknown>; const lid=typeof l.id==='string'?l.id:''; if(!stableIdRe.test(lid))issues.push(issue('error','LEAF_ID',`${q}.idが不正です。`,`${q}.id`)); if(leafIds.has(lid))issues.push(issue('error','LEAF_ID_DUP',`生成項目ID ${lid} が重複しています。`,`${q}.id`)); leafIds.add(lid); ['name','positive','negative'].forEach(k=>{if(typeof l[k]!=='string'||(k==='name'&&!(l[k] as string).trim()))issues.push(issue('error','LEAF_FIELD',`${q}.${k}が不正です。`,`${q}.${k}`));});}); });
  return result(issues);
}

export function parseModels(text: string): ModelsArtifact | null { try { return JSON.parse(text) as ModelsArtifact; } catch { return null; } }
export function parsePromptPlan(text: string): PromptPlanArtifact | null { try { return JSON.parse(text) as PromptPlanArtifact; } catch { return null; } }
