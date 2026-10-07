import type { ModelsArtifact, PromptPlanArtifact } from './artifact-types.js';
import {
  buildImageGraph,
  enumerateImageTasks,
  type GenerationDefaults,
  graphToWorkflow,
} from './image-tasks.js';
import { validateApiGraphStructure } from './workflow-graph.js';
export function compileImageWorkflow(
  models: ModelsArtifact,
  plan: PromptPlanArtifact,
  raw: string,
  projectId: string,
) {
  const family = models.modelFamily;
  const template = JSON.parse(raw) as {
    contract: number;
    modelFamily: string;
    generation: GenerationDefaults;
  };
  const d = template.generation;
  if (
    template.contract !== 1 ||
    template.modelFamily !== family ||
    !d ||
    !Number.isInteger(d.width) ||
    !Number.isInteger(d.height) ||
    d.width < 16 ||
    d.height < 16 ||
    d.width % 8 ||
    d.height % 8 ||
    !Number.isInteger(d.steps) ||
    d.steps < 1 ||
    !Number.isFinite(d.cfg) ||
    d.cfg < 0 ||
    !Number.isFinite(d.denoise) ||
    d.denoise < 0 ||
    d.denoise > 1 ||
    !d.sampler_name ||
    !d.scheduler
  )
    throw new Error('STANDARD_TEMPLATE_INVALID');
  if (typeof projectId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(projectId))
    throw new Error('project.idが不正です。');
  const api = buildImageGraph(models, plan, projectId, d);
  const apiIssues = validateApiGraphStructure(api);
  if (apiIssues.length) throw new Error(apiIssues.map((issue) => issue.message).join('\n'));
  enumerateImageTasks(api, {
    snapshot: {
      plan: {
        branches: plan.branches.map((branch) => ({
          branchId: branch.id,
          leafIds: branch.leaves.map((leaf) => leaf.id),
        })),
      },
    },
  } as any);
  const ui = graphToWorkflow(api);
  return { api, ui };
}
