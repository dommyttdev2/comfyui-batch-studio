import { createHash } from 'node:crypto';
import type {
  ModelsArtifact,
  PromptPlanArtifactV2,
  StructuredPrompt,
  ValidationIssue,
  ValidationResult,
} from '../shared/types.js';
import { confirmedPath, draftPath } from './artifact-service.js';
import { readText, writeTextAtomic } from './fs-utils.js';
import { parseModels, parsePromptPlan, validatePromptPlan } from './validation.js';

type Scope = 'common' | 'branch' | 'leaf';
type PatchOperation = {
  scope: Scope;
  branchId?: string;
  leafId?: string;
  path: string;
  before: unknown[];
  after: unknown[];
};
type PatchDocument = {
  schemaVersion: 1;
  baseSha256: string;
  operations: PatchOperation[];
};
type PatchResult = {
  extracted: string;
  validation: ValidationResult;
  summary: Record<string, number>;
};
const positive = new Set([
  'subject',
  'identity',
  'appearance',
  'style',
  'outfit',
  'expression',
  'action',
  'pose',
  'environment',
  'lighting',
  'effects',
]);
const negative = new Set([
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
]);
const camera = new Set(['pov', 'angle', 'framing', 'gaze', 'focus']);
const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasKeys = (item: Record<string, unknown>, keys: string[]) =>
  Object.keys(item).every((key) => keys.includes(key));
