import { safeExecutionError } from './execution-error-policy.js';
import type { ExecutionRun } from './artifact-types.js';
import { BusinessError } from './contracts.js';

// A transport timeout cannot establish that a worker did not accept the Run.
export class ExecutionLaunchFailure extends Error {
  constructor(
    message: string,
    readonly acceptance: 'not-started' | 'unknown',
  ) {
    super(message);
  }
}

export function markLaunchFailure(
  run: ExecutionRun,
  error: unknown,
  message: string,
  now: string,
): void {
  const notStarted =
    error instanceof ExecutionLaunchFailure
      ? error.acceptance === 'not-started'
      : error instanceof BusinessError && error.code === 'RUNTIME_BUSY';
  const failure = {
    code: notStarted ? 'EXECUTION_RESOURCE_BUSY' : 'EXECUTION_RECOVERY_UNCERTAIN',
    message: safeExecutionError(message),
    phase: run.phase,
    at: now,
    retryable: notStarted,
  };
  run.error = failure;
  run.errorHistory.push(failure);
  run.lifecycle = 'FAILED';
  run.controls.scheduling = 'STOPPED';
  run.updatedAt = now;
}
