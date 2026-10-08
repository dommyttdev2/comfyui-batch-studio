export type AssistantProvider = 'grok' | 'codex';
export type AssistantStage = 'story' | 'models' | 'prompt-plan' | 'caption';
export interface AssistantProvidersState {
  schemaVersion: 2;
  projects: Record<
    string,
    { lastProvider: AssistantProvider; stages: Partial<Record<AssistantStage, AssistantProvider>> }
  >;
}
export interface AssistantPreferencePorts {
  key(project: string): string;
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  read(): Promise<unknown>;
  write(state: AssistantProvidersState): Promise<void>;
}
export function isAssistantProvider(value: unknown): value is AssistantProvider {
  return value === 'grok' || value === 'codex';
}
export function isAssistantStage(value: unknown): value is AssistantStage {
  return typeof value === 'string' && ['story', 'models', 'prompt-plan', 'caption'].includes(value);
}
export class AssistantProviderPreferences {
  constructor(private readonly ports: AssistantPreferencePorts) {}
  private async read(): Promise<AssistantProvidersState> {
    const value = await this.ports.read();
    if (value === null) return { schemaVersion: 2, projects: {} };
    const state = value as AssistantProvidersState;
    if (
      state.schemaVersion !== 2 ||
      !state.projects ||
      typeof state.projects !== 'object' ||
      Array.isArray(state.projects) ||
      Object.values(state.projects).some(
        (entry) =>
          !entry ||
          !isAssistantProvider(entry.lastProvider) ||
          !entry.stages ||
          Object.entries(entry.stages).some(
            ([stage, provider]) => !isAssistantStage(stage) || !isAssistantProvider(provider),
          ),
      )
    )
      throw new Error('Current assistant provider settings required.');
    return state;
  }
  async get(project: string, stage?: AssistantStage): Promise<AssistantProvider | null> {
    if (stage !== undefined && !isAssistantStage(stage)) throw new Error('Invalid assistant stage');
    return this.ports.exclusive(async () => {
      const entry = (await this.read()).projects[this.ports.key(project)];
      return (stage ? entry?.stages[stage] : null) ?? entry?.lastProvider ?? null;
    });
  }
  async remember(project: string, provider: AssistantProvider, stage?: AssistantStage) {
    if (!isAssistantProvider(provider)) throw new Error('Invalid assistant provider');
    if (stage !== undefined && !isAssistantStage(stage)) throw new Error('Invalid assistant stage');
    return this.ports.exclusive(async () => {
      const state = await this.read(),
        key = this.ports.key(project),
        old = state.projects[key];
      state.projects[key] = {
        lastProvider: provider,
        stages: { ...old?.stages, ...(stage ? { [stage]: provider } : {}) },
      };
      await this.ports.write(state);
    });
  }
  async resolve(
    project: string,
    defaultProvider: AssistantProvider,
    stage?: AssistantStage,
  ): Promise<AssistantProvider> {
    if (!isAssistantProvider(defaultProvider)) throw new Error('Invalid assistant provider');
    if (stage !== undefined && !isAssistantStage(stage)) throw new Error('Invalid assistant stage');
    return this.ports.exclusive(async () => {
      const state = await this.read(),
        key = this.ports.key(project),
        entry = state.projects[key],
        provider = (stage ? entry?.stages[stage] : null) ?? entry?.lastProvider ?? defaultProvider;
      if (!entry || (stage && !entry.stages[stage])) {
        state.projects[key] = {
          lastProvider: entry?.lastProvider ?? provider,
          stages: { ...entry?.stages, ...(stage ? { [stage]: provider } : {}) },
        };
        await this.ports.write(state);
      }
      return provider;
    });
  }
}
