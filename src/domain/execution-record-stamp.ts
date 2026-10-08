import type { ExecutionRun } from './artifact-types.js';
export function stampRunMutation(run: ExecutionRun, now: string) {
  run.updatedAt = now;
  if (run.lifecycle === 'COMPLETED' && !run.completedAt) run.completedAt = now;
}
export function validStoredRunIdentity(run: ExecutionRun, runId: string) {
  return !!run && run.runId === runId && typeof run.lifecycle === 'string';
}
