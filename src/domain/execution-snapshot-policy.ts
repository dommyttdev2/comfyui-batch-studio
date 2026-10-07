import type { ExecutionRunSnapshot } from './artifact-types.js';
import { graphToWorkflow } from './image-tasks.js';
import type { ApiGraph } from './workflow-graph.js';
export function seedExecutionSnapshot(
  api: unknown,
  snapshot: ExecutionRunSnapshot,
  paths: { uiPath: string; apiPath: string; planPath: string; modelsPath: string },
  seed: () => number,
  hash: (value: unknown) => string,
) {
  const seededApi = JSON.parse(JSON.stringify(api)) as ApiGraph;
  for (const node of Object.values(seededApi))
    if (node.class_type === 'KSampler') {
      const value = seed();
      if (!Number.isSafeInteger(value) || value < 0 || value >= 2 ** 48 - 1)
        throw new Error('Invalid Run seed.');
      node.inputs.seed = value;
    }
  const seededUi = graphToWorkflow(seededApi);
  const seededUiSha = hash(seededUi),
    seededApiSha = hash(seededApi);
  const next: ExecutionRunSnapshot = {
    ...snapshot,
    workflow: {
      ...snapshot.workflow,
      sourceWorkflowIdentity: snapshot.workflow.workflowIdentity,
      uiSha256: seededUiSha,
      apiSha256: seededApiSha,
      workflowIdentity: hash({ uiSha256: seededUiSha, apiSha256: seededApiSha }),
      uiPath: paths.uiPath,
      apiPath: paths.apiPath,
      immutable: { planPath: paths.planPath, modelsPath: paths.modelsPath },
    },
  };
  return { api: seededApi, ui: seededUi, snapshot: next };
}
