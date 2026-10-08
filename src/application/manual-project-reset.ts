import type { ModelsArtifact } from '../domain/artifact-types.js';
import { cleanBase, restoreModelSelection } from '../domain/model-reset-policy.js';

export type ManualResetScope =
  | 'story'
  | 'base-models'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'workflow';
export interface ManualResetPorts {
  modelsFacts(): Promise<{ draft: ModelsArtifact | null; confirmed: ModelsArtifact | null }>;
  initialSelection(): Promise<unknown>;
  archiveModels(options?: {
    initialHistory: boolean;
    fixHistory: boolean;
    fallbacks: boolean;
  }): Promise<void>;
  archiveStory(): Promise<void>;
  archiveWorkflow(): Promise<void>;
  resetPromptAndWorkflow(): Promise<void>;
  writeModels(models: ModelsArtifact): Promise<void>;
  writeFallbacks(fallbacks: ReturnType<typeof restoreModelSelection>['fallbacks']): Promise<void>;
  checkpoint(name: string): Promise<void>;
}
export async function resetProjectFrom(ports: ManualResetPorts, scope: ManualResetScope) {
  if (scope === 'workflow') return ports.archiveWorkflow();
  if (scope === 'prompt-plan') return ports.resetPromptAndWorkflow();
  if (scope === 'models-fix' || scope === 'models') {
    const facts = await ports.modelsFacts(),
      current = facts.draft ?? facts.confirmed;
    if (!current) throw new Error('基盤モデルが未保存のためLoRA選定をリセットできません。');
    if (scope === 'models-fix') {
      const initial = await ports.initialSelection();
      if (!initial) throw new Error('初回のGrok LoRA選定履歴がないため再選定前へ戻せません。');
      await ports.archiveModels({ initialHistory: false, fixHistory: true, fallbacks: true });
      const restoration = restoreModelSelection(current, initial, 'models-fix', false);
      await ports.writeModels(restoration.models);
      await ports.checkpoint('models:restored');
      if (restoration.fallbacks.length) await ports.writeFallbacks(restoration.fallbacks);
    } else {
      const base = cleanBase(current);
      await ports.archiveModels({ initialHistory: true, fixHistory: true, fallbacks: true });
      await ports.writeModels(base);
      await ports.checkpoint('models:base-restored');
    }
    return ports.resetPromptAndWorkflow();
  }
  if (scope === 'story') await ports.archiveStory();
  else if (scope !== 'base-models') throw new Error('Unsupported reset scope.');
  await ports.archiveModels();
  await ports.resetPromptAndWorkflow();
}
