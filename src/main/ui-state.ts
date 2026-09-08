import path from 'node:path';
import { exists, readJson, writeJsonAtomic } from './fs-utils.js';

const RECENT_PROJECT_LIMIT = 8;

interface UiState {
  schemaVersion: 1;
  lastProjectPath?: string;
  recentProjectPaths?: string[];
}

export class UiStateStore {
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'ui-state.json');
  }

  private async read(): Promise<UiState> {
    const value = await readJson<UiState>(this.filePath);
    return value?.schemaVersion === 1 ? value : { schemaVersion: 1 };
  }

  async rememberProject(projectPath: string): Promise<void> {
    const resolved = path.resolve(projectPath);
    const current = await this.read();
    const recent = Array.isArray(current.recentProjectPaths) ? current.recentProjectPaths : [];
    await writeJsonAtomic(this.filePath, {
      ...current,
      schemaVersion: 1,
      lastProjectPath: resolved,
      recentProjectPaths: [resolved, ...recent.filter(item => item !== resolved)].slice(0, RECENT_PROJECT_LIMIT),
    });
  }

  async clearProject(): Promise<void> {
    const current = await this.read();
    delete current.lastProjectPath;
    await writeJsonAtomic(this.filePath, current);
  }

  async lastProjectPath(): Promise<string | null> {
    const value = (await this.read()).lastProjectPath;
    if (!value || !path.isAbsolute(value) || !(await exists(value))) return null;
    return value;
  }

  async recentProjectPaths(): Promise<string[]> {
    const current = await this.read();
    const recent = Array.isArray(current.recentProjectPaths) ? current.recentProjectPaths : [];
    const valid: string[] = [];
    for (const item of recent) {
      if (typeof item !== 'string' || !path.isAbsolute(item) || valid.includes(item) || !(await exists(item))) continue;
      valid.push(item);
      if (valid.length >= RECENT_PROJECT_LIMIT) break;
    }
    if (valid.length !== recent.length || valid.some((item, index) => item !== recent[index])) {
      await writeJsonAtomic(this.filePath, { ...current, recentProjectPaths: valid });
    }
    return valid;
  }
}
