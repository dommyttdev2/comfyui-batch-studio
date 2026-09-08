import path from 'node:path';
import { exists, readJson, writeJsonAtomic } from './fs-utils.js';

interface UiState {
  schemaVersion: 1;
  lastProjectPath?: string;
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
    await writeJsonAtomic(this.filePath, {
      ...(await this.read()),
      schemaVersion: 1,
      lastProjectPath: path.resolve(projectPath),
    });
  }

  async lastProjectPath(): Promise<string | null> {
    const value = (await this.read()).lastProjectPath;
    if (!value || !path.isAbsolute(value) || !(await exists(value))) return null;
    return value;
  }
}
