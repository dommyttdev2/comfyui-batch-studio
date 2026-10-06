import {
  authorize,
  BusinessError,
  requireId,
  type ActorContext,
  type Command,
} from '../domain/contracts.js';
import {
  assertRunState,
  assertStopped,
  planRunStop,
  type RunState,
  type StopPlan,
} from '../domain/execution-policy.js';
export interface ExecutionPort {
  withRunLock<T>(projectId: string, runId: string, work: () => Promise<T>): Promise<T>;
  // Must reserve Project and external resource ownership atomically before launch.
  start(projectId: string, requestId: string): Promise<RunState>;
  load(projectId: string, runId: string): Promise<RunState>;
  reconcile(projectId: string, runId: string): Promise<RunState>;
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
    const run = await this.runtime.start(command.projectId, actor.requestId);
    assertRunState(run);
    return run;
  }
  async recover(actor: ActorContext, command: Command & { runId: string }) {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    const run = await this.runtime.reconcile(command.projectId, command.runId);
    assertRunState(run);
    if (run.id !== command.runId) throw new BusinessError('FORBIDDEN', 'Run scope mismatch.');
    return run;
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
