import { compileImageWorkflow } from '../domain/workflow-compilation.js';
import {
  validateModels,
  validatePromptPlan,
  validateWorkflowManifest,
} from '../domain/artifact-validation.js';
import type {
  ModelsArtifact,
  PromptPlanArtifact,
  WorkflowManifest,
  ProjectMeta,
} from '../domain/artifact-types.js';
export interface WorkflowFilePorts {
  readJson<T>(resource: string): Promise<T | null>;
  readText(resource: string): Promise<string | null>;
  removeIfExists(resource: string): Promise<void>;
  writeJsonAtomic(resource: string, value: unknown): Promise<void>;
  readProjectMeta(project: string): Promise<ProjectMeta | null>;
  saveWorkflowBuild(
    project: string,
    build: NonNullable<ProjectMeta['workflowBuild']>,
  ): Promise<void>;
  hashCanonicalJson(value: unknown): string;
  hashWorkflowModelInputs(value: ModelsArtifact): string;
  hashWorkflowTemplate(raw: string): string;
  hashText(raw: string): string;
  now(): string;
  resolveWorkflowTemplatePaths(
    settings: ProjectMeta['settings'] | undefined,
    family: 'anima' | 'illustrious',
  ): { templatePath: string; manifestPath: string };
  path: {
    join(...parts: string[]): string;
    basename(resource: string): string;
    dirname(resource: string): string;
    resolve(resource: string): string;
  };
}
export async function compileWorkflowFiles(io: WorkflowFilePorts, root: string) {
  const models = await io.readJson<ModelsArtifact>(io.path.join(root, 'models.json'));
  const plan = await io.readJson<PromptPlanArtifact>(io.path.join(root, 'prompt_plan.json'));
  if (!models || !plan) throw new Error('models.json と prompt_plan.json の確定版が必要です。');
  const issues = [...validateModels(models).issues, ...validatePromptPlan(plan, models).issues];
  if (issues.some((issue) => issue.severity === 'error'))
    throw new Error(
      issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join('\n'),
    );
  const meta = await io.readProjectMeta(root);
  const family = models.modelFamily === 'anima' ? 'anima' : 'illustrious';
  const paths = io.resolveWorkflowTemplatePaths(meta?.settings, family);
  const raw = await io.readText(paths.templatePath);
  const manifest = await io.readJson<WorkflowManifest>(paths.manifestPath);
  if (!raw || !manifest || !validateWorkflowManifest(manifest).valid)
    throw new Error(
      'STANDARD_TEMPLATE_REQUIRED: 標準Template / Manifestを使用し、Workflowを再生成してください。',
    );
  if (io.hashWorkflowTemplate(raw) !== manifest.template.sha256)
    throw new Error('Template SHA-256 mismatch');
  const brief = await io.readJson<any>(io.path.join(root, 'project_brief.json'));
  const projectId = brief?.project?.id;
  const { api, ui } = compileImageWorkflow(
    { ...models, modelFamily: family },
    plan,
    raw,
    brief?.project?.id,
  );
  const folder = io.path.basename(io.path.dirname(io.path.resolve(root))).trim();
  const outputPath = io.path.join(root, `LoRA_${folder}.json`);
  const apiOutputPath = outputPath.replace(/\.json$/i, '.api.json');
  await io.writeJsonAtomic(outputPath, ui);
  await io.writeJsonAtomic(apiOutputPath, api);
  const old = io.path.join(root, `LoRA_${projectId}.json`);
  if (old !== outputPath) await io.removeIfExists(old);
  const uiSha256 = io.hashCanonicalJson(ui),
    apiSha256 = io.hashCanonicalJson(api);
  const workflowIdentity = io.hashCanonicalJson({ uiSha256, apiSha256 });
  const imageCount = plan.branches.reduce((count, branch) => count + branch.leaves.length, 0);
  await io.saveWorkflowBuild(root, {
    compilerVersion: '3.0.0',
    modelsSha256: io.hashWorkflowModelInputs(models),
    generatedAt: io.now(),
    template: manifest.template,
    manifest: {
      schemaVersion: manifest.schemaVersion,
      version: manifest.manifestVersion,
      sha256: io.hashText(JSON.stringify(manifest)),
    },
    branchCount: plan.branches.length,
    imageCount,
    outputPath: io.path.basename(outputPath),
    apiOutputPath: io.path.basename(apiOutputPath),
    outputs: {
      ui: { path: io.path.basename(outputPath), sha256: uiSha256 },
      api: { path: io.path.basename(apiOutputPath), sha256: apiSha256 },
    },
    workflowIdentity,
  });
  return {
    outputPath,
    apiOutputPath,
    branchCount: plan.branches.length,
    imageCount,
    nodeCount: ui.nodes.length,
    linkCount: ui.links.length,
    uiSha256,
    apiSha256,
    workflowIdentity,
    validation: { valid: true, issues },
  };
}
