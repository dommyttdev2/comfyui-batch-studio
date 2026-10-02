import { createHash, randomInt, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionError, ExecutionRun } from '../shared/types.js';
import {
  clearCurrentGenerationTiming,
  markGenerationCompleted,
  markGenerationStarted,
} from '../shared/execution-progress.js';
import { readJson } from './fs-utils.js';
import type { ApiGraph, ApiGraphNode } from './workflow-api.js';
import { ComfyUiClient } from './comfyui-client.js';
import { enumerateImageTasks, graphToWorkflow } from './image-tasks.js';
import {
  getExecutionRun,
  readExecutionWorkflow,
  mutateExecutionRun,
  recordExecutionEvidence,
  validatedExecutionEvidence,
} from './execution-run.js';

type LocalExecutionSettings = { endpoint: string; installPath: string };
type SettingsProvider = () => Promise<LocalExecutionSettings>;
type BranchBinding = { branchId: string; leafIds: string[]; expandNodeId: string };
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const LOCAL_FILE_SCOPE = 'local-generated-file';
const LOCAL_OUTPUT_COLLECTION_FAILED = 'LOCAL_OUTPUT_COLLECTION_FAILED';

class LocalOutputCollectionError extends Error {
  constructor(cause: unknown) {
    super(
      `ComfyUIの生成完了をHistoryで確認しましたが、画像の回収に失敗しました。新しいPromptは送信しません: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'LocalOutputCollectionError';
  }
}

function localRunOutputRelative(run: ExecutionRun) {
  if (!/^[A-Za-z0-9_-]+$/.test(run.projectId) || !/^[0-9a-f-]{36}$/i.test(run.runId))
    throw new Error('Invalid project or Run ID for isolated Local output.');
  return path.posix.join('BatchStudio', run.projectId, run.runId);
}
function localRunOutputRoot(installPath: string, run: ExecutionRun) {
  return path.join(installPath, 'output', ...localRunOutputRelative(run).split('/'));
}
function within(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}
async function sha256File(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function isolateBranchSavePaths(graph: ApiGraph, run: ExecutionRun, branchId: string) {
  const saveNodes = Object.entries(graph).filter(([, node]) => node.class_type === 'SaveImage');
  if (!saveNodes.length) throw new Error(`Branch ${branchId} has no SaveImage output.`);
  // Alter only the submitted API graph. The Compiler snapshot and the user's
  // legacy output folders remain untouched.
  for (const [, node] of saveNodes)
    node.inputs.filename_prefix = path.posix.join(
      localRunOutputRelative(run),
      encodeURIComponent(branchId),
      encodeURIComponent(node._meta!.batchStudio!.leafId),
    );
  return saveNodes.map(([id]) => id);
}
async function recordPromptOutputs(
  root: string,
  run: ExecutionRun,
  installPath: string,
  promptId: string,
  history: any,
  saveNodeIds: string[],
  comfy: ComfyUiClient,
) {
  const outputBase = path.join(installPath, 'output'),
    runRoot = localRunOutputRoot(installPath, run),
    entry = history?.[promptId],
    recorded = new Set<string>();
  const images = saveNodeIds.flatMap((id) => entry?.outputs?.[id]?.images ?? []);
  if (!images.length) throw new Error(`ComfyUI prompt ${promptId} returned no SaveImage files.`);
  for (const image of images) {
    if (
      image?.type !== 'output' ||
      typeof image.filename !== 'string' ||
      path.basename(image.filename) !== image.filename ||
      typeof image.subfolder !== 'string' ||
      !IMAGE_EXTENSIONS.has(path.extname(image.filename).toLowerCase())
    )
      throw new Error(`ComfyUI prompt ${promptId} returned an invalid image reference.`);
    const file = path.resolve(outputBase, image.subfolder, image.filename);
    if (!within(runRoot, file))
      throw new Error(`ComfyUI prompt ${promptId} reported an image outside its Run output.`);

    // ComfyUI Desktop and --output-directory can save outside
    // <installPath>/output. A validated History reference can be fetched from
    // /view and mirrored into Batch Studio's isolated, locally verified output.
    let actualFile: string;
    try {
      actualFile = await realpath(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const imageBytes = await comfy.outputImage(image.filename, image.subfolder);
      await mkdir(path.dirname(file), { recursive: true });
      const actualRoot = await realpath(runRoot),
        actualOutputBase = await realpath(outputBase),
        actualParent = await realpath(path.dirname(file));
      if (
        !within(actualOutputBase, actualRoot) ||
        (actualParent !== actualRoot && !within(actualRoot, actualParent))
      )
        throw new Error('Generated image destination contains a symlink outside its Run output.');
      try {
        await writeFile(file, imageBytes, { flag: 'wx' });
      } catch (writeError) {
        if ((writeError as NodeJS.ErrnoException).code !== 'EEXIST') throw writeError;
      }
      actualFile = await realpath(file);
    }
    const actualRoot = await realpath(runRoot);
    if (!within(actualRoot, actualFile))
      throw new Error(`ComfyUI prompt ${promptId} reported a symlink outside its Run output.`);
    const relativePath = path.relative(runRoot, file);
    if (recorded.has(relativePath)) continue;
    recorded.add(relativePath);
    const metadata = await stat(actualFile);
    if (!metadata.isFile() || metadata.size < 1)
      throw new Error(`Generated image is missing or empty: ${relativePath}.`);
    await recordExecutionEvidence(root, run.runId, {
      kind: 'CUSTOM',
      scope: LOCAL_FILE_SCOPE,
      data: {
        promptId,
        branchId: run.current.branchId,
        leafId: run.current.leafId,
        relativePath,
        size: metadata.size,
        sha256: await sha256File(actualFile),
      },
    });
  }
  return recorded.size;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function clone<T>(value: T): T {
  return structuredClone(value);
}
function linkId(value: unknown) {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string'
    ? value[0]
    : null;
}
function ancestors(graph: ApiGraph, nodeId: string) {
  const seen = new Set<string>(),
    pending = [nodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id) || !graph[id]) continue;
    seen.add(id);
    for (const value of Object.values(graph[id].inputs ?? {})) {
      const linked = linkId(value);
      if (linked) pending.push(linked);
    }
  }
  return seen;
}
function descendants(graph: ApiGraph, nodeId: string) {
  const targets = new Map<string, string[]>();
  for (const [id, node] of Object.entries(graph))
    for (const value of Object.values(node.inputs ?? {})) {
      const linked = linkId(value);
      if (linked) targets.set(linked, [...(targets.get(linked) ?? []), id]);
    }
  const seen = new Set<string>(),
    pending = [nodeId];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id) || !graph[id]) continue;
    seen.add(id);
    pending.push(...(targets.get(id) ?? []));
  }
  return seen;
}
function errorOf(
  run: ExecutionRun,
  code: string,
  error: unknown,
  retryable = true,
): ExecutionError {
  return {
    code,
    message: error instanceof Error ? error.message : String(error),
    phase: run.phase,
    at: new Date().toISOString(),
    retryable,
  };
}
async function failRun(root: string, runId: string, code: string, error: unknown) {
  return mutateExecutionRun(root, runId, (run) => {
    const outputCollectionFailed = error instanceof LocalOutputCollectionError;
    const uncertain =
      !outputCollectionFailed &&
      (run.submission?.status === 'sending' || run.submission?.status === 'acknowledged');
    const next = errorOf(
      run,
      uncertain
        ? 'EXECUTION_RECOVERY_UNCERTAIN'
        : outputCollectionFailed
          ? LOCAL_OUTPUT_COLLECTION_FAILED
          : code,
      uncertain
        ? `Existing ComfyUI submission may have been accepted. No further POST is allowed until the exact attempt is reconciled: ${error instanceof Error ? error.message : String(error)}`
        : error,
      !uncertain && !outputCollectionFailed,
    );
    run.error = next;
    run.errorHistory.push(next);
    run.lifecycle = 'FAILED';
    run.controls.scheduling = 'STOPPED';
    if (!uncertain && !outputCollectionFailed) {
      run.current.promptId = null;
      clearCurrentGenerationTiming(run);
    }
  });
}
async function pauseForStop(root: string, runId: string) {
  return mutateExecutionRun(root, runId, (run) => {
    run.lifecycle = 'PAUSED';
    run.controls.scheduling = 'STOPPED';
    run.current.promptId = null;
    clearCurrentGenerationTiming(run);
  });
}
async function markInterrupted(root: string, runId: string) {
  return mutateExecutionRun(root, runId, (run) => {
    run.lifecycle = 'INTERRUPTED';
    run.controls.scheduling = 'STOPPED';
    run.controls.interrupt = 'INTERRUPTED';
    run.current.promptId = null;
    clearCurrentGenerationTiming(run);
  });
}
export async function verifyLocalOutputs(installPath: string, run: ExecutionRun) {
  if (!installPath)
    throw new Error('Local ComfyUI install path is required to verify generated outputs.');
  const outputRoot = localRunOutputRoot(installPath, run);
  const evidence = validatedExecutionEvidence(run).valid.filter(
    (item) => item.kind === 'CUSTOM' && item.scope === LOCAL_FILE_SCOPE,
  );
  const unique = new Map<string, (typeof evidence)[number]>();
  for (const item of evidence) {
    const relativePath = item.data.relativePath;
    if (typeof relativePath !== 'string' || !relativePath) continue;
    unique.set(relativePath, item);
  }
  if (unique.size < run.progress.overall.total)
    throw new Error(
      `Generated output verification failed: expected ${run.progress.overall.total} Run-owned images, found ${unique.size} verified prompt output references.`,
    );
  const realRoot = await realpath(outputRoot);
  for (const [relativePath, item] of unique) {
    const file = path.resolve(outputRoot, relativePath);
    if (!within(outputRoot, file))
      throw new Error('Local output evidence contains an invalid file path.');
    const realFile = await realpath(file);
    if (!within(realRoot, realFile))
      throw new Error('Local output evidence points outside its Run output.');
    const metadata = await stat(realFile);
    if (
      !metadata.isFile() ||
      metadata.size < 1 ||
      metadata.size !== Number(item.data.size) ||
      (await sha256File(realFile)) !== item.data.sha256
    )
      throw new Error(
        `Generated output verification failed: missing or modified image ${relativePath}.`,
      );
  }
  return { outputRoot, count: unique.size };
}

export class LocalExecutionService {
  private readonly workers = new Map<string, Promise<void>>();
  constructor(
    private readonly settingsProvider: SettingsProvider,
    private readonly clientFactory = (endpoint: string) => ({
      comfy: new ComfyUiClient(endpoint),
    }),
  ) {}
  start(root: string, runId: string): Promise<void> {
    const existing = this.workers.get(runId);
    if (existing) return existing;
    const worker = this.execute(root, runId)
      .catch((error) => failRun(root, runId, 'LOCAL_EXECUTION_FAILED', error).then(() => undefined))
      .finally(() => this.workers.delete(runId));
    this.workers.set(runId, worker);
    return worker;
  }
  // Recovery never calls /prompt. It observes the exact persisted prompt and
  // commits its already generated outputs before allowing a normal Resume.
  recover(root: string, runId: string): Promise<void> {
    const existing = this.workers.get(runId);
    if (existing) return existing;
    const worker = this.recoverPrompt(root, runId)
      .catch(async (error) => {
        await mutateExecutionRun(root, runId, (run) => {
          if (run.lifecycle !== 'RUNNING') return;
          const outputCollectionFailed = error instanceof LocalOutputCollectionError;
          const failure = errorOf(
            run,
            outputCollectionFailed
              ? LOCAL_OUTPUT_COLLECTION_FAILED
              : 'EXECUTION_RECOVERY_UNCERTAIN',
            `既存Promptの状態を確認できません。重複生成を防ぐため自動Resumeを禁止しました。ComfyUI Queue/Historyと保存済み画像を確認してください: ${error instanceof Error ? error.message : String(error)}`,
            false,
          );
          run.error = failure;
          run.errorHistory.push(failure);
          run.lifecycle = 'FAILED';
          run.controls.scheduling = 'STOPPED';
          // A current Prompt ID is evidence: do not erase it on probe failure.
        });
      })
      .finally(() => this.workers.delete(runId));
    this.workers.set(runId, worker);
    return worker;
  }
  private async recoverPrompt(root: string, runId: string) {
    let run = await getExecutionRun(root, runId);
    if (!run || run.lifecycle !== 'RUNNING' || run.executionTarget !== 'local') return;
    const settings = await this.settingsProvider(),
      { comfy } = this.clientFactory(settings.endpoint);
    await comfy.health();
    let promptId = run.current.promptId;
    if (!promptId && run.submission?.status === 'sending') {
      const recoveredId = await comfy.findPromptBySubmissionId(run.submission.attemptId);
      if (!recoveredId)
        throw new Error(
          'Submission was attempted but no matching ID is visible in Queue/History. The accepted prompt may have been pruned; no POST was retried.',
        );
      run = await mutateExecutionRun(root, runId, (current) => {
        if (
          current.lifecycle !== 'RUNNING' ||
          current.submission?.attemptId !== run!.submission?.attemptId ||
          current.current.promptId
        )
          throw new Error('Run identity changed while resolving a submitted prompt.');
        current.current.promptId = recoveredId;
        if (!current.submission) throw new Error('Submission intent vanished during recovery.');
        current.submission.status = 'acknowledged';
        current.submission.promptId = recoveredId;
        if (!current.promptIds.includes(recoveredId)) current.promptIds.push(recoveredId);
        markGenerationStarted(current, recoveredId);
      });
      promptId = recoveredId;
    }
    if (!promptId || !run.current.branchId || !run.current.leafId)
      throw new Error(
        'No persisted prompt ID/branch/leaf; submission may have succeeded before the Run was saved.',
      );
    let history: any = null;
    let missingPolls = 0;
    for (;;) {
      history = await comfy.history(promptId);
      const state = comfy.historyState(history, promptId);
      if (state === 'success') break;
      if (state === 'error') {
        await mutateExecutionRun(root, runId, (current) => {
          if (current.lifecycle !== 'RUNNING') return;
          const failure = errorOf(
            current,
            'LOCAL_RECOVERED_PROMPT_FAILED',
            `ComfyUI history confirms prompt ${promptId} failed.`,
          );
          current.error = failure;
          current.errorHistory.push(failure);
          current.lifecycle = 'FAILED';
          current.controls.scheduling = 'STOPPED';
        });
        return;
      }
      if (await comfy.isPromptQueued(promptId)) missingPolls = 0;
      else if (++missingPolls >= 4)
        throw new Error(`Prompt ${promptId} is absent from ComfyUI Queue and History.`);
      await sleep(750);
    }
    const { api: graph } = await readExecutionWorkflow(root, run);
    const task = enumerateImageTasks(graph, run).find(
      (item) => item.branchId === run.current.branchId && item.leafId === run.current.leafId,
    );
    const progress = run.progress.branches.find((item) => item.branchId === run.current.branchId);
    const branchPlan = run.snapshot.plan.branches.find(
      (item) => item.branchId === run.current.branchId,
    );
    if (!task || !progress || branchPlan?.leafIds[progress.completed] !== run.current.leafId)
      throw new Error('Persisted branch/leaf does not match progress.');
    const binding = task;
    const saveNodeIds = isolateBranchSavePaths(task.graph, run, task.branchId);
    try {
      await recordPromptOutputs(
        root,
        run,
        settings.installPath,
        promptId,
        history,
        saveNodeIds,
        comfy,
      );
    } catch (error) {
      throw new LocalOutputCollectionError(error);
    }
    await mutateExecutionRun(root, runId, (current) => {
      if (current.lifecycle !== 'RUNNING' || current.current.promptId !== promptId)
        throw new Error('Run state changed while recovering the persisted prompt.');
      const branch = current.progress.branches.find((item) => item.branchId === binding.branchId);
      if (!branch || branch.completed !== progress.completed)
        throw new Error(
          'Branch progress changed during recovery; refusing to count the prompt twice.',
        );
      branch.completed++;
      current.progress.overall.completed++;
      branch.state = branch.completed >= branch.total ? 'completed' : 'pending';
      markGenerationCompleted(current);
      current.current = { branchId: null, leafId: null, promptId: null };
      if (current.submission?.promptId === promptId) current.submission.status = 'completed';
      current.lifecycle = 'PAUSED';
      current.controls.scheduling = 'STOPPED';
    });
  }
  async waitForSettled(runId: string) {
    const task = this.workers.get(runId);
    if (task) await task.catch(() => {});
  }
  async forceInterrupt(root: string, runId: string) {
    const run = await getExecutionRun(root, runId);
    if (!run || run.executionTarget !== 'local' || !run.current.promptId) return false;
    const settings = await this.settingsProvider(),
      { comfy } = this.clientFactory(settings.endpoint);
    if (!(await comfy.isPromptRunning(run.current.promptId))) return false;
    await comfy.interrupt();
    await mutateExecutionRun(root, runId, (current) => {
      current.controls.interrupt = 'INTERRUPTED';
    });
    return true;
  }
  private async execute(root: string, runId: string) {
    let run = await getExecutionRun(root, runId);
    if (!run || run.executionTarget !== 'local' || run.lifecycle !== 'RUNNING') return;
    const settings = await this.settingsProvider(),
      { comfy } = this.clientFactory(settings.endpoint);
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'LOCAL_COMFYUI_CONNECTING';
    });
    await comfy.health();
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'LOCAL_CAPABILITY_CHECKING';
    });
    const { api: graph, ui: workflow } = await readExecutionWorkflow(root, run);
    const info = await comfy.objectInfo(),
      required = new Set(Object.values(graph).map((node) => node.class_type));
    const missing = [...required].filter((name) => !info?.[name]);
    if (missing.length)
      throw new Error(`Local ComfyUI is missing required node types: ${missing.join(', ')}`);
    const tasks = enumerateImageTasks(graph, run);
    const branches = run.snapshot.plan.branches.map((branch) => ({
      ...branch,
      tasks: tasks.filter((task) => task.branchId === branch.branchId),
    }));
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'WORKFLOW_PREPARING';
    });
    for (const binding of branches) {
      run = await getExecutionRun(root, runId);
      if (!run || run.lifecycle !== 'RUNNING') return;
      const branchProgress = run.progress.branches.find(
        (item) => item.branchId === binding.branchId,
      );
      if (!branchProgress) throw new Error(`Missing progress state for ${binding.branchId}.`);
      if (branchProgress.completed >= branchProgress.total) continue;
      if (run.controls.scheduling !== 'ACTIVE') {
        await pauseForStop(root, runId);
        return;
      }
      let lastPromptId = '';
      {
        for (let index = branchProgress.completed; index < binding.leafIds.length; index++) {
          run = await getExecutionRun(root, runId);
          if (!run || run.lifecycle !== 'RUNNING') return;
          if (run.controls.scheduling !== 'ACTIVE') {
            await pauseForStop(root, runId);
            return;
          }
          const task = binding.tasks[index],
            branchGraph = task.graph;
          const saveNodeIds = isolateBranchSavePaths(branchGraph, run, binding.branchId);
          const attemptId = randomUUID(),
            graphSha256 = createHash('sha256').update(JSON.stringify(branchGraph)).digest('hex');
          await mutateExecutionRun(root, runId, (r) => {
            r.phase = 'EXECUTING';
            r.current = {
              branchId: binding.branchId,
              leafId: binding.leafIds[index],
              promptId: null,
            };
            r.submission = {
              attemptId,
              branchId: binding.branchId,
              leafId: binding.leafIds[index],
              index,
              graphSha256,
              status: 'prepared',
              promptId: null,
            };
            const bp = r.progress.branches.find((x) => x.branchId === binding.branchId);
            if (bp) bp.state = 'running';
          });
          // The durable sending transition precedes every POST. If the call
          // succeeds but its response/persistence fails, recovery finds this
          // exact attempt or stops rather than resubmitting the leaf.
          await mutateExecutionRun(root, runId, (r) => {
            if (r.submission?.attemptId !== attemptId)
              throw new Error('Prompt submission attempt was replaced before POST.');
            r.submission.status = 'sending';
          });
          const submitted = await comfy.prompt(branchGraph, run.runId, attemptId, {
            workflow: graphToWorkflow(branchGraph),
            batch_studio: {
              contract: 1,
              runId: run.runId,
              branchId: task.branchId,
              leafId: task.leafId,
            },
          });
          lastPromptId = submitted.prompt_id;
          await mutateExecutionRun(root, runId, (r) => {
            if (r.submission?.attemptId !== attemptId)
              throw new Error('Prompt submission attempt was replaced after POST.');
            r.current.promptId = lastPromptId;
            r.submission.status = 'acknowledged';
            r.submission.promptId = lastPromptId;
            if (!r.promptIds.includes(lastPromptId)) r.promptIds.push(lastPromptId);
            markGenerationStarted(r, lastPromptId);
          });
          let terminal: 'success' | 'error' = 'error',
            terminalHistory: any = null,
            missingPolls = 0,
            apiErrors = 0;
          for (;;) {
            try {
              const history = await comfy.history(lastPromptId),
                state = comfy.historyState(history, lastPromptId);
              if (state !== 'pending') {
                terminal = state;
                terminalHistory = history;
                break;
              }
              // A prompt briefly leaves the queue before history becomes visible.
              // Only consider it lost after repeated successful API responses.
              if (await comfy.isPromptQueued(lastPromptId)) missingPolls = 0;
              else if (++missingPolls >= 4) {
                const latestHistory = await comfy.history(lastPromptId);
                if (comfy.historyState(latestHistory, lastPromptId) === 'pending') {
                  const latestRun = await getExecutionRun(root, runId);
                  if (latestRun?.controls.interrupt !== 'IDLE') {
                    await markInterrupted(root, runId);
                    return;
                  }
                  throw new Error(
                    `COMFYUI_PROMPT_LOST: Prompt ${lastPromptId} is absent from both ComfyUI Queue and History. Verify the Run before retrying to avoid duplicate generation.`,
                  );
                }
                missingPolls = 0;
              }
              apiErrors = 0;
            } catch (error) {
              if (error instanceof Error && error.message.startsWith('COMFYUI_PROMPT_LOST:'))
                throw error;
              if (++apiErrors >= 3)
                throw new Error(
                  `COMFYUI_PROMPT_STATUS_UNAVAILABLE: Could not check ComfyUI Queue/History for ${lastPromptId}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            await sleep(750);
          }
          run = await getExecutionRun(root, runId);
          if (!run) return;
          if (terminal === 'error') {
            if (run.controls.interrupt !== 'IDLE') {
              await markInterrupted(root, runId);
              return;
            }
            throw new Error(`ComfyUI prompt ${lastPromptId} failed.`);
          }
          try {
            await recordPromptOutputs(
              root,
              run,
              settings.installPath,
              lastPromptId,
              terminalHistory,
              saveNodeIds,
              comfy,
            );
          } catch (error) {
            throw new LocalOutputCollectionError(error);
          }
          await mutateExecutionRun(root, runId, (r) => {
            const bp = r.progress.branches.find((x) => x.branchId === binding.branchId);
            if (bp) bp.completed = Math.min(bp.total, bp.completed + 1);
            r.progress.overall.completed = Math.min(
              r.progress.overall.total,
              r.progress.overall.completed + 1,
            );
            markGenerationCompleted(r);
            if (r.submission?.promptId === lastPromptId) r.submission.status = 'completed';
            r.current.promptId = null;
          });
          run = await getExecutionRun(root, runId);
          if (!run) return;
          if (run.controls.interrupt !== 'IDLE') {
            await markInterrupted(root, runId);
            return;
          }
          if (run.controls.scheduling !== 'ACTIVE') {
            await pauseForStop(root, runId);
            return;
          }
        }
        await mutateExecutionRun(root, runId, (r) => {
          const bp = r.progress.branches.find((x) => x.branchId === binding.branchId);
          if (bp) bp.state = 'completed';
          r.current = { branchId: null, leafId: null, promptId: null };
        });
      }
    }
    run = await getExecutionRun(root, runId);
    if (!run || run.lifecycle !== 'RUNNING') return;
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'EXECUTION_COMPLETED';
    });
    await recordExecutionEvidence(root, runId, {
      kind: 'EXECUTION_COMPLETED',
      scope: 'local-generation',
      data: { images: run.progress.overall.completed },
    });
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'LOCAL_OUTPUT_VERIFYING';
    });
    run = await getExecutionRun(root, runId);
    if (!run) return;
    const verified = await verifyLocalOutputs(settings.installPath, run);
    await recordExecutionEvidence(root, runId, {
      kind: 'LOCAL_FILE_VERIFIED',
      scope: 'local-output',
      data: { count: verified.count },
    });
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'COMPLETED';
      r.lifecycle = 'COMPLETED';
      r.completedAt = new Date().toISOString();
      r.current = { branchId: null, leafId: null, promptId: null };
    });
  }
}
