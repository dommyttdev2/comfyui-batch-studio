import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type { AssistantPaneProvider, GrokContextStage } from '../shared/types.js';

interface SavedAssistantProviders {
  schemaVersion: 2;
  projects: Record<
    string,
    { lastProvider: AssistantPaneProvider; stages: Partial<Record<GrokContextStage, AssistantPaneProvider>> }
  >;
}
interface LegacyAssistantProviders {
  schemaVersion: 1;
  projects: Record<string, AssistantPaneProvider>;
}
const stages: GrokContextStage[] = ['story', 'models', 'prompt-plan', 'caption'];
export function isAssistantStage(value: unknown): value is GrokContextStage {
  return typeof value === 'string' && stages.includes(value as GrokContextStage);
}

export function isAssistantProvider(value: unknown): value is AssistantPaneProvider {
  return value === 'grok' || value === 'codex';
}

function projectKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Per-project, per-stage assistant selection. The legacy project-wide choice
 * serves as the initial fallback for stages that have never been opened.
 * Conversation histories remain in their provider-specific stores.
 */
export class AssistantProviderStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'assistant-provider-state.json');
  }

  private async read(): Promise<SavedAssistantProviders> {
    const value = await readJson<SavedAssistantProviders | LegacyAssistantProviders>(this.filePath);
    if (value?.schemaVersion === 2 && value.projects && typeof value.projects === 'object') {
      return value as SavedAssistantProviders;
    }
    if (value?.schemaVersion === 1 && value.projects && typeof value.projects === 'object') {
      return {
        schemaVersion: 2,
        projects: Object.fromEntries(
          Object.entries(value.projects)
            .filter(([, provider]) => isAssistantProvider(provider))
            .map(([root, provider]) => [root, { lastProvider: provider, stages: {} }]),
        ),
      };
    }
    return { schemaVersion: 2, projects: {} };
  }

  async get(
    projectRoot: string,
    stage?: GrokContextStage,
  ): Promise<AssistantPaneProvider | null> {
    await this.writeQueue;
    const entry = (await this.read()).projects[projectKey(projectRoot)];
    if (!entry) return null;
    const provider = stage && isAssistantProvider(entry.stages?.[stage])
      ? entry.stages[stage]
      : entry.lastProvider;
    return isAssistantProvider(provider) ? provider : null;
  }

  async remember(
    projectRoot: string,
    provider: AssistantPaneProvider,
    stage?: GrokContextStage,
  ): Promise<void> {
    if (!isAssistantProvider(provider)) throw new Error('Invalid assistant provider');
    if (stage !== undefined && !isAssistantStage(stage))
      throw new Error('Invalid assistant stage');
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = projectKey(projectRoot);
        const old = state.projects[key];
        state.projects[key] = {
          lastProvider: provider,
          stages: { ...old?.stages, ...(stage ? { [stage]: provider } : {}) },
        };
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writeQueue;
  }

  async resolve(
    projectRoot: string,
    defaultProvider: AssistantPaneProvider,
    legacyProvider: () => Promise<AssistantPaneProvider | null>,
    stage?: GrokContextStage,
  ): Promise<AssistantPaneProvider> {
    // A stage-specific value takes precedence over the project-wide legacy
    // choice. Resolve and persist the initial choice without overwriting an
    // explicit switch made while an earlier asynchronous lookup was pending.
    await this.writeQueue;
    const saved = await this.get(projectRoot, stage);
    if (saved) return saved;
    const legacy = await legacyProvider();
    const candidate = legacy ?? defaultProvider;
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = projectKey(projectRoot);
        if (!state.projects[key]) {
          state.projects[key] = {
            lastProvider: candidate,
            stages: stage ? { [stage]: candidate } : {},
          };
          await writeJsonAtomic(this.filePath, state);
        }
      });
    await this.writeQueue;
    return (await this.get(projectRoot, stage)) ?? candidate;
  }
}
