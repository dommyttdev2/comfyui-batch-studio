import type { ExecutionRun } from '../domain/artifact-types.js';
import { BusinessError } from '../domain/contracts.js';
import { validatedExecutionEvidence } from '../domain/execution-evidence.js';
import {
  assertRunState,
  executionState,
  planPersistedRecovery,
} from '../domain/execution-policy.js';
import { assertPersistSafe } from '../domain/execution-record-policy.js';
export interface ExecutionRecoveryPorts {
  load(): Promise<ExecutionRun>;
  save(run: ExecutionRun): Promise<void>;
  hasActiveWorker(): Promise<boolean>;
  reserveOwnership(run: ExecutionRun): Promise<void>;
  recoverLocal(run: ExecutionRun): Promise<void>;
  recoverRemote(run: ExecutionRun): Promise<void>;
  verifyLocalOutputs(run: ExecutionRun): Promise<void>;
  finalizeRemote(run: ExecutionRun): Promise<void>;
  hash(value: unknown): string;
  now(): string;
}
export async function recoverExecutionRun(
  ports: ExecutionRecoveryPorts,
  projectId: string,
  runId: string,
) {
  const load = async () => {
    const run = await ports.load();
    if (run.projectId !== projectId || run.runId !== runId)
      throw new BusinessError('FORBIDDEN', 'Run recovery scope mismatch.');
    assertRunState(executionState(run));
    return run;
  };
  const run = await load();
  if (run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN') {
    await ports.reserveOwnership(run);
    return executionState(run);
  }
  if (run.lifecycle !== 'RUNNING' || (await ports.hasActiveWorker())) return executionState(run);
  const strategy = planPersistedRecovery(run);
  const persist = async () => {
    run.updatedAt = ports.now();
    assertPersistSafe(run);
    await ports.save(run);
  };
  const markUncertain = async () => {
    await ports.reserveOwnership(run);
    const failure = {
      code: 'EXECUTION_RECOVERY_UNCERTAIN',
      message: 'External runtime state could not be confirmed; no new Prompt was submitted.',
      phase: run.phase,
      at: ports.now(),
      retryable: false,
    };
    run.error = failure;
    run.errorHistory.push(failure);
    run.lifecycle = 'FAILED';
    run.controls.scheduling = 'STOPPED';
    await persist();
  };
  try {
    switch (strategy) {
      case 'pause-prepared':
      case 'pause-before-submit':
        run.lifecycle = 'PAUSED';
        run.controls.scheduling = 'STOPPED';
        if (strategy === 'pause-before-submit') run.error = null;
        await persist();
        break;
      case 'verify-local-output':
        await ports.verifyLocalOutputs(run);
        run.lifecycle = 'COMPLETED';
        run.completedAt = ports.now();
        run.controls.scheduling = 'STOPPED';
        await persist();
        break;
      case 'retain-uncertain':
        await markUncertain();
        break;
      case 'recover-local':
        await ports.reserveOwnership(run);
        await ports.recoverLocal(run);
        break;
      case 'finalize-remote': {
        const kinds = new Set(
          validatedExecutionEvidence(run, (value) => ports.hash(value)).valid.map((e) => e.kind),
        );
        if (!kinds.has('LOCAL_FILE_VERIFIED') || !kinds.has('CLEANUP_COMPLETED'))
          throw new BusinessError('RUNTIME_UNCERTAIN', 'Verified completion evidence is required.');
        await ports.reserveOwnership(run);
        await ports.finalizeRemote(run);
        const latest = await load();
        if (latest.lifecycle === 'RUNNING' && executionState(latest).finalization === 'stopped') {
          latest.lifecycle = 'COMPLETED';
          latest.phase = 'COMPLETED';
          latest.completedAt = ports.now();
          latest.controls.scheduling = 'STOPPED';
          latest.updatedAt = ports.now();
          assertPersistSafe(latest);
          await ports.save(latest);
        }
        break;
      }
      case 'recover-remote':
        if (
          run.remote?.provider !== 'vastai' ||
          !Number.isInteger(run.remote.instanceId) ||
          Number(run.remote.instanceId) < 1
        )
          throw new BusinessError('INVALID_INPUT', 'Remote instance identity is required.');
        await ports.reserveOwnership(run);
        await ports.recoverRemote(run);
        break;
    }
  } catch (error) {
    if (error instanceof BusinessError && error.code === 'FORBIDDEN') throw error;
    await markUncertain();
  }
  const latest = await load();
  if (latest.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN') await ports.reserveOwnership(latest);
  return executionState(latest);
}
