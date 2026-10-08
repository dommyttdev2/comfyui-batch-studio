import { sameStoryBriefInputs } from '../domain/brief-impact-policy.js';
import type {
  ArtifactKey,
  ArtifactState,
  ArtifactSummary,
  ProjectBriefInput,
  ProjectSummary,
  ProjectMeta,
  ModelsArtifact,
  ValidationResult,
  WorkflowManifest,
  ProjectSettings,
} from '../domain/artifact-types.js';
export interface ProjectObservationPorts {
  files(projectId: string): Promise<string[]>;
  brief(projectId: string): Promise<ProjectBriefInput | null>;
  meta(projectId: string): Promise<ProjectMeta | null>;
  models(projectId: string): Promise<ModelsArtifact | null>;
  mtime(projectId: string, resourceId: string): Promise<number>;
  basename(projectId: string): string;
  artifact(
    projectId: string,
    key: ArtifactKey,
    kind: 'confirmed' | 'draft',
  ): Promise<{ exists: boolean; validation: ValidationResult }>;
  briefHistory(projectId: string): Promise<{ file: string; time: number }[]>;
  historyBrief(resourceId: string): Promise<ProjectBriefInput | null>;
  template(
    settings: ProjectSettings | undefined,
    family: 'illustrious' | 'anima',
  ): Promise<{ templateRaw: string; manifest: WorkflowManifest } | null>;
  modelHash(models: ModelsArtifact): string;
  templateHash(text: string): string;
  hashText(text: string): string;
}
const defs: Array<[ArtifactKey, string, string]> = [
  ['projectBrief', '基本設定', 'project_brief.json'],
  ['story', 'ストーリー', 'story.md'],
  ['models', 'モデル選定', 'models.json'],
  ['promptPlan', 'プロンプト設計', 'prompt_plan.json'],
];

async function briefChangedAfterStory(
  ports: ProjectObservationPorts,
  root: string,
  storyT: number,
  briefT: number,
) {
  if (!storyT || briefT <= storyT) return false;
  const current = await ports.brief(root);
  if (!current) return true;
  const candidates = (await ports.briefHistory(root))
    .filter((item) => item.time > storyT)
    .sort((a, b) => a.time - b.time);
  if (!candidates.length) return true;
  const baseline = await ports.historyBrief(candidates[0].file);
  if (!baseline) return true;
  return !sameStoryBriefInputs(current, baseline);
}

async function workflowInputsChanged(ports: ProjectObservationPorts, root: string, meta: any) {
  const build = meta?.workflowBuild as any;
  if (!build) return true;
  const models = await ports.models(root);
  if (!models || !build.modelsSha256 || build.modelsSha256 !== ports.modelHash(models)) return true;
  const family = models?.modelFamily === 'anima' ? 'anima' : 'illustrious';
  const resource = await ports.template(meta?.settings, family);
  if (!resource) return true;
  const { templateRaw, manifest } = resource;
  if (
    build.template?.sha256 !== ports.templateHash(templateRaw) ||
    build.template?.id !== manifest.template?.id ||
    build.template?.version !== manifest.template?.version
  )
    return true;
  if (
    build.manifest?.schemaVersion !== manifest.schemaVersion ||
    build.manifest?.version !== manifest.manifestVersion ||
    build.manifest?.sha256 !== ports.hashText(JSON.stringify(manifest))
  )
    return true;
  return false;
}

export async function scanProjectObservation(
  ports: ProjectObservationPorts,
  root: string,
): Promise<ProjectSummary> {
  const names = new Set(await ports.files(root));
  const brief = await ports.brief(root),
    meta = await ports.meta(root);
  const artifacts: ArtifactSummary[] = [];
  for (const [key, label, file] of defs) {
    const confirmed = await ports.artifact(root, key, 'confirmed');
    let state: ArtifactState = 'missing';
    if (confirmed.exists)
      state = confirmed.validation.valid
        ? confirmed.validation.issues.some((x) => x.severity === 'warning')
          ? 'warning'
          : 'confirmed'
        : 'invalid';
    else if (key !== 'projectBrief') {
      const draft = await ports.artifact(root, key, 'draft');
      if (draft.exists) state = draft.validation.valid ? 'draft' : 'invalid';
    }
    artifacts.push({
      key,
      label,
      relativePath: names.has(file) ? file : null,
      state,
      validation: confirmed.exists ? confirmed.validation : undefined,
    });
  }
  const briefT = await ports.mtime(root, 'project_brief.json'),
    storyT = await ports.mtime(root, 'story.md'),
    modelsT = await ports.mtime(root, 'models.json'),
    planT = await ports.mtime(root, 'prompt_plan.json');
  const storyA = artifacts.find((a) => a.key === 'story');
  if (
    storyA &&
    storyT &&
    (await briefChangedAfterStory(ports, root, storyT, briefT)) &&
    ['confirmed', 'warning'].includes(storyA.state)
  )
    storyA.state = 'stale';
  const modelsA = artifacts.find((a) => a.key === 'models');
  if (
    modelsA &&
    modelsT &&
    (storyT > modelsT || storyA?.state === 'stale') &&
    ['confirmed', 'warning'].includes(modelsA.state)
  )
    modelsA.state = 'stale';
  const planA = artifacts.find((a) => a.key === 'promptPlan');
  if (
    planA &&
    planT &&
    (storyT > planT || modelsA?.state === 'stale') &&
    ['confirmed', 'warning'].includes(planA.state)
  )
    planA.state = 'stale';
  const workflow =
    [...names].find((n) => /^LoRA_.+\.json$/i.test(n) && !n.toLowerCase().endsWith('.api.json')) ??
    null;
  let workflowState: ArtifactState = workflow ? 'generated' : 'missing';
  if (workflow) {
    const wt = await ports.mtime(root, workflow);
    if (
      planT > wt ||
      artifacts.some(
        (a) => ['story', 'models', 'promptPlan'].includes(a.key) && a.state === 'stale',
      ) ||
      (await workflowInputsChanged(ports, root, meta))
    )
      workflowState = 'stale';
  }
  artifacts.push({
    key: 'workflow',
    label: 'ワークフロー',
    relativePath: workflow,
    state: workflowState,
  });
  artifacts.push({
    key: 'legacyPromptTree',
    label: '旧 Prompt Tree',
    relativePath: names.has('prompt_tree.md') ? 'prompt_tree.md' : null,
    state: names.has('prompt_tree.md') ? 'legacy' : 'missing',
  });
  return {
    rootPath: root,
    title: brief?.project?.title?.trim() || ports.basename(root),
    id: brief?.project?.id ?? null,
    targetImageCount: brief?.generation?.target_image_count ?? null,
    artifacts,
    meta,
  };
}
