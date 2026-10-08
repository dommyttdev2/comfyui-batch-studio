import { resetProjectFrom } from './manual-project-reset.js';
import type { ModelsArtifact, ProjectMeta } from '../domain/artifact-types.js';
export type ManualResetScope =
  | 'story'
  | 'base-models'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'workflow';
export interface ModelDownstreamFilePorts {
  path: {
    join(...parts: string[]): string;
    dirname(file: string): string;
    basename(file: string): string;
  };
  mkdir(directory: string): Promise<void>;
  readdir(directory: string): Promise<string[]>;
  readFile(file: string): Promise<string>;
  rename(source: string, destination: string): Promise<void>;
  exists(file: string): Promise<boolean>;
  readJson<T>(file: string): Promise<T | null>;
  writeJsonAtomic(file: string, value: unknown): Promise<void>;
  updateProjectMeta(root: string, update: (meta: ProjectMeta) => ProjectMeta): Promise<ProjectMeta>;
  projectTransactionCheckpoint(step: string): Promise<void>;
  withProjectTransaction<T>(root: string, operation: string, action: () => Promise<T>): Promise<T>;
  now(): string;
  nextId(): string;
}
export function createModelDownstreamFileService(io: ModelDownstreamFilePorts) {
  const {
    path,
    mkdir,
    readdir,
    readFile,
    rename,
    exists,
    readJson,
    writeJsonAtomic,
    updateProjectMeta,
    projectTransactionCheckpoint,
    withProjectTransaction,
  } = io;
  type ResetContext = { root: string; internal: string; archiveRoot: string };

  function context(root: string): ResetContext {
    const internal = path.join(root, '._batch_studio');
    const stamp = io.now().replace(/[:.]/g, '-');
    return {
      root,
      internal,
      archiveRoot: path.join(
        internal,
        'history',
        'downstream-reset',
        `${stamp}-${io.nextId().slice(0, 8)}`,
      ),
    };
  }
  async function archiveIfExists(ctx: ResetContext, source: string, relative: string) {
    if (!(await exists(source))) return false;
    const destination = path.join(ctx.archiveRoot, relative);
    await mkdir(path.dirname(destination));
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
        const parsed = JSON.parse(jsonCandidate(await readFile(path.join(dir, name))));
        if (parsed?.schemaVersion === 1 && Array.isArray(parsed.loras)) return parsed;
      } catch {}
    }
    return null;
  }
  async function resetPromptAndWorkflow(ctx: ResetContext) {
    await archivePromptPlan(ctx);
    await archiveWorkflow(ctx);
  }

  async function resetModelDownstream(
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

  async function manualResetFrom(root: string, scope: ManualResetScope) {
    return withProjectTransaction(root, 'manual-reset:' + scope, () =>
      manualResetUnlocked(root, scope),
    );
  }
  async function manualResetUnlocked(root: string, scope: ManualResetScope) {
    const ctx = context(root);
    await resetProjectFrom(
      {
        modelsFacts: async () => ({
          draft: await readJson<ModelsArtifact>(path.join(ctx.internal, 'drafts', 'models.json')),
          confirmed: await readJson<ModelsArtifact>(path.join(root, 'models.json')),
        }),
        initialSelection: () => latestInitialPayload(root),
        archiveModels: (options) => archiveModelState(ctx, options),
        archiveStory: () => archiveStory(ctx),
        archiveWorkflow: () => archiveWorkflow(ctx),
        resetPromptAndWorkflow: () => resetPromptAndWorkflow(ctx),
        writeModels: (models) => writeJsonAtomic(path.join(root, 'models.json'), models),
        writeFallbacks: (promptFallbacks) =>
          writeJsonAtomic(path.join(ctx.internal, 'model_prompt_fallbacks.json'), {
            schemaVersion: 2,
            promptFallbacks,
          }),
        checkpoint: projectTransactionCheckpoint,
      },
      scope,
    );
    return { archiveRoot: ctx.archiveRoot, scope };
  }

  return { resetModelDownstream, manualResetFrom };
}
