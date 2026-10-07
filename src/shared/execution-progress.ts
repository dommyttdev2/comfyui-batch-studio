import {
  markGenerationCompleted as complete,
  estimatedGenerationRemainingMs as estimate,
  markGenerationStarted as start,
} from '../domain/execution-progress.js';
import type { ExecutionRun } from './types.js';

export {
  clearCurrentGenerationTiming,
  GENERATION_TIMING_WINDOW,
  generationAverageMs,
} from '../domain/execution-progress.js';
export function markGenerationStarted(
  run: ExecutionRun,
  promptId: string | null,
  atMs = Date.now(),
) {
  return start(run, promptId, atMs, new Date(atMs).toISOString());
}
export function markGenerationCompleted(run: ExecutionRun, atMs = Date.now()) {
  return complete(run, atMs);
}
export function estimatedGenerationRemainingMs(run: ExecutionRun, nowMs = Date.now()) {
  return estimate(run, nowMs);
}
