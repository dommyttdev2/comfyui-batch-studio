import type { RemoteCustomNodeRepository } from '../shared/types.js';
import { mutateExecutionRun } from './execution-run.js';
import type { RemoteControlPlane } from './remote-control-plane.js';

export interface RemoteBootstrapConfig {
  githubToken:string;
  customNodes:RemoteCustomNodeRepository[];
}

export class RemoteEnvironmentBootstrap {
  constructor(private readonly remote:RemoteControlPlane){}

  async prepare(root:string,runId:string,config:RemoteBootstrapConfig){
    const githubToken=config.githubToken.trim();
    if(!githubToken)throw new Error('REMOTE_GITHUB_PAT_REQUIRED: GitHub PAT is not configured.');

    await mutateExecutionRun(root,runId,run=>{run.phase='REMOTE_DEPENDENCIES_INSTALLING';run.error=null;});
    const dependencies=await this.remote.requestWorker(root,runId,'ensure_tools');

    await mutateExecutionRun(root,runId,run=>{run.phase='REMOTE_GITHUB_AUTHENTICATING';});
    const github=await this.remote.requestWorker(root,runId,'github_auth',{githubToken});

    await mutateExecutionRun(root,runId,run=>{run.phase='REMOTE_COMFYUI_UPDATING';});
    const comfyui=await this.remote.requestWorker(root,runId,'update_comfyui',{githubToken});

    await mutateExecutionRun(root,runId,run=>{run.phase='REMOTE_CUSTOM_NODES_SYNCING';});
    const customNodes=await this.remote.requestWorker(root,runId,'sync_custom_nodes',{githubToken,nodes:config.customNodes});

    await mutateExecutionRun(root,runId,run=>{run.phase='REMOTE_COMFYUI_RESTARTING';});
    const restart=await this.remote.requestWorker(root,runId,'restart_comfyui');

    await mutateExecutionRun(root,runId,run=>{run.phase='REMOTE_ENVIRONMENT_READY';});
    return {dependencies:dependencies.response,github:github.response,comfyui:comfyui.response,customNodes:customNodes.response,restart:restart.response};
  }
}
