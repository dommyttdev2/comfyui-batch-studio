import type {
  ModelFamily,
  ModelsArtifact,
  NegativePromptGroups,
  PositivePromptGroups,
  PromptPlanArtifact,
  PromptPlanArtifactV2,
  StructuredPrompt,
} from './artifact-types.js';

export const positivePromptOrder = [
  'subject',
  'identity',
  'appearance',
  'style',
  'outfit',
  'expression',
  'action',
  'pose',
  'camera',
  'environment',
  'lighting',
  'effects',
] as const;

export const cameraPromptOrder = ['pov', 'angle', 'framing', 'gaze', 'focus'] as const;

export const negativePromptOrder = [
  'anatomy',
  'identity',
  'appearance',
  'subject',
  'outfit',
  'action',
  'camera',
  'environment',
  'artifacts',
  'content',
] as const;

const familyPolicy: Record<ModelFamily, { positivePrefix: string[]; negativePrefix: string[] }> = {
  illustrious: {
    positivePrefix: [
      'masterpiece',
      'best_quality',
      'very_aesthetic',
      'absurdres',
      'highly_detailed',
    ],
    negativePrefix: [
      'worst_quality',
      'lowres',
      'bad_anatomy',
      'extra_fingers',
      'extra_legs',
      'text',
      'watermark',
      'logo',
    ],
  },
  anima: {
    positivePrefix: [
      'masterpiece',
      'best quality',
      'very aesthetic',
      'absurdres',
      'highly detailed',
    ],
    negativePrefix: [
      'worst quality',
      'lowres',
      'bad anatomy',
      'extra fingers',
      'extra legs',
      'text',
      'watermark',
      'logo',
    ],
  },
};

function familyOf(models: ModelsArtifact): ModelFamily {
  return models.modelFamily === 'anima' ? 'anima' : 'illustrious';
}

function uniqueTags(tags: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    result.push(tag);
  }
  return result;
}

export function flattenPositiveGroups(groups?: PositivePromptGroups) {
  if (!groups) return [];
  const tags: string[] = [];
  for (const key of positivePromptOrder) {
    if (key === 'camera') {
      const camera = groups.camera;
      if (!camera) continue;
      for (const cameraKey of cameraPromptOrder) tags.push(...(camera[cameraKey] ?? []));
      continue;
    }
    tags.push(...(groups[key] ?? []));
  }
  return uniqueTags(tags);
}

export function flattenNegativeGroups(groups?: NegativePromptGroups) {
  if (!groups) return [];
  const tags: string[] = [];
  for (const key of negativePromptOrder) tags.push(...(groups[key] ?? []));
  return uniqueTags(tags);
}

function flattenPrompt(prompt?: StructuredPrompt) {
  return {
    positive: flattenPositiveGroups(prompt?.positive),
    negative: flattenNegativeGroups(prompt?.negative),
  };
}

function loraTriggers(usages: Array<{ modelRef: string }>, models: ModelsArtifact) {
  const byRef = new Map(models.loras.map((model) => [model.ref, model]));
  return uniqueTags(usages.flatMap((usage) => byRef.get(usage.modelRef)?.trainedWords ?? []));
}

function baseModelTriggers(models: ModelsArtifact) {
  return uniqueTags(
    models.modelFamily === 'anima'
      ? (models.diffusionModel?.trainedWords ?? [])
      : (models.checkpoint?.trainedWords ?? []),
  );
}

function selectedTriggers(prompt?: StructuredPrompt) {
  return prompt?.triggerWords?.flatMap((selection) => selection.words) ?? [];
}

function without(tags: string[], inherited: Set<string>) {
  return tags.filter((tag) => !inherited.has(tag));
}

export interface CompiledPromptLeaf {
  id: string;
  positive: string;
  negative: string;
  positiveTags: string[];
  negativeTags: string[];
}

export interface CompiledPromptBranch {
  id: string;
  leaves: CompiledPromptLeaf[];
}

export interface CompiledPromptPlan {
  common: {
    positive: string;
    negative: string;
    positiveTags: string[];
    negativeTags: string[];
  };
  branches: CompiledPromptBranch[];
}

export function compilePromptPlanPrompts(
  plan: PromptPlanArtifact,
  models: ModelsArtifact,
): CompiledPromptPlan {
  if (plan.schemaVersion === 1)
    return {
      common: {
        positive: plan.common.positive,
        negative: plan.common.negative,
        positiveTags: [],
        negativeTags: [],
      },
      branches: plan.branches.map((branch) => ({
        id: branch.id,
        leaves: branch.leaves.map((leaf) => ({
          id: leaf.id,
          positive: leaf.positive,
          negative: leaf.negative,
          positiveTags: [],
          negativeTags: [],
        })),
      })),
    };

  const v2 = plan as PromptPlanArtifactV2;
  const policy = familyPolicy[familyOf(models)];
  const common = flattenPrompt(v2.common);
  const commonPositiveTags = uniqueTags([
    ...policy.positivePrefix,
    ...(v2.triggerWordsMode === 'selected'
      ? selectedTriggers(v2.common)
      : [...baseModelTriggers(models), ...loraTriggers(v2.rootLoras, models)]),
    ...common.positive,
  ]);
  const commonNegativeTags = uniqueTags([...policy.negativePrefix, ...common.negative]);
  const inheritedPositive = new Set(commonPositiveTags);
  const inheritedNegative = new Set(commonNegativeTags);

  return {
    common: {
      positive: commonPositiveTags.join(', '),
      negative: commonNegativeTags.join(', '),
      positiveTags: commonPositiveTags,
      negativeTags: commonNegativeTags,
    },
    branches: v2.branches.map((branch) => {
      const branchPrompt = flattenPrompt(branch.prompt);
      const branchTriggers =
        v2.triggerWordsMode === 'selected'
          ? selectedTriggers(branch.prompt)
          : loraTriggers(branch.loras, models);
      return {
        id: branch.id,
        leaves: branch.leaves.map((leaf) => {
          const leafPrompt = flattenPrompt(leaf.prompt);
          const positiveTags = without(
            uniqueTags([
              ...branchTriggers,
              ...(v2.triggerWordsMode === 'selected' ? selectedTriggers(leaf.prompt) : []),
              ...branchPrompt.positive,
              ...leafPrompt.positive,
            ]),
            inheritedPositive,
          );
          const negativeTags = without(
            uniqueTags([...branchPrompt.negative, ...leafPrompt.negative]),
            inheritedNegative,
          );
          return {
            id: leaf.id,
            positive: positiveTags.join(', '),
            negative: negativeTags.join(', '),
            positiveTags,
            negativeTags,
          };
        }),
      };
    }),
  };
}
