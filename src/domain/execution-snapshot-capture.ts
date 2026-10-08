import type {
  ExecutionRunSnapshot,
  ModelsArtifact,
  PreflightResult,
  PromptFallback,
  PromptPlanArtifact,
} from './artifact-types.js';
import { enumerateImageTasks } from './image-tasks.js';
import { modelGenerationInputs } from './model-impact.js';
import { type ApiGraph, validateApiGraphStructure } from './workflow-graph.js';
export interface ExecutionSnapshotFacts {
  projectId: string;
  target: 'local' | 'remote';
  remote: ExecutionRunSnapshot['remote'];
  uiPath: string;
  apiPath: string;
  expectedUiSha: string;
  expectedApiSha: string;
  expectedIdentity: string;
  expectedModelsSha: string;
  ui: unknown;
  api: unknown;
  models: ModelsArtifact | null;
  plan: PromptPlanArtifact | null;
  fallbacks?: PromptFallback[];
}
export function captureExecutionSnapshot(
  facts: ExecutionSnapshotFacts,
  preflight: PreflightResult,
  hash: (value: unknown) => string,
): ExecutionRunSnapshot {
  const {
    uiPath,
    apiPath,
    expectedUiSha,
    expectedApiSha,
    expectedIdentity,
    expectedModelsSha,
    ui,
    api,
    models,
    plan,
    target,
    remote,
  } = facts;
  if (!uiPath || !apiPath || !expectedUiSha || !expectedApiSha || !expectedIdentity)
    throw new Error('Execution cannot start: Workflow/API graph provenance is missing.');

  if (!ui || !api) throw new Error('Execution cannot start: Workflow/API graph file is missing.');
  const apiIssues = validateApiGraphStructure(api).filter((issue) => issue.severity === 'error');
  if (apiIssues.length)
    throw new Error(
      `Execution cannot start: API graph is invalid: ${apiIssues.map((issue) => issue.message).join(' / ')}`,
    );
  const uiSha256 = hash(ui),
    apiSha256 = hash(api),
    workflowIdentity = hash({ uiSha256, apiSha256 });
  if (
    uiSha256 !== expectedUiSha ||
    apiSha256 !== expectedApiSha ||
    workflowIdentity !== expectedIdentity
  )
    throw new Error('Execution cannot start/resume: Workflow/API graph is stale.');

  if (
    !models ||
    !expectedModelsSha ||
    hash(JSON.parse(modelGenerationInputs(models as ModelsArtifact, facts.fallbacks ?? []))) !==
      expectedModelsSha
  )
    throw new Error('Execution cannot start/resume: WORKFLOW_MODEL_STALE (models.json changed).');
  if (!facts.projectId) throw new Error('Execution cannot start: project.id is missing.');

  if (!plan) throw new Error('Execution cannot start: prompt_plan.json is missing.');

  const promptPlanSha256 = hash(plan);
  enumerateImageTasks(
    api as ApiGraph,
    {
      snapshot: {
        plan: {
          branches: plan.branches.map((branch) => ({
            branchId: branch.id,
            leafIds: branch.leaves.map((leaf) => leaf.id),
          })),
        },
      },
    } as any,
  );
  const planSnapshot = {
    sha256: promptPlanSha256,
    branches: plan.branches.map((branch) => ({
      branchId: branch.id,
      leafIds: branch.leaves.map((leaf) => leaf.id),
    })),
  };
  const runIdentity = hash({
    projectId: facts.projectId,
    target,
    workflowIdentity,
    apiSha256,
    promptPlanSha256,
    modelsSha256: expectedModelsSha,
  });
  return {
    projectId: String(facts.projectId),
    target,
    remote,
    preflight: JSON.parse(JSON.stringify(preflight)),
    workflow: {
      uiPath,
      apiPath,
      uiSha256,
      apiSha256,
      workflowIdentity,
      modelsSha256: expectedModelsSha,
    },
    plan: planSnapshot,
    runIdentity,
  };
}
