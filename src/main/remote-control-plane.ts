import type { VastAiSshEndpoint } from '../shared/types.js';
import { getExecutionRun, mutateExecutionRun } from './execution-run.js';
import { VerifiedSshClient, type VerifiedSshSession } from './ssh-client.js';
import { RemoteWorkerClient } from './remote-worker.js';

interface RemoteHandle { session:VerifiedSshSession;deployment:{runDir:string;workerPath:string;localSha256:string;remoteSha256:string};endpoint:VastAiSshEndpoint; }
type EndpointResolver=(instanceId:number)=>Promise<VastAiSshEndpoint>;

export class RemoteControlPlane {
  private readonly handles=new Map<string,RemoteHandle>();
  constructor(private readonly ssh:VerifiedSshClient,private readonly worker:RemoteWorkerClient,private readonly resolveEndpoint:EndpointResolver){}
  private key(root:string,runId:string){return `${root}\0${runId}`;}
  async connect(root:string,runId:string){
    const run=await getExecutionRun(root,runId);if(!run||run.executionTarget!=='remote'||run.remote?.provider!=='vastai'||!run.remote.instanceId)throw new Error('Remote Vast.ai Execution Run is required.');
    await mutateExecutionRun(root,runId,r=>{r.phase='CLOUD_INSTANCE_RESOLVING'});const endpoint=await this.resolveEndpoint(run.remote.instanceId);
    await mutateExecutionRun(root,runId,r=>{r.phase='SSH_CONNECTING'});const session=await this.ssh.connect({host:endpoint.host,port:endpoint.port,user:endpoint.user,privateKeyPath:endpoint.privateKeyPath});
    await mutateExecutionRun(root,runId,r=>{r.phase='SSH_CONNECTED'});try{
      await mutateExecutionRun(root,runId,r=>{r.phase='REMOTE_WORKER_PREPARING'});const deployment=await this.worker.deploy(session,endpoint.comfyUiDirectory,runId);
      const health=await this.worker.request(session,deployment,'health');if(!(health.response as any)?.ok)throw new Error('REMOTE_WORKER_HEALTH_FAILED');
      const old=this.handles.get(this.key(root,runId));old?.session.close();this.handles.set(this.key(root,runId),{session,deployment,endpoint});
      await mutateExecutionRun(root,runId,r=>{r.phase='REMOTE_ENVIRONMENT_CHECKING'});return {endpoint:{host:endpoint.host,port:endpoint.port,user:endpoint.user},deployment,health:health.response};
    }catch(error){session.close();throw error;}
  }
  private async requestWithReconnect(root:string,runId:string,op:string,payload:Record<string,unknown>={}){const key=this.key(root,runId);let handle=this.handles.get(key);if(!handle){await this.connect(root,runId);handle=this.handles.get(key);}if(!handle)throw new Error('Remote session unavailable');try{return await this.worker.request(handle.session,handle.deployment,op,payload);}catch(firstError){handle.session.close();this.handles.delete(key);await this.connect(root,runId);const reconnected=this.handles.get(key);if(!reconnected)throw firstError;return this.worker.request(reconnected.session,reconnected.deployment,op,payload);}}
  async reconcile(root:string,runId:string){return this.requestWithReconnect(root,runId,'status');}
  async writeState(root:string,runId:string,state:Record<string,unknown>){return this.requestWithReconnect(root,runId,'write_state',{state});}
  disconnect(root:string,runId:string){const key=this.key(root,runId),handle=this.handles.get(key);handle?.session.close();this.handles.delete(key);}
}
