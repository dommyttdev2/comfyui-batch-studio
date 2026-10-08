import { connectRemoteControlPlane } from '../application/remote-control-preparation.js';
import { assertRemoteRequestAllowed } from '../domain/remote-request-policy.js';
import type { VastAiSshEndpoint } from '../shared/types.js';
import { getExecutionRun, mutateExecutionRun } from './execution-run.js';
import { VerifiedSshClient, type VerifiedSshSession } from './ssh-client.js';
import {
  RemoteWorkerClient,
  RemoteWorkerRequestError,
  type WorkerEventHandler,
} from './remote-worker.js';

interface RemoteHandle {
  session: VerifiedSshSession;
  deployment: {
    runDir: string;
    workerPath: string;
    modelsRoot: string;
    comfyRoot: string;
    localSha256: string;
    remoteSha256: string;
  };
  endpoint: VastAiSshEndpoint;
}
type EndpointResolver = (instanceId: number) => Promise<VastAiSshEndpoint>;
const LOCAL_COMFY_OPS = new Set([
  'run_image_sequence',
  'force_interrupt_sequence',
  'reconcile_submission',
]);
export function remoteWorkerPayload(
  endpoint: VastAiSshEndpoint,
  op: string,
  payload: Record<string, unknown>,
) {
  return LOCAL_COMFY_OPS.has(op)
    ? { ...payload, comfyEndpoint: `http://127.0.0.1:${endpoint.comfyUiPort}` }
    : { ...payload };
}

export class RemoteControlPlane {
  private readonly handles = new Map<string, RemoteHandle>();
  constructor(
    private readonly ssh: VerifiedSshClient,
    private readonly worker: RemoteWorkerClient,
    private readonly resolveEndpoint: EndpointResolver,
  ) {}
  private key(root: string, runId: string) {
    return `${root}\0${runId}`;
  }
  async connect(root: string, runId: string) {
    return connectRemoteControlPlane(
      {
        load: getExecutionRun,
        mutate: mutateExecutionRun,
        resolveEndpoint: this.resolveEndpoint,
        connect: (input) => this.ssh.connect(input),
        deploy: (session, directory, id) => this.worker.deploy(session, directory, id),
        request: (session, deployment, op) => this.worker.request(session, deployment, op),
        install: (root, id, session, deployment, endpoint) => {
          const key = this.key(root, id);
          this.handles.get(key)?.session.close();
          this.handles.set(key, { session, deployment, endpoint });
        },
      },
      root,
      runId,
    );
  }
  private async requestWithReconnect(
    root: string,
    runId: string,
    op: string,
    payload: Record<string, unknown> = {},
    onEvent?: WorkerEventHandler,
  ) {
    const run = await getExecutionRun(root, runId);
    assertRemoteRequestAllowed(run, runId);
    const key = this.key(root, runId);
    let handle = this.handles.get(key);
    if (!handle) {
      await this.connect(root, runId);
      handle = this.handles.get(key);
    }
    if (!handle) throw new Error('Remote session unavailable');
    try {
      return await this.worker.request(
        handle.session,
        handle.deployment,
        op,
        remoteWorkerPayload(handle.endpoint, op, payload),
        onEvent,
      );
    } catch (firstError) {
      if (firstError instanceof RemoteWorkerRequestError) throw firstError;
      handle.session.close();
      this.handles.delete(key);
      await this.connect(root, runId);
      const reconnected = this.handles.get(key);
      if (!reconnected) throw firstError;
      return this.worker.request(
        reconnected.session,
        reconnected.deployment,
        op,
        remoteWorkerPayload(reconnected.endpoint, op, payload),
        onEvent,
      );
    }
  }
  async requestWorker(
    root: string,
    runId: string,
    op: string,
    payload: Record<string, unknown> = {},
    onEvent?: WorkerEventHandler,
  ) {
    return this.requestWithReconnect(root, runId, op, payload, onEvent);
  }
  async reconcile(root: string, runId: string) {
    return this.requestWithReconnect(root, runId, 'status');
  }
  async writeState(root: string, runId: string, state: Record<string, unknown>) {
    return this.requestWithReconnect(root, runId, 'write_state', { state });
  }
  disconnect(root: string, runId: string) {
    const key = this.key(root, runId),
      handle = this.handles.get(key);
    handle?.session.close();
    this.handles.delete(key);
  }
}
