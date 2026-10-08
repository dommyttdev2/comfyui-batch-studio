import { applyPromptPlanDifference } from '../domain/prompt-plan-patch-policy.js';
import { parseModels, parsePromptPlan } from '../domain/artifact-validation.js';
export interface PromptPatchPorts {
  current(): Promise<{ source: string; content: string } | null>;
  models(): Promise<string | null>;
  writeDraft(content: string): Promise<void>;
  hash(content: string): string;
}
export async function promptPatchBase(ports: PromptPatchPorts) {
  const current = await ports.current();
  if (!current) throw new Error('修正対象のprompt_plan.jsonがありません。');
  const parsed = parsePromptPlan(current.content);
  if (!parsed || parsed.schemaVersion !== 2)
    throw new Error('部分修正はPrompt Plan Schema v2にのみ対応します。');
  return {
    filePath: current.source,
    baseSha256: ports.hash(current.content),
    branches: parsed.branches.length,
    leaves: parsed.branches.reduce((n, branch) => n + branch.leaves.length, 0),
  };
}
export async function applyPromptPatch(ports: PromptPatchPorts, raw: string) {
  const current = await ports.current(),
    models = await ports.models();
  const result = applyPromptPlanDifference(
    current?.content ?? null,
    current ? ports.hash(current.content) : '',
    raw,
    models ? parseModels(models) : null,
  );
  if (!result.validation.valid) return result;
  const again = await ports.current();
  if (
    !current ||
    !again ||
    again.source !== current.source ||
    ports.hash(again.content) !== ports.hash(current.content)
  )
    return {
      extracted: '',
      validation: {
        valid: false,
        issues: [
          {
            severity: 'error' as const,
            code: 'PATCH_BASE_CHANGED',
            message: '適用中にPrompt Planが更新されました。差分は保存していません。',
          },
        ],
      },
      summary: {},
    };
  await ports.writeDraft(result.extracted);
  return result;
}
