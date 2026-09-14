import { randomInt } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionError, ExecutionRun } from '../shared/types.js';
import {
  clearCurrentGenerationTiming,
  markGenerationCompleted,
  markGenerationStarted,
} from '../shared/execution-progress.js';
import { exists, readJson } from './fs-utils.js';
import type { ApiGraph, ApiGraphNode } from './workflow-api.js';
import { ComfyUiClient } from './comfyui-client.js';
import { ScenePromptRunClient } from './scene-prompt-client.js';
import { getExecutionRun, mutateExecutionRun, recordExecutionEvidence } from './execution-run.js';

type LocalExecutionSettings = { endpoint: string; installPath: string };
type SettingsProvider = () => Promise<LocalExecutionSettings>;
type BranchBinding = { branchId: string; leafIds: string[]; expandNodeId: string };
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
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
function matrixLeafIds(node: ApiGraphNode | undefined) {
  if (node?.class_type !== 'SceneMatrix') return null;
  try {
    const parsed = JSON.parse(String(node.inputs.matrix_json ?? '')),
      sets = Array.isArray(parsed?.sets) ? parsed.sets : [];
    return sets
      .filter((row: any) => row?.enabled !== false)
      .map((row: any) => String(row?.row_id ?? ''));
  } catch {
    return null;
  }
}
export function enumerateSceneBranches(graph: ApiGraph, run: ExecutionRun): BranchBinding[] {
  const expandIds = Object.entries(graph)
    .filter(([, node]) => node.class_type === 'ScenePrompterExpand')
    .map(([id]) => id);
  return run.snapshot.plan.branches.map((branch) => {
    const matches = expandIds.filter((expandId) => {
      const up = ancestors(graph, expandId);
      return [...up].some((id) => {
        const leafIds = matrixLeafIds(graph[id]);
        return leafIds != null && JSON.stringify(leafIds) === JSON.stringify(branch.leafIds);
      });
    });
    if (matches.length !== 1)
      throw new Error(
        `Branch ${branch.branchId} must map to exactly one ScenePrompterExpand (found ${matches.length}).`,
      );
    return { branchId: branch.branchId, leafIds: branch.leafIds, expandNodeId: matches[0] };
  });
}
export function sliceSceneBranchGraph(graph: ApiGraph, expandNodeId: string): ApiGraph {
  if (!graph[expandNodeId]) throw new Error(`ScenePrompterExpand ${expandNodeId} was not found.`);
  const down = descendants(graph, expandNodeId),
    keep = ancestors(graph, [...down][0] ?? expandNodeId);
  for (const id of down) keep.add(id);
  for (const id of [...down]) for (const ancestor of ancestors(graph, id)) keep.add(ancestor);
  for (const id of keep)
    if (id !== expandNodeId && graph[id]?.class_type === 'ScenePrompterExpand')
      throw new Error('A branch slice contains multiple ScenePrompterExpand nodes.');
  return Object.fromEntries(
    [...keep].sort((a, b) => Number(a) - Number(b)).map((id) => [id, clone(graph[id])]),
  );
}
function applyExpandState(graph: ApiGraph, expandNodeId: string, runId: string, index: number) {
  const node = graph[expandNodeId];
  if (!node || node.class_type !== 'ScenePrompterExpand')
    throw new Error('ScenePrompterExpand is missing from branch graph.');
  node.inputs.current_index = index;
  node.inputs.run_id = runId;
  node.inputs.seed_base = randomInt(0, 0x7fffffff);
  (node.inputs as any).seed_base_literal = false;
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
    const next = errorOf(run, code, error);
    run.error = next;
    run.errorHistory.push(next);
    run.lifecycle = 'FAILED';
    run.controls.scheduling = 'STOPPED';
    run.current.promptId = null;
    clearCurrentGenerationTiming(run);
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
async function countRecentImages(root: string, sinceMs: number): Promise<number> {
  if (!(await exists(root))) return 0;
  let count = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) count += await countRecentImages(full, sinceMs);
    else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      try {
        if ((await stat(full)).mtimeMs >= sinceMs) count++;
      } catch {}
    }
  }
  return count;
}
export async function verifyLocalOutputs(installPath: string, run: ExecutionRun) {
  if (!installPath)
    throw new Error('Local ComfyUI install path is required to verify generated outputs.');
  const outputRoot = path.join(installPath, 'output', 'BatchStudio', run.projectId),
    since = Date.parse(run.startedAt) - 5000;
  const count = await countRecentImages(outputRoot, since);
  if (count < run.progress.overall.total)
    throw new Error(
      `Generated output verification failed: expected ${run.progress.overall.total} images, found ${count} under ${outputRoot}.`,
    );
  return { outputRoot, count };
}

