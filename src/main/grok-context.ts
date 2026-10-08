import path from 'node:path';
import { buildAgentTask } from '../application/agent-task-planning.js';
import type { GrokTask } from '../shared/types.js';
import { exists, readJson } from './fs-utils.js';
import { catalogPathFor } from './model-catalog.js';

export { artifactFileOutputRules } from '../domain/agent-task-policy.js';
export async function buildGrokTask(
  root: string,
  stage: GrokTask['stage'],
  extra = '',
): Promise<GrokTask> {
  const catalog = await catalogPathFor(root);
  const resources: Record<string, string> = {
    brief: path.join(root, 'project_brief.json'),
    story: path.join(root, 'story.md'),
    models: path.join(root, 'models.json'),
    'models-draft': path.join(root, '._batch_studio', 'drafts', 'models.json'),
    'model-prompt-fallbacks': path.join(root, '._batch_studio', 'model_prompt_fallbacks.json'),
    'prompt-plan': path.join(root, 'prompt_plan.json'),
    'prompt-plan-draft': path.join(root, '._batch_studio', 'drafts', 'prompt_plan.json'),
  };
  if (catalog) resources.catalog = path.resolve(catalog);
  const plan = await buildAgentTask(
    {
      exists: (id) => exists(resources[id]),
      json: (id) => readJson(resources[id]),
      catalogResourceId: async () => (catalog ? 'catalog' : null),
    },
    stage,
    extra,
  );
  return {
    ...plan,
    attachments: plan.attachments.map((item) => ({
      name: item.name,
      path: resources[item.resourceId],
      exists: item.exists,
      purpose: item.purpose,
    })),
  };
}
