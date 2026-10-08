import type { ExecutionRun } from './artifact-types.js';
import {
  clearCurrentGenerationTiming,
  markGenerationCompleted,
  markGenerationStarted,
} from './execution-progress.js';
export type RemoteSequenceState = {
  version?: number;
  runId?: string;
  status?: 'running' | 'interrupting' | 'paused' | 'interrupted' | 'completed' | 'failed';
  current?: {
    branchId?: string | null;
    leafId?: string | null;
    index?: number;
    promptId?: string | null;
    submission?: {
      attemptId?: string;
      status?: 'prepared' | 'sending' | 'acknowledged' | 'completed';
      promptId?: string | null;
    };
  };
  completed?: Record<string, number>;
  overallCompleted?: number;
  overallTotal?: number;
  promptIds?: string[];
  artifact?: { outputPrefix?: string; capturedAt?: string };
  error?: { code?: string; message?: string } | null;
};
export function applyRemoteProgressEvent(
  run: ExecutionRun,
  event: { type: 'progress'; stage: string; [key: string]: unknown },
  at: { ticks: number; iso: string },
) {
  const overall = Number(event.overallCompleted);
  if (Number.isFinite(overall))
    run.progress.overall.completed = Math.max(0, Math.min(run.progress.overall.total, overall));
  const current =
    event.current && typeof event.current === 'object' && !Array.isArray(event.current)
      ? (event.current as Record<string, unknown>)
      : null;
  const branchId = typeof current?.branchId === 'string' ? current.branchId : null;
  const leafId = typeof current?.leafId === 'string' ? current.leafId : null;
  const promptId =
    typeof current?.promptId === 'string'
      ? current.promptId
      : typeof event.promptId === 'string'
        ? event.promptId
        : null;
  run.current = { branchId, leafId, promptId };
  if (promptId && !run.promptIds.includes(promptId)) run.promptIds.push(promptId);
  if (event.stage === 'prompt_submitted') markGenerationStarted(run, promptId, at.ticks, at.iso);
  if (event.stage === 'prompt_terminal') {
    if (event.terminal === 'success') markGenerationCompleted(run, at.ticks);
    else clearCurrentGenerationTiming(run);
  }
  if (
    event.stage === 'scheduling_stopped' ||
    event.stage === 'interrupt_requested' ||
    event.stage === 'sequence_completed'
  )
    clearCurrentGenerationTiming(run);
  if (branchId) {
    const branch = run.progress.branches.find((item) => item.branchId === branchId);
    if (branch) {
      const index = Number(current?.index);
      if (
        event.stage === 'prompt_terminal' &&
        event.terminal === 'success' &&
        Number.isFinite(index)
      )
        branch.completed = Math.max(branch.completed, Math.min(branch.total, index));
      branch.state = branch.completed >= branch.total ? 'completed' : 'running';
    }
  }
  if (event.stage === 'sequence_completed')
    for (const branch of run.progress.branches)
      if (branch.completed >= branch.total) branch.state = 'completed';
}

export function applyRemoteState(
  run: ExecutionRun,
  state: RemoteSequenceState,
  at: { ticks: number; iso: string },
) {
  const completed = state.completed ?? {},
    beforeOverall = run.progress.overall.completed;
  for (const branch of run.progress.branches) {
    const next = Math.max(
      0,
      Math.min(branch.total, Number(completed[branch.branchId] ?? branch.completed)),
    );
    branch.completed = next;
    branch.state =
      next >= branch.total
        ? 'completed'
        : state.current?.branchId === branch.branchId
          ? 'running'
          : branch.state === 'failed'
            ? 'failed'
            : 'pending';
  }
  const nextOverall = Math.max(
    0,
    Math.min(
      run.progress.overall.total,
      Number(state.overallCompleted ?? run.progress.overall.completed),
    ),
  );
  if (nextOverall > beforeOverall && run.progress.generationTiming?.currentStartedAt)
    markGenerationCompleted(run, at.ticks);
  run.progress.overall.completed = nextOverall;
  const promptId = state.current?.promptId ?? null;
  run.current = {
    branchId: state.current?.branchId ?? null,
    leafId: state.current?.leafId ?? null,
    promptId,
  };
  if (promptId && promptId !== run.progress.generationTiming?.currentPromptId)
    markGenerationStarted(run, promptId, at.ticks, at.iso);
  if (!promptId && state.status && state.status !== 'running' && state.status !== 'interrupting')
    clearCurrentGenerationTiming(run);
  for (const id of state.promptIds ?? [])
    if (id && !run.promptIds.includes(id)) run.promptIds.push(id);
}
