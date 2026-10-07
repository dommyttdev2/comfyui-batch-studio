import type { ExecutionRun } from './artifact-types.js';
import { BusinessError } from './contracts.js';
export type RunLifecycle =
  | 'RUNNING'
  | 'PAUSED'
  | 'INTERRUPTED'
  | 'FAILED'
  | 'COMPLETED'
  | 'DISCARDED';
export interface RunState {
  id: string;
  target: 'local' | 'remote';
  lifecycle: RunLifecycle;
  phase: string;
  recovery: 'known' | 'uncertain';
  finalization: 'not-required' | 'pending' | 'stopped' | 'failed';
}
const preparation = new Set([
  'CLOUD_INSTANCE_RESOLVING',
  'CLOUD_INSTANCE_STARTING',
  'CLOUD_INSTANCE_READY',
  'SSH_CONNECTING',
  'SSH_CONNECTED',
  'REMOTE_WORKER_PREPARING',
  'REMOTE_ENVIRONMENT_CHECKING',
  'REMOTE_DEPENDENCIES_INSTALLING',
  'REMOTE_GITHUB_AUTHENTICATING',
  'REMOTE_COMFYUI_UPDATING',
  'REMOTE_COMFYUI_RELEASE_CHECKING',
  'REMOTE_COMFYUI_RELEASE_FETCHING',
  'REMOTE_COMFYUI_CHECKING_OUT',
  'REMOTE_COMFYUI_REQUIREMENTS_INSTALLING',
  'REMOTE_COMFYUI_MANAGER_CONFIGURING',
  'REMOTE_COMFYUI_RESTARTING',
  'REMOTE_ENVIRONMENT_READY',
  'REMOTE_MODELS_CHECKING',
  'REMOTE_MODELS_DOWNLOADING',
  'REMOTE_MODELS_READY',
  'WORKFLOW_PREPARING',
]);
export function assertRunState(run: RunState): void {
  if (
    !run ||
    typeof run.id !== 'string' ||
    !run.id ||
    !['local', 'remote'].includes(run.target) ||
    !['RUNNING', 'PAUSED', 'INTERRUPTED', 'FAILED', 'COMPLETED', 'DISCARDED'].includes(
      run.lifecycle,
    ) ||
    !['known', 'uncertain'].includes(run.recovery) ||
    !['not-required', 'pending', 'stopped', 'failed'].includes(run.finalization) ||
    typeof run.phase !== 'string' ||
    !run.phase ||
    (run.target === 'remote' && run.finalization === 'not-required')
  )
    throw new BusinessError('INVALID_INPUT', 'Current Run state is required.');
}
export function blocksProjectEdit(run: RunState): boolean {
  assertRunState(run);
  return (
    run.lifecycle === 'RUNNING' ||
    run.recovery === 'uncertain' ||
    (run.target === 'remote' &&
      run.finalization !== 'stopped' &&
      (run.lifecycle === 'PAUSED' ||
        run.lifecycle === 'INTERRUPTED' ||
        (run.lifecycle === 'FAILED' && run.finalization === 'failed')))
  );
}
export function assertProjectWritable(runs: readonly RunState[]): void {
  if (runs.some(blocksProjectEdit))
    throw new BusinessError(
      'PROJECT_BUSY',
      'Project is read-only until Run ownership and finalization are settled.',
    );
}
export type StopPlan =
  | 'recover-local'
  | 'pause-preparation'
  | 'stop-scheduling'
  | 'already-settled';
export function planRunStop(run: RunState): StopPlan {
  assertRunState(run);
  if (run.recovery === 'uncertain') {
    if (run.target === 'local') return 'recover-local';
    throw new BusinessError(
      'RUNTIME_UNCERTAIN',
      'Remote ownership must be reconciled before stopping.',
    );
  }
  if (run.lifecycle !== 'RUNNING') return 'already-settled';
  if (run.target === 'remote' && preparation.has(run.phase)) return 'pause-preparation';
  if (run.target === 'remote' && run.phase !== 'EXECUTING')
    throw new BusinessError(
      'RUNTIME_BUSY',
      'Remote output processing must finish before stopping.',
    );
  return 'stop-scheduling';
}
export function assertStopped(run: RunState): void {
  assertRunState(run);
  if (
    run.lifecycle === 'RUNNING' ||
    run.recovery === 'uncertain' ||
    (run.target === 'remote' && run.lifecycle !== 'DISCARDED' && run.finalization !== 'stopped')
  )
    throw new BusinessError(
      'RUNTIME_UNCERTAIN',
      'Safe stop and remote billing finalization have not been confirmed.',
    );
}
// Navigating away or disconnecting a browser never owns the Run lifetime.
export function leaveProject(): { runtimeContinues: true } {
  return { runtimeContinues: true };
}

export function executionState(run: ExecutionRun): RunState {
  const stopped =
    !!run.remoteLifecycle?.finalizedAt && run.remoteLifecycle.latest?.status === 'stopped';
  return {
    id: run.runId,
    target: run.executionTarget,
    lifecycle: run.lifecycle,
    phase: run.phase,
    recovery: run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN' ? 'uncertain' : 'known',
    finalization:
      run.executionTarget === 'local'
        ? 'not-required'
        : stopped
          ? 'stopped'
          : run.error?.code === 'REMOTE_INSTANCE_FINALIZE_FAILED'
            ? 'failed'
            : 'pending',
  };
}
export function isRemotePreparationPhase(phase: string): boolean {
  return preparation.has(phase);
}

export type PersistedRecovery =
  | 'recover-local'
  | 'pause-prepared'
  | 'pause-before-submit'
  | 'verify-local-output'
  | 'retain-uncertain'
  | 'finalize-remote'
  | 'recover-remote';
export function planPersistedRecovery(run: ExecutionRun): PersistedRecovery {
  if (run.executionTarget === 'remote')
    return run.phase === 'CLOUD_INSTANCE_FINALIZING' ? 'finalize-remote' : 'recover-remote';
  if (run.current.promptId || run.submission?.status === 'sending') return 'recover-local';
  if (run.submission?.status === 'prepared') return 'pause-prepared';
  if (
    ['LOCAL_COMFYUI_CONNECTING', 'LOCAL_CAPABILITY_CHECKING', 'WORKFLOW_PREPARING'].includes(
      run.phase,
    )
  )
    return 'pause-before-submit';
  if (run.phase === 'COMPLETED') return 'verify-local-output';
  return 'retain-uncertain';
}
