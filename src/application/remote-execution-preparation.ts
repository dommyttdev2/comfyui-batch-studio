import type { ExecutionRun } from '../domain/artifact-types.js';
export interface RemoteExecutionPreparationPorts {
  githubPat(): Promise<string>;
  remoteLifecycle(): { prepare(root: string, id: string): Promise<unknown> };
  remoteExecutor(): {
    connect(root: string, id: string): Promise<unknown>;
    disconnect(root: string, id: string): void;
  };
  remoteBootstrap(): {
    prepare(root: string, id: string, config: { githubToken: string }): Promise<unknown>;
  };
  remoteStager(): { stage(root: string, id: string): Promise<unknown> };
  remoteImageExecutor(): { start(root: string, id: string): Promise<unknown> };
  getExecutionRun(root: string, id: string): Promise<ExecutionRun | null>;
  mutateExecutionRun(
    root: string,
    id: string,
    update: (run: ExecutionRun) => void,
  ): Promise<ExecutionRun>;
  finalizeRemoteInstance(root: string, id: string): Promise<unknown>;
  safeExecutionError(error: unknown): string;
  now(): string;
}
export async function prepareRemoteExecution(
  ports: RemoteExecutionPreparationPorts,
  root: string,
  runId: string,
) {
  const {
    githubPat,
    remoteLifecycle,
    remoteExecutor,
    remoteBootstrap,
    remoteStager,
    remoteImageExecutor,
    getExecutionRun,
    mutateExecutionRun,
    finalizeRemoteInstance,
    safeExecutionError,
    now,
  } = ports;
  try {
    const githubToken = await githubPat();
    await remoteLifecycle().prepare(root, runId);
    await remoteExecutor().connect(root, runId);
    await remoteBootstrap().prepare(root, runId, {
      githubToken,
    });
    await remoteStager().stage(root, runId);
    await remoteImageExecutor().start(root, runId);
    const settled = await getExecutionRun(root, runId);
    if (settled?.lifecycle === 'DISCARDED') await finalizeRemoteInstance(root, runId);
  } catch (error) {
    const current = await getExecutionRun(root, runId);
    if (current?.lifecycle === 'PAUSED' || current?.lifecycle === 'INTERRUPTED') {
      remoteExecutor().disconnect(root, runId);
      return;
    }
    if (current?.lifecycle === 'DISCARDED') {
      await finalizeRemoteInstance(root, runId);
      remoteExecutor().disconnect(root, runId);
      return;
    }
    if (current?.lifecycle === 'FAILED' && current.error?.code === 'REMOTE_INSTANCE_REPLACED') {
      await finalizeRemoteInstance(root, runId);
      remoteExecutor().disconnect(root, runId);
      return;
    }
    await mutateExecutionRun(root, runId, (r) => {
      const modelPhase =
        r.phase === 'REMOTE_MODELS_CHECKING' || r.phase === 'REMOTE_MODELS_DOWNLOADING';
      const bootstrapPhase = [
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
      ].includes(r.phase);
      const lifecyclePhase = [
        'CLOUD_INSTANCE_RESOLVING',
        'CLOUD_INSTANCE_STARTING',
        'CLOUD_INSTANCE_READY',
        'CLOUD_INSTANCE_FINALIZING',
      ].includes(r.phase);
      const code = lifecyclePhase
        ? 'REMOTE_INSTANCE_LIFECYCLE_FAILED'
        : modelPhase
          ? 'REMOTE_MODEL_STAGING_FAILED'
          : bootstrapPhase
            ? 'REMOTE_ENVIRONMENT_BOOTSTRAP_FAILED'
            : 'REMOTE_CONTROL_PLANE_FAILED';
      const e = {
        code,
        message: safeExecutionError(error),
        phase: r.phase,
        at: now(),
        retryable: true,
      };
      r.error = e;
      r.errorHistory.push(e);
      r.lifecycle = 'FAILED';
      r.controls.scheduling = 'STOPPED';
    });
    await finalizeRemoteInstance(root, runId);
    remoteExecutor().disconnect(root, runId);
  }
}
