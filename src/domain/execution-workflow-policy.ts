import type { ExecutionRun, ModelsArtifact, PromptFallback } from './artifact-types.js';
import { enumerateImageTasks } from './image-tasks.js';
import { modelGenerationInputs } from './model-impact.js';
import type { ApiGraph } from './workflow-graph.js';
export function verifyExecutionWorkflow(
  run: ExecutionRun,
  observed: { ui: unknown; api: unknown; plan: unknown; models: unknown },
  hash: (value: unknown) => string,
  fallbacks: PromptFallback[] = [],
) {
  const { ui, api, plan, models } = observed;
  const { workflow } = run.snapshot;
  if (!workflow.sourceWorkflowIdentity || !workflow.immutable)
    throw new Error(
      'STANDARD_RUN_REQUIRED: 旧Runは再開できません。Workflowを再生成し、新Runを作成してください。',
    );

  if (!ui || !api)
    throw new Error(
      'EXECUTION_SNAPSHOT_MISSING: saved Run workflow is absent; project files cannot replace it.',
    );
  const uiSha256 = hash(ui),
    apiSha256 = hash(api);
  if (
    uiSha256 !== workflow.uiSha256 ||
    apiSha256 !== workflow.apiSha256 ||
    hash({ uiSha256, apiSha256 }) !== workflow.workflowIdentity
  )
    throw new Error(
      `EXECUTION_SNAPSHOT_HASH_MISMATCH: saved Run workflow was modified. UI expected=${workflow.uiSha256} actual=${uiSha256}; API expected=${workflow.apiSha256} actual=${apiSha256}; identity expected=${workflow.workflowIdentity} actual=${hash({ uiSha256, apiSha256 })}. The original Run snapshot must be restored; never rewrite expected hashes.`,
    );
  if (workflow.immutable) {
    if (
      !plan ||
      !models ||
      hash(plan) !== run.snapshot.plan.sha256 ||
      hash(JSON.parse(modelGenerationInputs(models as ModelsArtifact, fallbacks))) !==
        workflow.modelsSha256
    )
      throw new Error(
        'EXECUTION_SNAPSHOT_HASH_MISMATCH: saved Run Prompt Plan or model identity is absent or modified.',
      );
  }
  enumerateImageTasks(api as ApiGraph, run);
  return { ui, api: api as ApiGraph };
}
