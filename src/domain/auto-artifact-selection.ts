import type { AutoArtifactEvent } from './auto-artifact-types.js';
export function selectLatestAutoArtifact(
  records: Record<string, AutoArtifactEvent>,
  provider: 'grok' | 'codex',
  stage: string,
  sourcePrefix = '',
): AutoArtifactEvent | null {
  const found = Object.values(records).filter(
    (record) =>
      record.provider === provider &&
      (record.stage === stage ||
        (stage === 'story' && record.stage.startsWith('story-')) ||
        (stage === 'models' && record.stage.startsWith('models')) ||
        (stage === 'prompt-plan' && record.stage.startsWith('prompt-plan'))) &&
      record.sourceId.startsWith(sourcePrefix),
  );
  return found.at(-1) ?? null;
}
