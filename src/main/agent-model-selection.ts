import path from 'node:path';
import { validateAgentModelSelection } from '../domain/agent-state-policy.js';
import type { AgentModelSelection, AgentProvider, GrokContextStage } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';

interface ModelSelectionState {
  schemaVersion: 1;
  projects: Record<
    string,
    Partial<Record<GrokContextStage, Partial<Record<AgentProvider, AgentModelSelection>>>>
  >;
}

function projectKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export class AgentModelSelectionStore {
  private readonly filePath: string;
  private writes: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'agent-model-selections.json');
  }

  private async read(): Promise<ModelSelectionState> {
    const stored = await readJson<ModelSelectionState>(this.filePath);
    return stored?.schemaVersion === 1 && stored.projects && typeof stored.projects === 'object'
      ? stored
      : { schemaVersion: 1, projects: {} };
  }

  async get(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
  ): Promise<AgentModelSelection | null> {
    await this.writes;
    const value = (await this.read()).projects[projectKey(root)]?.[stage]?.[provider];
    if (!value || (value.model !== null && typeof value.model !== 'string')) return null;
    return {
      model: value.model,
      reasoningEffort:
        typeof value.reasoningEffort === 'string' || value.reasoningEffort === null
          ? value.reasoningEffort
          : undefined,
    };
  }

  async remember(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    value: AgentModelSelection,
  ): Promise<void> {
    validateAgentModelSelection(value);
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = projectKey(root);
        const project = { ...(state.projects[key] ?? {}) };
        const stageState = { ...(project[stage] ?? {}) };
        stageState[provider] = { ...value };
        project[stage] = stageState;
        state.projects[key] = project;
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writes;
  }
}
