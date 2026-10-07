import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { cleanBase, restoreModelSelection } from '../domain/model-reset-policy.js';
import type { ModelsArtifact } from '../shared/types.js';
import { exists, readJson, writeJsonAtomic } from './fs-utils.js';
import { updateProjectMeta } from './project-meta.js';
import { projectTransactionCheckpoint, withProjectTransaction } from './project-transaction.js';

export type ManualResetScope =
  | 'story'
  | 'base-models'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'workflow';

import { normalizedFallback } from '../domain/model-impact.js';

export { modelGenerationInputs, modelGenerationInputsChanged } from '../domain/model-impact.js';

type ResetContext = { root: string; internal: string; archiveRoot: string };

function context(root: string): ResetContext {
  const internal = path.join(root, '._batch_studio');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return {
    root,
    internal,
    archiveRoot: path.join(
      internal,
      'history',
      'downstream-reset',
      `${stamp}-${randomUUID().slice(0, 8)}`,
    ),
  };
}
async function archiveIfExists(ctx: ResetContext, source: string, relative: string) {
  if (!(await exists(source))) return false;
  const destination = path.join(ctx.archiveRoot, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await rename(source, destination);
  await projectTransactionCheckpoint('archived:' + relative);
  return true;
}
async function archivePromptPlan(ctx: ResetContext) {
  await archiveIfExists(ctx, path.join(ctx.root, 'prompt_plan.json'), 'prompt_plan.json');
  await archiveIfExists(
    ctx,
    path.join(ctx.internal, 'drafts', 'prompt_plan.json'),
    'drafts/prompt_plan.json',
  );
  await archiveIfExists(
    ctx,
    path.join(ctx.internal, 'grok-responses', 'prompt-plan'),
    'grok-responses/prompt-plan',
  );
  await archiveIfExists(
    ctx,
    path.join(ctx.internal, 'grok-responses', 'prompt-plan-fix'),
    'grok-responses/prompt-plan-fix',
  );
}
async function archiveWorkflow(ctx: ResetContext) {
  const metaPath = path.join(ctx.root, 'project_meta.json'),
    meta = await readJson<any>(metaPath);
  const tracked =
    typeof meta?.workflowBuild?.outputPath === 'string' ? meta.workflowBuild.outputPath : '';
  if (tracked && path.basename(tracked) === tracked)
    await archiveIfExists(ctx, path.join(ctx.root, tracked), `workflow/${tracked}`);
  for (const name of await readdir(ctx.root).catch(() => [])) {
    if (/^LoRA_.+\.json$/i.test(name))
      await archiveIfExists(ctx, path.join(ctx.root, name), `workflow/${name}`);
  }
  if (meta && Object.prototype.hasOwnProperty.call(meta, 'workflowBuild')) {
    await updateProjectMeta(ctx.root, (latest) => {
      // A concurrent workflow compile may have written a newer build.
      if (JSON.stringify(latest.workflowBuild) === JSON.stringify(meta.workflowBuild))
        delete latest.workflowBuild;
      return latest;
    });
    await projectTransactionCheckpoint('workflowBuild:cleared');
  }
}
async function archiveModelState(
  ctx: ResetContext,
  {
    initialHistory = true,
    fixHistory = true,
    fallbacks = true,
  }: { initialHistory?: boolean; fixHistory?: boolean; fallbacks?: boolean } = {},
) {
  await archiveIfExists(ctx, path.join(ctx.root, 'models.json'), 'models.json');
  await archiveIfExists(
    ctx,
    path.join(ctx.internal, 'drafts', 'models.json'),
    'drafts/models.json',
  );
  await archiveIfExists(
    ctx,
    path.join(ctx.internal, 'draft-sources', 'models.json'),
    'draft-sources/models.json',
  );
  if (fallbacks)
    await archiveIfExists(
      ctx,
      path.join(ctx.internal, 'model_prompt_fallbacks.json'),
      'model_prompt_fallbacks.json',
    );
  if (initialHistory)
    await archiveIfExists(
      ctx,
      path.join(ctx.internal, 'grok-responses', 'models'),
      'grok-responses/models',
    );
  if (fixHistory)
    await archiveIfExists(
      ctx,
      path.join(ctx.internal, 'grok-responses', 'models-fix'),
      'grok-responses/models-fix',
    );
}
async function archiveStory(ctx: ResetContext) {
  await archiveIfExists(ctx, path.join(ctx.root, 'story.md'), 'story.md');
  await archiveIfExists(ctx, path.join(ctx.internal, 'drafts', 'story.md'), 'drafts/story.md');
  await archiveIfExists(
    ctx,
    path.join(ctx.internal, 'grok-responses', 'story-finalize'),
    'grok-responses/story-finalize',
  );
  await archiveIfExists(
    ctx,
    path.join(ctx.internal, 'grok-responses', 'story-fix'),
    'grok-responses/story-fix',
  );
}
function jsonCandidate(raw: string) {
  const fenced = raw.match(/```json\s*\n([\s\S]*?)```/i)?.[1]?.trim();
  if (fenced) return fenced;
  const a = raw.indexOf('{'),
    b = raw.lastIndexOf('}');
  return a >= 0 && b > a ? raw.slice(a, b + 1) : raw.trim();
}
async function latestInitialPayload(root: string) {
  const dir = path.join(root, '._batch_studio', 'grok-responses', 'models');
  if (!(await exists(dir))) return null;
  const names = (await readdir(dir))
    .filter((x) => x.endsWith('.txt'))
    .sort()
    .reverse();
  for (const name of names) {
    try {
      const parsed = JSON.parse(jsonCandidate(await readFile(path.join(dir, name), 'utf8')));
      if (parsed?.schemaVersion === 1 && Array.isArray(parsed.loras)) return parsed;
    } catch {}
  }
  return null;
}
async function resetPromptAndWorkflow(ctx: ResetContext) {
  await archivePromptPlan(ctx);
  await archiveWorkflow(ctx);
}

export async function resetModelDownstream(
  root: string,
  options: { clearModelFixHistory?: boolean } = {},
) {
  return withProjectTransaction(root, 'reset-model-downstream', () =>
    resetModelDownstreamUnlocked(root, options),
  );
}
async function resetModelDownstreamUnlocked(
  root: string,
  { clearModelFixHistory = true }: { clearModelFixHistory?: boolean },
) {
  const ctx = context(root);
  await archivePromptPlan(ctx);
  if (clearModelFixHistory)
    await archiveIfExists(
      ctx,
      path.join(ctx.internal, 'grok-responses', 'models-fix'),
      'grok-responses/models-fix',
    );
  await archiveWorkflow(ctx);
  return { archiveRoot: ctx.archiveRoot, clearModelFixHistory };
}

export async function manualResetFrom(root: string, scope: ManualResetScope) {
  return withProjectTransaction(root, 'manual-reset:' + scope, () =>
    manualResetUnlocked(root, scope),
  );
}
async function manualResetUnlocked(root: string, scope: ManualResetScope) {
  const ctx = context(root);
  if (scope === 'workflow') {
    await archiveWorkflow(ctx);
    return { archiveRoot: ctx.archiveRoot, scope };
  }
  if (scope === 'prompt-plan') {
    await resetPromptAndWorkflow(ctx);
    return { archiveRoot: ctx.archiveRoot, scope };
  }
  if (scope === 'models-fix') {
    const current =
      (await readJson<ModelsArtifact>(path.join(ctx.internal, 'drafts', 'models.json'))) ??
      (await readJson<ModelsArtifact>(path.join(ctx.root, 'models.json')));
    if (!current) throw new Error('models.jsonがないためLoRA再選定をリセットできません。');
    const initial = await latestInitialPayload(root);
    if (!initial) throw new Error('初回のGrok LoRA選定履歴がないため再選定前へ戻せません。');
    await archiveModelState(ctx, { initialHistory: false, fixHistory: true, fallbacks: true });
    const restoration = restoreModelSelection(current, initial, 'models-fix', false),
      restored = restoration.models;
    await writeJsonAtomic(path.join(ctx.root, 'models.json'), restored);
    await projectTransactionCheckpoint('models:restored');
    const initialFallbacks = restoration.fallbacks;
    if (initialFallbacks.length)
      await writeJsonAtomic(path.join(ctx.internal, 'model_prompt_fallbacks.json'), {
        schemaVersion: 2,
        promptFallbacks: initialFallbacks,
      });
    await resetPromptAndWorkflow(ctx);
    return { archiveRoot: ctx.archiveRoot, scope };
  }
  if (scope === 'models') {
    const current =
      (await readJson<ModelsArtifact>(path.join(ctx.internal, 'drafts', 'models.json'))) ??
      (await readJson<ModelsArtifact>(path.join(ctx.root, 'models.json')));
    if (!current) throw new Error('基盤モデルが未保存のためLoRA選定をリセットできません。');
    const base = cleanBase(current);
    await archiveModelState(ctx, { initialHistory: true, fixHistory: true, fallbacks: true });
    await writeJsonAtomic(path.join(ctx.root, 'models.json'), base);
    await projectTransactionCheckpoint('models:base-restored');
    await resetPromptAndWorkflow(ctx);
    return { archiveRoot: ctx.archiveRoot, scope };
  }
  if (scope === 'base-models') {
    await archiveModelState(ctx);
    await resetPromptAndWorkflow(ctx);
    return { archiveRoot: ctx.archiveRoot, scope };
  }
  if (scope === 'story') {
    await archiveStory(ctx);
    await archiveModelState(ctx);
    await resetPromptAndWorkflow(ctx);
    return { archiveRoot: ctx.archiveRoot, scope };
  }
  throw new Error('Unsupported reset scope.');
}
