import type { ExecutionRun } from './artifact-types.js';

export function assertRemoteRequestAllowed(
  run: ExecutionRun | null,
  runId: string,
): asserts run is ExecutionRun {
  if (
    !run ||
    run.runId !== runId ||
    run.executionTarget !== 'remote' ||
    run.lifecycle !== 'RUNNING'
  )
    throw new Error(`Execution Run ${runId} is not running.`);
}
