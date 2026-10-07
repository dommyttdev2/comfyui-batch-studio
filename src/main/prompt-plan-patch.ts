import { createHash } from 'node:crypto';
import { applyPromptPlanDifference } from '../domain/prompt-plan-patch-policy.js';
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

const sha256 = (content: string) => createHash('sha256').update(content).digest('hex');
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
export async function applyPromptPlanPatch(
  root: string,
  raw: string,
): Promise<ReturnType<typeof applyPromptPlanDifference>> {
  const current = await currentPlan(root);
  const modelsContent = await readText(confirmedPath(root, 'models'));
  const result = applyPromptPlanDifference(
    current?.content ?? null,
    current ? sha256(current.content) : '',
    raw,
    modelsContent ? parseModels(modelsContent) : null,
  );
  if (!result.validation.valid) return result;
  const again = await currentPlan(root);
  if (
    !current ||
    !again ||
    again.source !== current.source ||
    sha256(again.content) !== sha256(current.content)
  )
    return {
      extracted: '',
      validation: {
        valid: false,
        issues: [
          {
            severity: 'error',
            code: 'PATCH_BASE_CHANGED',
            message: '適用中にPrompt Planが更新されました。差分は保存していません。',
          },
        ],
      },
      summary: {},
    };
  await writeTextAtomic(draftPath(root, 'promptPlan'), result.extracted);
  return result;
}