export class LocalExecutionService {
  private readonly workers = new Map<string, Promise<void>>();
  constructor(
    private readonly settingsProvider: SettingsProvider,
    private readonly clientFactory = (endpoint: string) => ({
      comfy: new ComfyUiClient(endpoint),
      scene: new ScenePromptRunClient(endpoint),
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
      { comfy, scene } = this.clientFactory(settings.endpoint);
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'LOCAL_COMFYUI_CONNECTING';
    });
    await comfy.health();
    await mutateExecutionRun(root, runId, (r) => {
      r.phase = 'LOCAL_CAPABILITY_CHECKING';
    });
    const graph = await readJson<ApiGraph>(path.join(root, run.snapshot.workflow.apiPath)),
      workflow = await readJson<unknown>(path.join(root, run.snapshot.workflow.uiPath));
    if (!graph || !workflow) throw new Error('Execution workflow snapshot files are missing.');
    const info = await comfy.objectInfo(),
      required = new Set(Object.values(graph).map((node) => node.class_type));
    const missing = [...required].filter((name) => !info?.[name]);
    if (missing.length)
      throw new Error(`Local ComfyUI is missing required node types: ${missing.join(', ')}`);
    const branches = enumerateSceneBranches(graph, run);
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
      const branchGraph = sliceSceneBranchGraph(graph, binding.expandNodeId),
        continuousId = `${run.runId}:${binding.branchId}`;
      applyExpandState(branchGraph, binding.expandNodeId, continuousId, branchProgress.completed);
      const wrapper = { output: branchGraph },
        prepared = await scene.prepare(wrapper, binding.expandNodeId, workflow, run.runId);
      if (Number(prepared.total_batches) !== binding.leafIds.length)
        throw new Error(
          `Scene Prompt plan mismatch for ${binding.branchId}: expected ${binding.leafIds.length} batches, got ${prepared.total_batches}.`,
        );
      let lastPromptId = '',
        runHandleClaimed = false;
      try {
        for (let index = branchProgress.completed; index < binding.leafIds.length; index++) {
          run = await getExecutionRun(root, runId);
          if (!run || run.lifecycle !== 'RUNNING') return;
          if (run.controls.scheduling !== 'ACTIVE') {
            await pauseForStop(root, runId);
            return;
          }
          applyExpandState(branchGraph, binding.expandNodeId, continuousId, index);
          await mutateExecutionRun(root, runId, (r) => {
            r.phase = 'EXECUTING';
            r.current = {
              branchId: binding.branchId,
              leafId: binding.leafIds[index],
              promptId: null,
            };
            const bp = r.progress.branches.find((x) => x.branchId === binding.branchId);
            if (bp) bp.state = 'running';
          });
          const submitted = await comfy.prompt(branchGraph, run.runId);
          lastPromptId = submitted.prompt_id;
          await mutateExecutionRun(root, runId, (r) => {
            r.current.promptId = lastPromptId;
            if (!r.promptIds.includes(lastPromptId)) r.promptIds.push(lastPromptId);
            markGenerationStarted(r, lastPromptId);
          });
          if (!runHandleClaimed) {
            await scene.claim(prepared.run_handle, lastPromptId);
            runHandleClaimed = true;
          }
          let terminal: 'success' | 'error' = 'error';
          for (;;) {
            const history = await comfy.history(lastPromptId),
              state = comfy.historyState(history, lastPromptId);
            if (state !== 'pending') {
              terminal = state;
              break;
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
          await mutateExecutionRun(root, runId, (r) => {
            const bp = r.progress.branches.find((x) => x.branchId === binding.branchId);
            if (bp) bp.completed = Math.min(bp.total, bp.completed + 1);
            r.progress.overall.completed = Math.min(
              r.progress.overall.total,
              r.progress.overall.completed + 1,
            );
            markGenerationCompleted(r);
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
        if (lastPromptId) {
          for (let poll = 0; poll < 120; poll++) {
            const state = await scene.finalize(
              prepared.run_handle,
              binding.expandNodeId,
              lastPromptId,
            );
            if (state === 'finalized') break;
            if (poll === 119) throw new Error('Scene Prompt finalize timed out.');
            await sleep(500);
          }
        }
        await mutateExecutionRun(root, runId, (r) => {
          const bp = r.progress.branches.find((x) => x.branchId === binding.branchId);
          if (bp) bp.state = 'completed';
          r.current = { branchId: null, leafId: null, promptId: null };
        });
      } finally {
        await scene.release(prepared.run_handle).catch(() => false);
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
