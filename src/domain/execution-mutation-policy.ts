import type { ExecutionRun } from './artifact-types.js';

function terminalLifecycle(value: string) {
  return ['FAILED', 'COMPLETED', 'DISCARDED'].includes(value);
}
export function abandonRunForRemoteReplacement(
  run: ExecutionRun,
  replacementInstanceId: number,
  at: string,
) {
  if (!Number.isInteger(replacementInstanceId) || replacementInstanceId < 1)
    throw new Error('Invalid replacement Vast.ai Instance ID.');

  if (
    run.executionTarget !== 'remote' ||
    run.remote?.provider !== 'vastai' ||
    !Number.isInteger(run.remote.instanceId) ||
    Number(run.remote.instanceId) < 1
  )
    throw new Error('Execution Run is not a Vast.ai Remote Run.');
  if (Number(run.remote.instanceId) === replacementInstanceId)
    throw new Error('Replacement Instance must differ from the current Run Instance.');
  if (terminalLifecycle(run.lifecycle))
    throw new Error(`Execution Run ${run.runId} is already terminal.`);
  const e = {
    code: 'REMOTE_INSTANCE_REPLACED',
    message: `Execution Run was superseded by Vast.ai Instance ${replacementInstanceId}; original Instance ${run.remote.instanceId} is preserved in this Run history.`,
    phase: run.phase,
    at,
    retryable: false,
  };
  run.error = e;
  run.errorHistory.push(e);
  run.lifecycle = 'FAILED';
  run.controls.scheduling = 'STOPPED';
  run.controls.interrupt = 'IDLE';
  run.controls.stopSchedulingRequestedAt = null;
  run.controls.forceInterruptRequestedAt = null;
  run.current.promptId = null;
}

export function discardRun(run: ExecutionRun, at: string) {
  if (run.lifecycle === 'DISCARDED') return;
  const e = {
    code: 'EXECUTION_RUN_DISCARDED',
    message:
      'Execution Run was discarded. Locally generated and collected artifacts are preserved.',
    phase: run.phase,
    at,
    retryable: false,
  };
  run.error = e;
  run.errorHistory.push(e);
  run.lifecycle = 'DISCARDED';
  run.controls.scheduling = 'STOPPED';
  run.controls.interrupt = 'INTERRUPTED';
  run.controls.stopSchedulingRequestedAt = null;
  run.controls.forceInterruptRequestedAt = null;
  run.current = { branchId: null, leafId: null, promptId: null };
  if (run.progress.generationTiming) {
    run.progress.generationTiming.currentPromptId = null;
    run.progress.generationTiming.currentStartedAt = null;
  }
  run.completedAt = at;
}

export function requestStopSchedulingPolicy(run: ExecutionRun, at: string) {
  if (run.lifecycle !== 'RUNNING') throw new Error(`Execution Run ${run.runId} is not running.`);
  if (run.controls.scheduling === 'ACTIVE') {
    run.controls.scheduling = 'STOP_REQUESTED';
    run.controls.stopSchedulingRequestedAt = at;
  }
}

export function requestForceInterruptPolicy(run: ExecutionRun, at: string) {
  if (run.lifecycle !== 'RUNNING') throw new Error(`Execution Run ${run.runId} is not running.`);
  if (run.controls.interrupt === 'IDLE') {
    run.controls.interrupt = 'FORCE_REQUESTED';
    run.controls.forceInterruptRequestedAt = at;
  }
}
