import type {
  ExecutionError,
  ExecutionEvidenceKind,
  ExecutionRun,
} from '../domain/artifact-types.js';
import {
  clearCurrentGenerationTiming,
  markGenerationCompleted,
  markGenerationStarted,
} from '../domain/execution-progress.js';
import { enumerateImageTasks, graphToWorkflow } from '../domain/image-tasks.js';
import {
  isolateBranchSavePaths,
  LOCAL_FILE_SCOPE,
  promptOutputReferences,
} from '../domain/local-output-policy.js';
import type { ApiGraph } from '../domain/workflow-graph.js';
import { verifyGeneratedLocalOutputs } from './local-output-verification.js';
export const LOCAL_OUTPUT_COLLECTION_FAILED = 'LOCAL_OUTPUT_COLLECTION_FAILED';
export type SettingsProvider = () => Promise<{ endpoint: string; installPath: string }>;
export interface LocalComfyPort {
  health(): Promise<unknown>;
  objectInfo(): Promise<Record<string, unknown>>;
  history(id: string): Promise<unknown>;
  historyState(history: unknown, id: string): 'pending' | 'success' | 'error';
  findPromptBySubmissionId(id: string): Promise<string | null>;
  isPromptQueued(id: string): Promise<boolean>;
  isPromptRunning(id: string): Promise<boolean>;
  interrupt(): Promise<unknown>;
  prompt(
    graph: ApiGraph,
    clientId: string,
    submissionId: string,
    extra: Record<string, unknown>,
  ): Promise<{ prompt_id: string }>;
}
export interface LocalRuntimeIO {
  load(projectId: string, runId: string): Promise<ExecutionRun | null>;
  mutate(
    projectId: string,
    runId: string,
    update: (run: ExecutionRun) => void,
  ): Promise<ExecutionRun>;
  workflow(projectId: string, run: ExecutionRun): Promise<{ api: ApiGraph }>;

  materializeOutput(
    run: ExecutionRun,
    installId: string,
    promptId: string,
    image: { filename: string; subfolder: string },
    comfy: LocalComfyPort,
  ): Promise<{ relativePath: string; isFile: boolean; size: number; sha256: string }>;
  observeOutput(
    installId: string,
    run: ExecutionRun,
    relativePath: string,
  ): Promise<{ isFile: boolean; size: number; sha256: string }>;
  hashValue(value: unknown): string;
  evidence(
    projectId: string,
    runId: string,
    input: {
      kind: ExecutionEvidenceKind;
      scope: string;
      data?: Record<string, string | number | boolean | null>;
    },
  ): Promise<unknown>;
  now(): { ticks: number; iso: string };
  sleep(ms: number): Promise<void>;
  nextId(): string;
  hash(value: string): string;
}
export class LocalOutputCollectionError extends Error {
  constructor(cause: unknown) {
    super(
      `ComfyUIの生成完了をHistoryで確認しましたが、画像の回収に失敗しました。新しいPromptは送信しません: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'LocalOutputCollectionError';
  }
}

export interface LocalExecutionRuntime {
  start(projectId: string, runId: string): Promise<void>;
  recover(projectId: string, runId: string): Promise<void>;
  waitForSettled(runId: string): Promise<void>;
  forceInterrupt(projectId: string, runId: string): Promise<boolean>;
}
export function createLocalExecutionRuntime(
  io: LocalRuntimeIO,
  settingsProvider: SettingsProvider,
  clientFactory: (endpoint: string) => { comfy: LocalComfyPort },
): LocalExecutionRuntime {
  const getExecutionRun = io.load,
    mutateExecutionRun = io.mutate,
    readExecutionWorkflow = io.workflow,
    recordExecutionEvidence = io.evidence,
    sleep = io.sleep;
  async function recordPromptOutputs(
    projectId: string,
    run: ExecutionRun,
    installId: string,
    promptId: string,
    history: unknown,
    saveNodeIds: string[],
    comfy: LocalComfyPort,
  ) {
    const references = promptOutputReferences(history, promptId, saveNodeIds),
      recorded = new Set<string>();
    for (const image of references) {
      const actual = await io.materializeOutput(run, installId, promptId, image, comfy);
      if (recorded.has(actual.relativePath)) continue;
      if (!actual.relativePath || !actual.isFile || actual.size < 1)
        throw new Error(`Generated image is missing or empty: ${actual.relativePath}.`);
      recorded.add(actual.relativePath);
      await io.evidence(projectId, run.runId, {
        kind: 'CUSTOM',
        scope: LOCAL_FILE_SCOPE,
        data: {
          promptId,
          branchId: run.current.branchId,
          leafId: run.current.leafId,
          relativePath: actual.relativePath,
          size: actual.size,
          sha256: actual.sha256,
        },
      });
    }
    return recorded.size;
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
      at: io.now().iso,
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
  class LocalExecutionService {
    private readonly workers = new Map<string, Promise<void>>();
    constructor(
      private readonly settingsProvider: SettingsProvider,
      private readonly clientFactory: (endpoint: string) => { comfy: LocalComfyPort },
    ) {}
    start(root: string, runId: string): Promise<void> {
      const existing = this.workers.get(runId);
      if (existing) return existing;
      const worker = this.execute(root, runId)
        .catch((error) =>
          failRun(root, runId, 'LOCAL_EXECUTION_FAILED', error).then(() => undefined),
        )
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
          markGenerationStarted(current, recoveredId, io.now().ticks, io.now().iso);
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
        markGenerationCompleted(current, io.now().ticks);
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
      const { api: graph } = await readExecutionWorkflow(root, run);
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
            const attemptId = io.nextId(),
              graphSha256 = io.hash(JSON.stringify(branchGraph));
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
              markGenerationStarted(r, lastPromptId, io.now().ticks, io.now().iso);
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
              markGenerationCompleted(r, io.now().ticks);
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
      const verified = await verifyGeneratedLocalOutputs(run, io.hashValue, (relative) =>
        io.observeOutput(settings.installPath, run, relative),
      );
      await recordExecutionEvidence(root, runId, {
        kind: 'LOCAL_FILE_VERIFIED',
        scope: 'local-output',
        data: { count: verified.count },
      });
      await mutateExecutionRun(root, runId, (r) => {
        r.phase = 'COMPLETED';
        r.lifecycle = 'COMPLETED';
        r.completedAt = io.now().iso;
        r.current = { branchId: null, leafId: null, promptId: null };
      });
    }
  }
  return new LocalExecutionService(settingsProvider, clientFactory);
}
