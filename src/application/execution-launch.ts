import type { ExecutionRun } from '../domain/artifact-types.js';
import { markLaunchFailure, ExecutionLaunchFailure } from '../domain/execution-launch-policy.js';
export interface ExecutionSubmissionPorts {
  local(projectId: string, run: ExecutionRun): Promise<void>;
  remote(
    projectId: string,
    run: ExecutionRun,
    provider: 'vastai',
    instanceId: number,
  ): Promise<void>;
}
export async function submitExecution(
  ports: ExecutionSubmissionPorts,
  projectId: string,
  run: ExecutionRun,
) {
  if (run.executionTarget === 'local') return ports.local(projectId, run);
  const instanceId = Number(run.remote?.instanceId);
  if (run.remote?.provider !== 'vastai' || !Number.isInteger(instanceId) || instanceId < 1)
    throw new ExecutionLaunchFailure(
      'Remote Execution Run has no valid Vast.ai Instance.',
      'not-started',
    );
  return ports.remote(projectId, run, 'vastai', instanceId);
}
export interface ExecutionLaunchPorts {
  submit(projectId: string, run: ExecutionRun): Promise<void>;
  mutate(
    projectId: string,
    runId: string,
    work: (run: ExecutionRun) => void,
  ): Promise<ExecutionRun>;
  now(): string;
  safeError(error: unknown): string;
}
export async function launchExecution(
  ports: ExecutionLaunchPorts,
  projectId: string,
  run: ExecutionRun,
) {
  try {
    await ports.submit(projectId, run);
  } catch (error) {
    await ports.mutate(projectId, run.runId, (current) =>
      markLaunchFailure(current, error, ports.safeError(error), ports.now()),
    );
    throw error;
  }
}

export async function observeExecutionCompletion(
  ports: Omit<ExecutionLaunchPorts, 'submit'>,
  projectId: string,
  run: ExecutionRun,
  task: Promise<void>,
) {
  try {
    await task;
  } catch (error) {
    await ports.mutate(projectId, run.runId, (current) => {
      if (current.runId !== run.runId || current.projectId !== run.projectId)
        throw new Error('Run completion scope mismatch.');
      if (current.lifecycle === 'RUNNING')
        markLaunchFailure(current, error, ports.safeError(error), ports.now());
    });
    throw error;
  }
}
