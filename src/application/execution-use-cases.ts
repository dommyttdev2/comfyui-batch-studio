import { ExecutionCommands, type ExecutionCommandPorts } from './execution-commands.js';
import { markLaunchFailure } from '../domain/execution-launch-policy.js';
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
  type RunState,
} from '../domain/execution-policy.js';
import { createExecutionRun, type ExecutionCreationPorts } from './execution-creation.js';
import { type ExecutionRecoveryPorts, recoverExecutionRun } from './execution-recovery.js';
import { assessPreflight, type PreflightPorts } from './preflight.js';
export interface ExecutionPort {
  commandPorts(projectId: string): Promise<ExecutionCommandPorts>;
  withOperationLock<T>(projectId: string, work: () => Promise<T>): Promise<T>;
  withRunLock<T>(projectId: string, runId: string, work: () => Promise<T>): Promise<T>;
  // Supplies scoped IO operations; all creation decisions remain in application.
  creation(
    projectId: string,
    requestId: string,
  ): Promise<ExecutionCreationPorts & { preflightInputs(): Promise<PreflightPorts> }>;
  launch(projectId: string, runId: string): Promise<void>;
  load(projectId: string, runId: string): Promise<RunState>;
  recovery(projectId: string, runId: string): Promise<ExecutionRecoveryPorts>;
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
    return this.runtime.withOperationLock(command.projectId, async () => {
      const ports = await this.runtime.creation(command.projectId, actor.requestId);
      const capture = ports.capture.bind(ports);
      const run = await createExecutionRun(
        {
          exclusive: (work) => ports.exclusive(work),
          current: () => ports.current(),
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
        },
        async () => this.preflight(command.projectId, await ports.preflightInputs()),
      );
      await this.launch(command.projectId, run.runId);
      return executionState(run);
    });
  }
  private async launch(projectId: string, runId: string) {
    try {
      await this.runtime.launch(projectId, runId);
    } catch (error) {
      await this.runtime.withRunLock(projectId, runId, async () => {
        const ports = await this.runtime.recovery(projectId, runId),
          run = await ports.load();
        if (run.projectId !== projectId || run.runId !== runId)
          throw new BusinessError('FORBIDDEN', 'Run launch failure scope mismatch.');
        markLaunchFailure(
          run,
          error,
          error instanceof Error ? error.message : String(error),
          ports.now(),
        );
        await ports.save(run);
      });
      throw error;
    }
  }
  private async preflight(projectId: string, ports: PreflightPorts) {
    const project = await ports.project();
    if (project.id !== projectId)
      throw new BusinessError('FORBIDDEN', 'Preflight Project scope mismatch.');
    return assessPreflight({ ...ports, project: async () => project });
  }
  async resume(actor: ActorContext, command: Command & { runId: string }) {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    return this.runtime.withOperationLock(command.projectId, async () =>
      executionState(
        await new ExecutionCommands(await this.runtime.commandPorts(command.projectId)).resume(
          command.projectId,
          command.runId,
        ),
      ),
    );
  }
  async recheck(actor: ActorContext, command: Command & { runId: string }) {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    return this.runtime.withOperationLock(command.projectId, async () =>
      executionState(
        await new ExecutionCommands(await this.runtime.commandPorts(command.projectId)).recheck(
          command.projectId,
          command.runId,
        ),
      ),
    );
  }
  async replaceRemote(actor: ActorContext, command: Command & { runId: string }) {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    return this.runtime.withOperationLock(command.projectId, async () =>
      executionState(
        await new ExecutionCommands(
          await this.runtime.commandPorts(command.projectId),
        ).replaceRemote(command.projectId, command.runId),
      ),
    );
  }
  async rerunPlan(actor: ActorContext, command: Command & { runId: string }) {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    return this.runtime.withOperationLock(command.projectId, async () =>
      executionState(
        await new ExecutionCommands(await this.runtime.commandPorts(command.projectId)).rerunPlan(
          command.projectId,
          command.runId,
        ),
      ),
    );
  }
  async discard(actor: ActorContext, command: Command & { runId: string }) {
    authorize(actor, command.projectId, 'execute');
    requireId(command.runId, 'Run');
    return this.runtime.withOperationLock(command.projectId, async () => {
      const run = await new ExecutionCommands(
        await this.runtime.commandPorts(command.projectId),
      ).discardCurrentExecutionRun(command.projectId, command.runId);
      return run ? executionState(run) : null;
    });
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
    return this.runtime.withOperationLock(command.projectId, async () => {
      await this.load(command.projectId, command.runId);
      const result = await new ExecutionCommands(
        await this.runtime.commandPorts(command.projectId),
      ).stopRunForExit(command.projectId, command.runId, command.mode);
      if (result.projectId !== command.projectId || result.runId !== command.runId)
        throw new BusinessError('FORBIDDEN', 'Run scope mismatch.');
      const state = executionState(result);
      assertStopped(state);
      return state;
    });
  }
}
