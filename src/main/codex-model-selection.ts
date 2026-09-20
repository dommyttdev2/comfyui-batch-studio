import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type { CodexModelSelection, GrokContextStage } from '../shared/types.js';

interface StoredSelections {
  schemaVersion: 1;
  projects: Record<string, Partial<Record<GrokContextStage, CodexModelSelection>>>;
}

function projectKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export class CodexModelSelectionStore {
  private readonly filePath: string;
  private writes: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'codex-model-selections.json');
  }

  private async read(): Promise<StoredSelections> {
    const stored = await readJson<StoredSelections>(this.filePath);
    return stored?.schemaVersion === 1 && stored.projects && typeof stored.projects === 'object'
      ? stored
      : { schemaVersion: 1, projects: {} };
  }

  async get(root: string, stage: GrokContextStage): Promise<CodexModelSelection | null> {
    await this.writes;
    const value = (await this.read()).projects[projectKey(root)]?.[stage];
    if (!value || typeof value.model !== 'string' || typeof value.effort !== 'string')
      return null;
    return { model: value.model, effort: value.effort };
  }

  async remember(root: string, stage: GrokContextStage, value: CodexModelSelection): Promise<void> {
    if (!value.model.trim() || !value.effort.trim()) throw new Error('Invalid Codex model selection.');
    this.writes = this.writes.catch(() => {}).then(async () => {
      const state = await this.read();
      const key = projectKey(root);
      state.projects[key] = { ...(state.projects[key] ?? {}), [stage]: { ...value } };
      await writeJsonAtomic(this.filePath, state);
    });
    await this.writes;
  }
}
