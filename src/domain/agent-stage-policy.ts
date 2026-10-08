import type { GrokContextStage, GrokTask } from './agent-runtime-types.js';
export const agentTaskContexts: Record<GrokContextStage, GrokTask['stage'][]> = {
  story: ['story-initial', 'story-finalize', 'story-fix'],
  models: ['models', 'models-fix'],
  'prompt-plan': ['prompt-plan', 'prompt-plan-fix', 'prompt-plan-patch'],
  caption: ['caption'],
};
export function contextStageForTask(stage: GrokTask['stage']): GrokContextStage {
  for (const context of Object.keys(agentTaskContexts) as GrokContextStage[])
    if (agentTaskContexts[context].includes(stage)) return context;
  throw new Error('Invalid task stage.');
}
