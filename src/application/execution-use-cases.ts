import {
  type ActorContext,
  authorize,
  BusinessError,
  type Command,
  requireId,
} from '../domain/contracts.js';
import {
  assertRunState,
  assertStopped,
  executionState,
  planRunStop,
  type RunState,
  type StopPlan,
} from '../domain/execution-policy.js';
import { createExecutionRun, type ExecutionCreationPorts } from './execution-creation.js';
import { type ExecutionRecoveryPorts, recoverExecutionRun } from './execution-recovery.js';
export interface ExecutionPort {
  withRunLock<T>(projectId: string, runId: string, work: () => Promise<T>): Promise<T>;
  // Supplies scoped IO operations; all creation decisions remain in application.
  creation(projectId: string, requestId: string): Promise<ExecutionCreationPorts>;
  launch(projectId: string, runId: string): Promise<void>;
  load(projectId: string, runId: string): Promise<RunState>;
  recovery(projectId: string, runId: string): Promise<ExecutionRecoveryPorts>;
  pausePreparation(projectId: string, runId: string): Promise<void>;
  stopScheduling(projectId: string, runId: string): Promise<void>;
  interrupt(projectId: string, runId: string): Promise<void>;
  recoverLocal(projectId: string, runId: string, mode: 'graceful' | 'interrupt'): Promise<void>;
  waitForSettled(projectId: string, runId: string): Promise<void>;
  finalizeRemote(projectId: string, runId: string): Promise<void>;
}
export class ExecutionUseCases {
  constructor(private readonly runtime: ExecutionPort) {}
  private async load(projectId: string, runId: string): Promise<RunState> {
    const run = await this.runtime.load(projectId, runId);
    assertRunState(run);
    if (run.id !== runId) throw new BusinessError('FORBIDDEN', 'Run scope mismatch.');
    return run;
  }
  async start(actor: ActorContext, command: Command) {
    authorize(actor, command.projectId, 'execute');
    const ports = await this.runtime.creation(command.projectId, actor.requestId);
    const capture = ports.capture.bind(ports);
    const run = await createExecutionRun({
      exclusive: (work) => ports.exclusive(work),
      current: () => ports.current(),
      preflight: () => ports.preflight(),
      persistSnapshot: (id, snapshot) => ports.persistSnapshot(id, snapshot),
      removeSnapshot: (id) => ports.removeSnapshot(id),
      write: (run) => ports.write(run),
      setCurrent: (id) => ports.setCurrent(id),
      now: () => ports.now(),
      nextId: () => ports.nextId(),
      capture: async (preflight) => {
        const snapshot = await capture(preflight);
        if (snapshot.projectId !== command.projectId)
          throw new BusinessError('FORBIDDEN', 'Run snapshot scope mismatch.');
        return snapshot;
      },
    });
    await this.runtime.launch(command.projectId, run.runId);
    return executionState(run);
  }
  async recover(actor: ActorContext, command: Command & { runId: string }) {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    return this.runtime.withRunLock(command.projectId, command.runId, async () => {
      const ports = await this.runtime.recovery(command.projectId, command.runId);
      return recoverExecutionRun(ports, command.projectId, command.runId);
    });
  }
  async stop(
    actor: ActorContext,
    command: Command & { runId: string; mode: 'graceful' | 'interrupt' },
  ): Promise<RunState> {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    if (command.mode !== 'graceful' && command.mode !== 'interrupt')
      throw new BusinessError('INVALID_INPUT', 'Unknown stop mode.');
    return this.runtime.withRunLock(command.projectId, command.runId, async () => {
      const run = await this.load(command.projectId, command.runId);
      const plan: StopPlan = planRunStop(run);
      if (plan === 'recover-local')
        await this.runtime.recoverLocal(command.projectId, command.runId, command.mode);
      else if (plan === 'pause-preparation')
        await this.runtime.pausePreparation(command.projectId, command.runId);
      else if (plan === 'stop-scheduling') {
        await this.runtime.stopScheduling(command.projectId, command.runId);
        if (command.mode === 'interrupt')
          await this.runtime.interrupt(command.projectId, command.runId);
      }
      await this.runtime.waitForSettled(command.projectId, command.runId);
      const settled = await this.load(command.projectId, command.runId);
      if (settled.lifecycle === 'RUNNING' || settled.recovery === 'uncertain')
        throw new BusinessError('RUNTIME_UNCERTAIN', 'Run stop is not confirmed.');
      if (
        settled.target === 'remote' &&
        settled.lifecycle !== 'DISCARDED' &&
        settled.finalization !== 'stopped'
      )
        await this.runtime.finalizeRemote(command.projectId, command.runId);
      const result = await this.load(command.projectId, command.runId);
      assertStopped(result);
      return result;
    });
  }
}
