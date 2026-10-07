export const MAX_ARTIFACT_BYTES = 10_000_000;
export const MAX_REFERENCE_BYTES = 12_000_000;
export type ArtifactStage =
  | 'story-initial'
  | 'story-finalize'
  | 'story-fix'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'prompt-plan-fix'
  | 'prompt-plan-patch'
  | 'caption';
const fileNames: Partial<Record<ArtifactStage, string>> = {
  'story-finalize': 'story.md',
  'story-fix': 'story.md',
  models: 'model_loras.json',
  'models-fix': 'model_loras.json',
  'prompt-plan': 'prompt_plan.json',
  'prompt-plan-fix': 'prompt_plan.json',
  'prompt-plan-patch': 'prompt_plan_patch.json',
  caption: 'caption_content.json',
};

export function expectedArtifact(stage: ArtifactStage): string | null {
  return fileNames[stage] ?? null;
}
export function artifactFileContent(stage: ArtifactStage, raw: string, extracted: string): string {
  if (stage === 'story-finalize' || stage === 'story-fix') return extracted.trimEnd();
  if (stage === 'prompt-plan-patch') {
    const fenced = raw.trim().match(/^`{3}(?:json)?\s*\n([\s\S]*?)\n`{3}\s*$/i);
    return JSON.stringify(JSON.parse(fenced?.[1] ?? raw), null, 2);
  }
  if (stage === 'models' || stage === 'models-fix') {
    // importGrok merges LoRA selections with the user's base models for the draft.
    // The downloadable model_loras.json must retain ONLY the agent's LoRA payload.
    const fenced = raw.match(/`{3}(?:json)?\s*\n([\s\S]*?)`{3}/i);
    const candidate = fenced?.[1] ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.stringify(JSON.parse(candidate.trim()), null, 2);
  }
  return JSON.stringify(JSON.parse(extracted), null, 2);
}
