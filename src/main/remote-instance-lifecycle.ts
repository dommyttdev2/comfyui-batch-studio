import type {
  CloudInstanceStatus,
  ExecutionPhase,
  ExecutionRemoteLifecycleState,
  ExecutionRemoteInstanceSnapshot,
  VastAiInstance,
} from '../shared/types.js';
import { getExecutionRun, mutateExecutionRun } from './execution-run.js';
import type { VastAiClient } from './vastai-client.js';

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_POLL_MS = 5_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

type LifecycleClient = Pick<VastAiClient, 'getInstance' | 'requestStartInstance' | 'stopInstance'>;
type LifecycleOptions = {
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function snapshot(instance: VastAiInstance): ExecutionRemoteInstanceSnapshot {
  return {
    provider: 'vastai',
    instanceId: instance.id,
    status: instance.status,
    rawStatus: instance.rawStatus,
    intendedStatus: instance.intendedStatus,
    curState: instance.curState,
    nextState: instance.nextState,
    statusMessage: instance.statusMessage,
    sshHost: instance.sshHost,
    sshPort: instance.sshPort,
    comfyUiPort: instance.comfyUiPort,
    resolvedAt: new Date().toISOString(),
  };
}

function defaultLifecycle(): ExecutionRemoteLifecycleState {
  return {
    initialStatus: null,
    startedByBatchStudio: false,
    startRequestedAt: null,
    latest: null,
    restorePolicy: 'restore-if-started',
    restoredInitialState: false,
    finalizedAt: null,
  };
}

function unavailable(instance: VastAiInstance) {
  return instance.status === 'error' || instance.status === 'offline';
}

function statusDetail(instance: VastAiInstance) {
  return instance.statusMessage ?? instance.rawStatus;
}

export class RemoteInstanceLifecycleService {
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private readonly sleepImpl: (ms: number) => Promise<void>;

  constructor(
    private readonly client: LifecycleClient,
    options: LifecycleOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.sleepImpl = options.sleep ?? sleep;
  }

  private async assertRunActive(root: string, runId: string) {
    const run = await getExecutionRun(root, runId);
    if (!run || run.lifecycle !== 'RUNNING')
      throw new Error(`Execution Run ${runId} is not running.`);
  }

  private async persistSnapshot(
    root: string,
    runId: string,
    instance: VastAiInstance,
    phase?: ExecutionPhase,
  ) {
    return mutateExecutionRun(root, runId, (run) => {
      const lifecycle = run.remoteLifecycle ?? defaultLifecycle();
      if (lifecycle.initialStatus == null) lifecycle.initialStatus = instance.status;
      lifecycle.latest = snapshot(instance);
      lifecycle.restoredInitialState = false;
      lifecycle.finalizedAt = null;
      run.remoteLifecycle = lifecycle;
      if (phase) run.phase = phase;
    });
  }

  async prepare(root: string, runId: string) {
    const run = await getExecutionRun(root, runId);
    if (!run) throw new Error(`Execution Run ${runId} was not found.`);
    if (
      run.executionTarget !== 'remote' ||
      run.remote?.provider !== 'vastai' ||
      !Number.isInteger(run.remote.instanceId) ||
      Number(run.remote.instanceId) < 1
    )
      throw new Error('Execution Run has no selected Vast.ai Instance.');
    const instanceId = Number(run.remote.instanceId);
    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'CLOUD_INSTANCE_RESOLVING';
      current.remoteLifecycle = current.remoteLifecycle ?? defaultLifecycle();
    });

    let current = await this.client.getInstance(instanceId);
    if (current.id !== instanceId)
      throw new Error(
        `Vast.ai returned Instance ${current.id} while ${instanceId} was requested. Silent fallback is not allowed.`,
      );
    const existing = await getExecutionRun(root, runId);
    const initialStatus: CloudInstanceStatus =
      existing?.remoteLifecycle?.initialStatus ?? current.status;
    await this.persistSnapshot(root, runId, current, 'CLOUD_INSTANCE_RESOLVING');

    let startRequestedThisPrepare = false;
    const requestStartIfNeeded = async () => {
      if (current.status !== 'stopped' || initialStatus !== 'stopped' || startRequestedThisPrepare)
        return;
      await mutateExecutionRun(root, runId, (state) => {
        const lifecycle = state.remoteLifecycle ?? defaultLifecycle();
        lifecycle.startedByBatchStudio = true;
        lifecycle.initialStatus = initialStatus;
        state.remoteLifecycle = lifecycle;
        state.phase = 'CLOUD_INSTANCE_STARTING';
      });
      startRequestedThisPrepare = true;
      await this.assertRunActive(root, runId);
      await this.client.requestStartInstance(instanceId);
      await mutateExecutionRun(root, runId, (state) => {
        const lifecycle = state.remoteLifecycle ?? defaultLifecycle();
        lifecycle.startRequestedAt = new Date().toISOString();
        state.remoteLifecycle = lifecycle;
      });
    };
    await requestStartIfNeeded();

    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      await this.assertRunActive(root, runId);
      if (current.id !== instanceId)
        throw new Error(
          `Vast.ai returned Instance ${current.id} while ${instanceId} was requested. Silent fallback is not allowed.`,
        );
      if (unavailable(current))
        throw new Error(
          `Vast.ai Instance ${instanceId} entered ${current.status}: ${statusDetail(current)}`,
        );
      if (current.status === 'scheduling') {
        await this.persistSnapshot(root, runId, current, 'CLOUD_INSTANCE_STARTING');
        throw new Error(
          `Vast.ai Instance ${instanceId} is scheduling; Execution Run cannot continue.`,
        );
      }
      if (current.status === 'running' && current.sshHost && current.sshPort) {
        await this.persistSnapshot(root, runId, current, 'CLOUD_INSTANCE_READY');
        await mutateExecutionRun(root, runId, (state) => {
          if (state.remoteLifecycle) state.remoteLifecycle.startRequestedAt = null;
        });
        return current;
      }
      if (current.status === 'stopped' && initialStatus !== 'stopped') {
        throw new Error(
          `Vast.ai Instance ${instanceId} became stopped while its initial state was ${initialStatus}.`,
        );
      }
      if (Date.now() >= deadline)
        throw new Error(
          `Vast.ai Instance ${instanceId} did not become running with a public SSH endpoint before timeout.`,
        );
      await this.persistSnapshot(root, runId, current, 'CLOUD_INSTANCE_STARTING');
      await this.sleepImpl(this.pollMs);
      await this.assertRunActive(root, runId);
      current = await this.client.getInstance(instanceId);
      await requestStartIfNeeded();
    }
  }

  async finalize(root: string, runId: string) {
    const run = await getExecutionRun(root, runId);
    if (
      !run ||
      run.executionTarget !== 'remote' ||
      run.remote?.provider !== 'vastai' ||
      !Number.isInteger(run.remote.instanceId) ||
      Number(run.remote.instanceId) < 1
    )
      return;
    const lifecycle = run.remoteLifecycle;
    if (
      run.lifecycle === 'PAUSED' ||
      (run.lifecycle === 'RUNNING' && run.phase !== 'CLOUD_INSTANCE_FINALIZING')
    )
      return;
    if (!lifecycle || lifecycle.initialStatus == null || lifecycle.finalizedAt) return;
    const instanceId = Number(run.remote.instanceId),
      phaseBefore = run.phase,
      // A finalize failure occurs after generation/retrieval completed. Retrying
      // this failure must stop the same instance, not restore its initial state.
      stopForCompletedRun =
        run.lifecycle === 'COMPLETED' ||
        run.phase === 'CLOUD_INSTANCE_FINALIZING' ||
        run.error?.code === 'REMOTE_INSTANCE_FINALIZE_FAILED',
      restoreStartedInstance =
        lifecycle.restorePolicy === 'restore-if-started' &&
        lifecycle.startedByBatchStudio &&
        lifecycle.initialStatus === 'stopped';
    if (!stopForCompletedRun && !restoreStartedInstance) {
      await mutateExecutionRun(root, runId, (current) => {
        const state = current.remoteLifecycle ?? defaultLifecycle();
        state.restoredInitialState = true;
        state.finalizedAt = new Date().toISOString();
        current.remoteLifecycle = state;
      });
      return;
    }

    await mutateExecutionRun(root, runId, (current) => {
      current.phase = 'CLOUD_INSTANCE_FINALIZING';
    });
    let current = await this.client.getInstance(instanceId);
    if (current.id !== instanceId)
      throw new Error(
        `Vast.ai returned Instance ${current.id} while ${instanceId} was requested. Silent fallback is not allowed.`,
      );
    await this.persistSnapshot(root, runId, current, 'CLOUD_INSTANCE_FINALIZING');
    if (current.status !== 'stopped') await this.client.stopInstance(instanceId);
    // A successful stop API response only acknowledges the request; confirm the
    // provider has actually transitioned to stopped before recording finalization.
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      current = await this.client.getInstance(instanceId);
      if (current.id !== instanceId)
        throw new Error(
          `Vast.ai returned Instance ${current.id} while ${instanceId} was requested. Silent fallback is not allowed.`,
        );
      await this.persistSnapshot(root, runId, current, 'CLOUD_INSTANCE_FINALIZING');
      if (current.status === 'stopped') break;
      if (current.status === 'scheduling' || unavailable(current))
        throw new Error(
          `Vast.ai Instance ${instanceId} is ${current.status} during finalization; stopping is not confirmed.`,
        );
      if (Date.now() >= deadline)
        throw new Error(
          `Vast.ai Instance ${instanceId} did not confirm stopped before the finalization deadline.`,
        );
      await this.sleepImpl(this.pollMs);
    }
    await mutateExecutionRun(root, runId, (state) => {
      const next = state.remoteLifecycle ?? defaultLifecycle();
      next.latest = snapshot(current);
      next.restoredInitialState = lifecycle.initialStatus === 'stopped';
      next.finalizedAt = new Date().toISOString();
      state.remoteLifecycle = next;
      state.phase = phaseBefore;
    });
  }
}
