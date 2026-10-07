import type { ExecutionRun } from './artifact-types.js';

export const GENERATION_TIMING_WINDOW = 5;

function timing(run: ExecutionRun) {
  if (!run.progress.generationTiming) {
    run.progress.generationTiming = {
      currentPromptId: null,
      currentStartedAt: null,
      recentDurationsMs: [],
    };
  }
  return run.progress.generationTiming;
}

export function markGenerationStarted(
  run: ExecutionRun,
  promptId: string | null,
  atMs: number,
  atIso: string,
) {
  const state = timing(run);
  if (state.currentStartedAt && state.currentPromptId === promptId) return;
  state.currentPromptId = promptId;
  state.currentStartedAt = atIso;
}

export function markGenerationCompleted(run: ExecutionRun, atMs: number) {
  const state = timing(run);
  const startedAt = state.currentStartedAt ? Date.parse(state.currentStartedAt) : NaN;
  if (Number.isFinite(startedAt)) {
    const duration = Math.max(0, Math.round(atMs - startedAt));
    if (duration > 0)
      state.recentDurationsMs = [...state.recentDurationsMs, duration].slice(
        -GENERATION_TIMING_WINDOW,
      );
  }
  state.currentPromptId = null;
  state.currentStartedAt = null;
}

export function clearCurrentGenerationTiming(run: ExecutionRun) {
  const state = timing(run);
  state.currentPromptId = null;
  state.currentStartedAt = null;
}

export function generationAverageMs(run: ExecutionRun): number | null {
  const samples = (run.progress.generationTiming?.recentDurationsMs ?? [])
    .filter((value) => Number.isFinite(value) && value > 0)
    .slice(-GENERATION_TIMING_WINDOW);
  if (!samples.length) return null;
  return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

export function estimatedGenerationRemainingMs(run: ExecutionRun, nowMs: number): number | null {
  const average = generationAverageMs(run);
  if (average == null) return null;
  const remaining = Math.max(0, run.progress.overall.total - run.progress.overall.completed);
  if (remaining === 0) return 0;
  let estimate = average * remaining;
  const startedAt = run.progress.generationTiming?.currentStartedAt
    ? Date.parse(run.progress.generationTiming.currentStartedAt)
    : NaN;
  if (Number.isFinite(startedAt)) {
    const elapsed = Math.max(0, nowMs - startedAt);
    estimate -= Math.min(average, elapsed);
  }
  return Math.max(0, Math.round(estimate));
}
