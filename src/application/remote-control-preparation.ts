import type { VastAiSshEndpoint } from '../domain/integration-types.js';
import type { RemotePreparationStore } from './remote-environment-bootstrap.js';
export interface RemoteConnectionPorts<Session extends { close(): void }, Deployment>
  extends RemotePreparationStore {
  resolveEndpoint(instanceId: number): Promise<VastAiSshEndpoint>;
  connect(endpoint: {
    host: string;
    port: number;
    user: string;
    privateKeyPath: string;
  }): Promise<Session>;
  deploy(session: Session, directory: string, runId: string): Promise<Deployment>;
  request(session: Session, deployment: Deployment, op: string): Promise<{ response: unknown }>;
  install(
    projectId: string,
    runId: string,
    session: Session,
    deployment: Deployment,
    endpoint: VastAiSshEndpoint,
  ): void;
}
export async function connectRemoteControlPlane<Session extends { close(): void }, Deployment>(
  ports: RemoteConnectionPorts<Session, Deployment>,
  root: string,
  runId: string,
) {
  const run = await ports.load(root, runId);
  if (
    !run ||
    run.runId !== runId ||
    run.executionTarget !== 'remote' ||
    run.remote?.provider !== 'vastai' ||
    !run.remote.instanceId
  )
    throw new Error('Remote Vast.ai Execution Run is required.');
  if (run.lifecycle !== 'RUNNING')
    throw new Error(`Execution Run ${runId} is not running (${run.lifecycle}).`);
  await ports.mutate(root, runId, (r) => {
    r.phase = 'CLOUD_INSTANCE_RESOLVING';
  });
  const endpoint = await ports.resolveEndpoint(run.remote.instanceId);
  if (endpoint.provider !== 'vastai' || endpoint.instanceId !== run.remote.instanceId)
    throw new Error('Remote endpoint identity mismatch.');
  await ports.mutate(root, runId, (r) => {
    r.phase = 'SSH_CONNECTING';
  });
  const session = await ports.connect({
    host: endpoint.host,
    port: endpoint.port,
    user: endpoint.user,
    privateKeyPath: endpoint.privateKeyPath,
  });
  try {
    await ports.mutate(root, runId, (r) => {
      if (r.lifecycle !== 'RUNNING') throw new Error('Remote preparation was stopped.');
      r.phase = 'SSH_CONNECTED';
    });
    await ports.mutate(root, runId, (r) => {
      r.phase = 'REMOTE_WORKER_PREPARING';
    });
    const deployment = await ports.deploy(session, endpoint.comfyUiDirectory, runId);
    const health = await ports.request(session, deployment, 'health');
    if (!(health.response as any)?.ok) throw new Error('REMOTE_WORKER_HEALTH_FAILED');
    await ports.mutate(root, runId, (r) => {
      if (r.lifecycle !== 'RUNNING') throw new Error('Remote preparation was stopped.');
      r.phase = 'REMOTE_ENVIRONMENT_CHECKING';
    });
    ports.install(root, runId, session, deployment, endpoint);
    return {
      endpoint: { host: endpoint.host, port: endpoint.port, user: endpoint.user },
      deployment,
      health: health.response,
    };
  } catch (error) {
    session.close();
    throw error;
  }
}
