import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type { AssistantPaneProvider } from '../shared/types.js';

interface SavedAssistantProviders {
  schemaVersion: 1;
  projects: Record<string, AssistantPaneProvider>;
}

export function isAssistantProvider(value: unknown): value is AssistantPaneProvider {
  return value === 'grok' || value === 'codex';
}

function projectKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Only the last selected provider is stored here. Conversation histories are
 * deliberately kept in their existing provider-specific stores.
 */
export class AssistantProviderStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'assistant-provider-state.json');
  }

  private async read(): Promise<SavedAssistantProviders> {
    const value = await readJson<SavedAssistantProviders>(this.filePath);
    return value?.schemaVersion === 1 && value.projects && typeof value.projects === 'object'
      ? value
      : { schemaVersion: 1, projects: {} };
  }

  async get(projectRoot: string): Promise<AssistantPaneProvider | null> {
    await this.writeQueue;
    const value = (await this.read()).projects[projectKey(projectRoot)];
    return isAssistantProvider(value) ? value : null;
  }

  async remember(projectRoot: string, provider: AssistantPaneProvider): Promise<void> {
    if (!isAssistantProvider(provider)) throw new Error('Invalid assistant provider');
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const state = await this.read();
      state.projects[projectKey(projectRoot)] = provider;
      await writeJsonAtomic(this.filePath, state);
    });
    await this.writeQueue;
  }

  async resolve(
    projectRoot: string,
    defaultProvider: AssistantPaneProvider,
    legacyProvider: () => Promise<AssistantPaneProvider | null>,
  ): Promise<AssistantPaneProvider> {
    // Recheck inside the serialized update to prevent concurrent first opens
    // from overwriting an explicit switch made in another window.
    await this.writeQueue;
    const saved = await this.get(projectRoot);
    if (saved) return saved;
    const legacy = await legacyProvider();
    const candidate = legacy ?? defaultProvider;
    this.writeQueue = this.writeQueue.catch(() => {}).then(async () => {
      const state = await this.read();
      const key = projectKey(projectRoot);
      if (!isAssistantProvider(state.projects[key])) {
        state.projects[key] = candidate;
        await writeJsonAtomic(this.filePath, state);
      }
    });
    await this.writeQueue;
    return (await this.get(projectRoot)) ?? candidate;
  }
}
