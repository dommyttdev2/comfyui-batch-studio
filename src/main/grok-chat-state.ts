import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type { GrokContextStage } from '../shared/types.js';

interface GrokChatState {
  schemaVersion: 1;
  projects: Record<string, Partial<Record<GrokContextStage, string>>>;
}

export class GrokChatStateStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'grok-chat-state.json');
  }

  private async read(): Promise<GrokChatState> {
    const value = await readJson<GrokChatState>(this.filePath);
    return value?.schemaVersion === 1 && value.projects && typeof value.projects === 'object'
      ? value
      : { schemaVersion: 1, projects: {} };
  }

  async remember(projectPath: string, stage: GrokContextStage, url: string): Promise<void> {
    const root = path.resolve(projectPath);
    this.writeQueue = this.writeQueue.then(async () => {
      const state = await this.read();
      state.projects[root] = { ...(state.projects[root] ?? {}), [stage]: url };
      await writeJsonAtomic(this.filePath, state);
    });
    await this.writeQueue;
  }

  async get(projectPath: string, stage: GrokContextStage): Promise<string | null> {
    await this.writeQueue;
    return (await this.read()).projects[path.resolve(projectPath)]?.[stage] ?? null;
  }
}
