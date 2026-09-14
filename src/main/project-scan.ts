import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArtifactKey,
  ArtifactState,
  ArtifactSummary,
  ProjectBriefInput,
  ProjectSummary,
} from '../shared/types.js';
import { exists, readJson, readText } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
import { readArtifact } from './artifact-service.js';
import { resolveWorkflowTemplatePaths } from './workflow-template-paths.js';
const defs: Array<[ArtifactKey, string, string]> = [
  ['projectBrief', '基本設定', 'project_brief.json'],
  ['story', 'ストーリー', 'story.md'],
  ['models', 'モデル選定', 'models.json'],
  ['promptPlan', 'プロンプト設計', 'prompt_plan.json'],
];
async function mtime(p: string) {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}
function sha256(text: string) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function normalizeTemplateText(text: string) {
  return text.replace(/\r\n?/g, '\n');
}
function storyBriefInputs(value: any) {
  const copy = structuredClone(value ?? {});
  if (copy?.generation && typeof copy.generation === 'object') delete copy.generation.modelFamily;
  return copy;
}
function sameStoryBriefInputs(a: any, b: any) {
  return JSON.stringify(storyBriefInputs(a)) === JSON.stringify(storyBriefInputs(b));
}
function historyTimestamp(name: string) {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/);
  if (!match) return 0;
  const [, date, hour, minute, second, millis] = match;
  return Date.parse(`${date}T${hour}:${minute}:${second}.${millis}Z`);
}
async function briefChangedAfterStory(root: string, storyT: number, briefT: number) {
  if (!storyT || briefT <= storyT) return false;
  const current = await readJson<any>(path.join(root, 'project_brief.json'));
  if (!current) return true;
  const historyDir = path.join(root, '._batch_studio', 'history', 'projectBrief');
  let names: string[] = [];
  try {
    names = (await readdir(historyDir)).filter((name) => name.endsWith('-project_brief.json'));
  } catch {
    return true;
  }
  const candidates = names
    .map((name) => ({ file: path.join(historyDir, name), time: historyTimestamp(name) }))
    .filter((item) => item.time > storyT)
    .sort((a, b) => a.time - b.time);
  if (!candidates.length) return true;
  const baseline = await readJson<any>(candidates[0].file);
  if (!baseline) return true;
  return !sameStoryBriefInputs(current, baseline);
}
async function workflowInputsChanged(root: string, meta: any) {
  const build = meta?.workflowBuild as any;
  if (!build) return true;
  const models = await readJson<any>(path.join(root, 'models.json'));
  const family = models?.modelFamily === 'anima' ? 'anima' : 'illustrious';
  const { templatePath, manifestPath } = resolveWorkflowTemplatePaths(meta?.settings, family);
  if (!(await exists(templatePath)) || !(await exists(manifestPath))) return true;
  const templateRaw = await readText(templatePath),
    manifest = await readJson<any>(manifestPath);
  if (!templateRaw || !manifest) return true;
  if (
    build.template?.sha256 !== sha256(normalizeTemplateText(templateRaw)) ||
    build.template?.id !== manifest.template?.id ||
    build.template?.version !== manifest.template?.version
  )
    return true;
  if (
    build.manifest?.schemaVersion !== manifest.schemaVersion ||
    build.manifest?.version !== manifest.manifestVersion ||
    build.manifest?.sha256 !== sha256(JSON.stringify(manifest))
  )
    return true;
  return false;
}
export async function scanProject(root: string): Promise<ProjectSummary> {
  const entries = await readdir(root, { withFileTypes: true });
  const names = new Set(entries.filter((e) => e.isFile()).map((e) => e.name));
  const brief = await readJson<{ schemaVersion?: number } & ProjectBriefInput>(
    path.join(root, 'project_brief.json'),
  );
  const meta = await readProjectMeta(root);
  const artifacts: ArtifactSummary[] = [];
  for (const [key, label, file] of defs) {
    const confirmed = await readArtifact(root, key, 'confirmed');
    let state: ArtifactState = 'missing';
    if (confirmed.exists)
      state = confirmed.validation.valid
        ? confirmed.validation.issues.some((x) => x.severity === 'warning')
          ? 'warning'
          : 'confirmed'
        : 'invalid';
    else if (key !== 'projectBrief') {
      const draft = await readArtifact(root, key, 'draft');
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
  const briefT = await mtime(path.join(root, 'project_brief.json')),
    storyT = await mtime(path.join(root, 'story.md')),
    modelsT = await mtime(path.join(root, 'models.json')),
    planT = await mtime(path.join(root, 'prompt_plan.json'));
  const storyA = artifacts.find((a) => a.key === 'story');
  if (
    storyA &&
    storyT &&
    (await briefChangedAfterStory(root, storyT, briefT)) &&
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
    const wt = await mtime(path.join(root, workflow));
    if (
      planT > wt ||
      artifacts.some(
        (a) => ['story', 'models', 'promptPlan'].includes(a.key) && a.state === 'stale',
      ) ||
      (await workflowInputsChanged(root, meta))
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
    title: brief?.project?.title?.trim() || path.basename(root),
    id: brief?.project?.id ?? null,
    targetImageCount: brief?.generation?.target_image_count ?? null,
    artifacts,
    meta,
  };
}
