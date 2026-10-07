import { createHash } from 'node:crypto';
import path from 'node:path';
import { compileImageWorkflow } from '../domain/workflow-compilation.js';
import type {
  CompileResult,
  ModelsArtifact,
  PromptPlanArtifact,
  WorkflowManifest,
} from '../shared/types.js';
import { readJson, readText, removeIfExists, writeJsonAtomic } from './fs-utils.js';
import {
  buildImageGraph,
  enumerateImageTasks,
  type GenerationDefaults,
  graphToWorkflow,
} from './image-tasks.js';
import { readProjectMeta, saveWorkflowBuild } from './project-meta.js';
import { withProjectMutationLock } from './project-transaction.js';
import { validateModels, validatePromptPlan, validateWorkflowManifest } from './validation.js';
import {
  hashCanonicalJson,
  hashWorkflowModelInputs,
  validateApiGraphStructure,
} from './workflow-api.js';
import { hashWorkflowTemplate } from './workflow-template-integrity.js';
import { resolveWorkflowTemplatePaths } from './workflow-template-paths.js';

export async function compileWorkflow(root: string): Promise<CompileResult> {
  return withProjectMutationLock(root, async () => {
    const models = await readJson<ModelsArtifact>(path.join(root, 'models.json'));
    const plan = await readJson<PromptPlanArtifact>(path.join(root, 'prompt_plan.json'));
    if (!models || !plan) throw new Error('models.json と prompt_plan.json の確定版が必要です。');
    const issues = [...validateModels(models).issues, ...validatePromptPlan(plan, models).issues];
    if (issues.some((issue) => issue.severity === 'error'))
      throw new Error(
        issues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join('\n'),
      );
    const meta = await readProjectMeta(root);
    const family = models.modelFamily === 'anima' ? 'anima' : 'illustrious';
    const paths = resolveWorkflowTemplatePaths(meta?.settings, family);
    const raw = await readText(paths.templatePath);
    const manifest = await readJson<WorkflowManifest>(paths.manifestPath);
    if (!raw || !manifest || !validateWorkflowManifest(manifest).valid)
      throw new Error(
        'STANDARD_TEMPLATE_REQUIRED: 標準Template / Manifestを使用し、Workflowを再生成してください。',
      );
    if (hashWorkflowTemplate(raw) !== manifest.template.sha256)
      throw new Error('Template SHA-256 mismatch');
    const brief = await readJson<any>(path.join(root, 'project_brief.json'));
    const projectId = brief?.project?.id;
    const { api, ui } = compileImageWorkflow(
      { ...models, modelFamily: family },
      plan,
      raw,
      brief?.project?.id,
    );
    const folder = path.basename(path.dirname(path.resolve(root))).trim();
    const outputPath = path.join(root, `LoRA_${folder}.json`);
    const apiOutputPath = outputPath.replace(/\.json$/i, '.api.json');
    await writeJsonAtomic(outputPath, ui);
    await writeJsonAtomic(apiOutputPath, api);
    const old = path.join(root, `LoRA_${projectId}.json`);
    if (old !== outputPath) await removeIfExists(old);
    const uiSha256 = hashCanonicalJson(ui),
      apiSha256 = hashCanonicalJson(api);
    const workflowIdentity = hashCanonicalJson({ uiSha256, apiSha256 });
    const imageCount = plan.branches.reduce((count, branch) => count + branch.leaves.length, 0);
    await saveWorkflowBuild(root, {
      compilerVersion: '3.0.0',
      modelsSha256: hashWorkflowModelInputs(models),
      generatedAt: new Date().toISOString(),
      template: manifest.template,
      manifest: {
        schemaVersion: manifest.schemaVersion,
        version: manifest.manifestVersion,
        sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
      },
      branchCount: plan.branches.length,
      imageCount,
      outputPath: path.basename(outputPath),
      apiOutputPath: path.basename(apiOutputPath),
      outputs: {
        ui: { path: path.basename(outputPath), sha256: uiSha256 },
        api: { path: path.basename(apiOutputPath), sha256: apiSha256 },
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
  });
}