const failure = (code: string, message: string): PatchResult => ({
  extracted: '',
  validation: {
    valid: false,
    issues: [{ severity: 'error', code, message }],
  },
  summary: {},
});
function patchDocument(raw: string): PatchDocument | null {
  const candidate = raw.trim();
  const fence = candidate.match(/^\x60{3}(?:json)?\s*\n([\s\S]*?)\n\x60{3}\s*$/i);
  try {
    const parsed: unknown = JSON.parse(fence?.[1] ?? candidate);
    if (
      !record(parsed) ||
      !hasKeys(parsed, ['schemaVersion', 'baseSha256', 'operations']) ||
      parsed.schemaVersion !== 1 ||
      typeof parsed.baseSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(parsed.baseSha256) ||
      !Array.isArray(parsed.operations) ||
      !parsed.operations.length ||
      parsed.operations.length > 100
    )
      return null;
    return parsed as PatchDocument;
  } catch {
    return null;
  }
}
function validPath(scope: Scope, path: string): string[] | null {
  const parts = path.split('.');
  if (scope !== 'common' && parts.shift() !== 'prompt') return null;
  if (parts.length === 1 && parts[0] === 'triggerWords') return parts;
  if (parts.length === 2 && parts[0] === 'positive' && positive.has(parts[1])) return parts;
  if (parts.length === 2 && parts[0] === 'negative' && negative.has(parts[1])) return parts;
  if (
    parts.length === 3 &&
    parts[0] === 'positive' &&
    parts[1] === 'camera' &&
    camera.has(parts[2])
  )
    return parts;
  return null;
}
function scopeTarget(
  plan: PromptPlanArtifactV2,
  operation: PatchOperation,
): StructuredPrompt | null {
  if (operation.scope === 'common') return plan.common;
  const branch = plan.branches.find((candidate) => candidate.id === operation.branchId);
  if (!branch) return null;
  if (operation.scope === 'branch') return branch.prompt ?? null;
  const leaf = branch.leaves.find((candidate) => candidate.id === operation.leafId);
  return leaf?.prompt ?? null;
}
function validOperation(value: unknown): value is PatchOperation {
  if (!record(value)) return false;
  if (
    !['common', 'branch', 'leaf'].includes(String(value.scope)) ||
    typeof value.path !== 'string' ||
    !Array.isArray(value.before) ||
    !Array.isArray(value.after) ||
    !hasKeys(value, ['scope', 'branchId', 'leafId', 'path', 'before', 'after'])
  )
    return false;
  if (!validPath(value.scope as Scope, value.path)) return false;
  if (value.scope === 'common') return !('branchId' in value) && !('leafId' in value);
  if (typeof value.branchId !== 'string' || !value.branchId) return false;
  return value.scope === 'branch'
    ? !('leafId' in value)
    : typeof value.leafId === 'string' && !!value.leafId;
}
async function currentPlan(root: string) {
  const draft = draftPath(root, 'promptPlan');
  const content = await readText(draft);
  if (content !== null) return { source: draft, content };
  const confirmed = confirmedPath(root, 'promptPlan');
  const saved = await readText(confirmed);
  return saved === null ? null : { source: confirmed, content: saved };
}
export async function promptPlanPatchBase(root: string) {
  const current = await currentPlan(root);
  if (!current) throw new Error('修正対象のprompt_plan.jsonがありません。');
  const parsed = parsePromptPlan(current.content);
  if (!parsed || parsed.schemaVersion !== 2)
    throw new Error('部分修正はPrompt Plan Schema v2にのみ対応します。');
  return {
    filePath: current.source,
    baseSha256: sha256(current.content),
    branches: parsed.branches.length,
    leaves: parsed.branches.reduce((n, branch) => n + branch.leaves.length, 0),
  };
}
export async function applyPromptPlanPatch(root: string, raw: string): Promise<PatchResult> {
  if (Buffer.byteLength(raw, 'utf8') > 256_000)
    return failure('PATCH_SIZE', '差分JSONが256KBを超えています。変更を小分けにしてください。');
  const patch = patchDocument(raw);
  if (!patch)
    return failure(
      'PATCH_FORMAT',
      '部分修正はschemaVersion・baseSha256・operationsを持つJSONで返してください。Branchの断片は取り込めません。',
    );
  const current = await currentPlan(root);
  if (!current) return failure('PATCH_BASE_MISSING', '修正元のPrompt Planがありません。');
  if (sha256(current.content) !== patch.baseSha256)
    return failure(
      'PATCH_BASE_CHANGED',
      '差分生成後にPrompt Planが変更されました。新しい下書きから修正依頼を作り直してください。',
    );
  const original = parsePromptPlan(current.content);
  if (!original || original.schemaVersion !== 2)
    return failure('PATCH_SCHEMA', '部分修正はPrompt Plan Schema v2にのみ対応します。');
  const updated = structuredClone(original) as PromptPlanArtifactV2;
  const modified = new Set<string>();
  for (const [index, operation] of patch.operations.entries()) {
    if (!validOperation(operation))
      return failure(
        'PATCH_OPERATION',
        `operations[${index}] のscope・path・before・afterが不正です。`,
      );
    const target = scopeTarget(updated, operation);
    if (!target)
      return failure(
        'PATCH_TARGET',
        `operations[${index}] のBranch/Leafまたはpromptがありません。`,
      );
    const segments = validPath(operation.scope, operation.path);
    if (!segments) return failure('PATCH_PATH', `operations[${index}] のpathは変更できません。`);
    const identity = [operation.scope, operation.branchId, operation.leafId, operation.path].join(
      '/',
    );
    if (modified.has(identity))
      return failure('PATCH_DUPLICATE', `operations[${index}] は同じpathを二重に変更しています。`);
    modified.add(identity);
    let parent: Record<string, unknown> = target as unknown as Record<string, unknown>;
    for (const key of segments.slice(0, -1)) {
      const child = parent[key];
      if (!record(child))
        return failure('PATCH_PATH', `operations[${index}] の対象カテゴリがありません。`);
      parent = child;
    }
    const key = segments.at(-1)!;
    const previous = parent[key];
    if (!Array.isArray(previous) || JSON.stringify(previous) !== JSON.stringify(operation.before))
      return failure(
        'PATCH_EXPECTED_MISMATCH',
        `operations[${index}] のbeforeが現在の値と一致しません。対象: ${identity}`,
      );
    parent[key] = structuredClone(operation.after);
  }
  const modelsContent = await readText(confirmedPath(root, 'models'));
  const models: ModelsArtifact | null = modelsContent ? parseModels(modelsContent) : null;
  const checked = validatePromptPlan(updated, models);
  if (!checked.valid) return { extracted: '', validation: checked, summary: {} };
  const again = await currentPlan(root);
  if (!again || again.source !== current.source || sha256(again.content) !== patch.baseSha256)
    return failure(
      'PATCH_BASE_CHANGED',
      '適用中にPrompt Planが更新されました。差分は保存していません。',
    );
  const content = JSON.stringify(updated, null, 2) + '\n';
  await writeTextAtomic(draftPath(root, 'promptPlan'), content);
  return {
    extracted: content,
    validation: checked,
    summary: {
      branches: updated.branches.length,
      leaves: updated.branches.reduce((n, b) => n + b.leaves.length, 0),
      operations: patch.operations.length,
    },
  };
}
