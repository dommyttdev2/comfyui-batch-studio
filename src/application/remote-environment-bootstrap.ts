import type {
  ExecutionRun,
  ExecutionEvidence,
  ExecutionEvidenceKind,
} from '../domain/artifact-types.js';
import type { WorkerEvent } from '../domain/remote-worker-contract.js';
export interface PreparationWorkerPort {
  requestWorker(
    projectId: string,
    runId: string,
    op: string,
    payload?: Record<string, unknown>,
  ): Promise<{ response: unknown; events?: WorkerEvent[] }>;
}
export interface RemotePreparationStore {
  load(projectId: string, runId: string): Promise<ExecutionRun | null>;
  mutate(
    projectId: string,
    runId: string,
    update: (run: ExecutionRun) => void,
  ): Promise<ExecutionRun>;
}
export interface RemoteBootstrapConfig {
  githubToken: string;
}

function responseRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function responseString(value: unknown, key: string) {
  const item = responseRecord(value)[key];
  if (typeof item !== 'string' || !item.trim())
    throw new Error(`REMOTE_COMFYUI_UPDATE_PROTOCOL_INVALID: missing ${key}`);
  return item;
}

export class RemoteEnvironmentBootstrap {
  constructor(
    private readonly remote: PreparationWorkerPort,
    private readonly ports: RemotePreparationStore,
  ) {}

  private async assertRunActive(root: string, runId: string) {
    const run = await this.ports.load(root, runId);
    if (!run || run.runId !== runId || run.lifecycle !== 'RUNNING')
      throw new Error(`Execution Run ${runId} is not running.`);
  }

  async prepare(root: string, runId: string, config: RemoteBootstrapConfig) {
    const githubToken = config.githubToken.trim();
    if (!githubToken) throw new Error('REMOTE_GITHUB_PAT_REQUIRED: GitHub PAT is not configured.');

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_DEPENDENCIES_INSTALLING';
      run.error = null;
    });
    const dependencies = await this.remote.requestWorker(root, runId, 'ensure_tools');

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_GITHUB_AUTHENTICATING';
    });
    const github = await this.remote.requestWorker(root, runId, 'github_auth', { githubToken });

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_COMFYUI_RELEASE_CHECKING';
    });
    const releaseCheck = await this.remote.requestWorker(root, runId, 'comfyui_release_check', {
      githubToken,
    });
    const releaseTag = responseString(releaseCheck.response, 'tag');

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_COMFYUI_RELEASE_FETCHING';
    });
    const releaseFetch = await this.remote.requestWorker(root, runId, 'comfyui_release_fetch', {
      githubToken,
      tag: releaseTag,
    });
    const releaseCommit = responseString(releaseFetch.response, 'commit');

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_COMFYUI_CHECKING_OUT';
    });
    const checkout = await this.remote.requestWorker(root, runId, 'comfyui_release_checkout', {
      commit: releaseCommit,
    });

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_COMFYUI_REQUIREMENTS_INSTALLING';
    });
    const requirements = await this.remote.requestWorker(
      root,
      runId,
      'comfyui_install_requirements',
    );

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_COMFYUI_MANAGER_CONFIGURING';
    });
    const manager = await this.remote.requestWorker(root, runId, 'comfyui_configure_manager');

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_COMFYUI_RESTARTING';
    });
    const restart = await this.remote.requestWorker(root, runId, 'restart_comfyui');

    await this.assertRunActive(root, runId);
    await this.ports.mutate(root, runId, (run) => {
      run.phase = 'REMOTE_ENVIRONMENT_READY';
    });
    return {
      dependencies: dependencies.response,
      github: github.response,
      comfyui: {
        releaseCheck: releaseCheck.response,
        releaseFetch: releaseFetch.response,
        checkout: checkout.response,
        requirements: requirements.response,
        manager: manager.response,
      },

      restart: restart.response,
    };
  }
}
