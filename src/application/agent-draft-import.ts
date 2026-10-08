import type { GrokTask } from '../domain/agent-runtime-types.js';
import type { ImportResult } from '../domain/artifact-types.js';
export interface AgentDraftImportPorts {
  caption(root: string, raw: string, provider: 'grok' | 'codex'): Promise<ImportResult>;
  patch(
    root: string,
    raw: string,
  ): Promise<Pick<ImportResult, 'extracted' | 'validation' | 'summary'>>;
  artifact(
    root: string,
    key: 'story' | 'models' | 'promptPlan',
    raw: string,
    stage: Exclude<GrokTask['stage'], 'story-initial' | 'caption' | 'prompt-plan-patch'>,
    provider: 'grok' | 'codex',
  ): Promise<ImportResult>;
}
export function importAgentDraft(
  ports: AgentDraftImportPorts,
  root: string,
  stage: GrokTask['stage'],
  raw: string,
  provider: 'grok' | 'codex',
) {
  if (stage === 'caption') return ports.caption(root, raw, provider);
  if (stage === 'prompt-plan-patch') return ports.patch(root, raw);
  if (stage === 'story-initial') throw new Error('Discussion has no draft artifact.');
  return ports.artifact(
    root,
    stage.startsWith('story-') ? 'story' : stage.startsWith('models') ? 'models' : 'promptPlan',
    raw,
    stage,
    provider,
  );
}
