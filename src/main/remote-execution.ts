import path from 'node:path';
import type { ExecutionRun } from '../shared/types.js';
import { readJson } from './fs-utils.js';
import { enumerateSceneBranches, sliceSceneBranchGraph } from './local-execution.js';
import { getExecutionRun, mutateExecutionRun, recordExecutionEvidence } from './execution-run.js';
import type { ApiGraph } from './workflow-api.js';
import type { RemoteControlPlane } from './remote-control-plane.js';

type RemoteSequenceState={
  version?:number;
  runId?:string;
  status?:'running'|'interrupting'|'paused'|'interrupted'|'completed'|'failed';
  current?:{branchId?:string|null;leafId?:string|null;index?:number;promptId?:string|null};
  completed?:Record<string,number>;
  overallCompleted?:number;
  overallTotal?:number;
  promptIds?:string[];
  artifact?:{outputPrefix?:string;capturedAt?:string};
  error?:{code?:string;message?:string}|null;
};
type WorkerSequenceResponse={state?:RemoteSequenceState;alreadyRunning?:boolean};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

function asResponse(value:unknown):WorkerSequenceResponse{
  return value&&typeof value==='object'&&!Array.isArray(value)?value as WorkerSequenceResponse:{};
}
function safeError(error:unknown){return error instanceof Error?error.message:String(error)}
function applyRemoteState(run:ExecutionRun,state:RemoteSequenceState){
  const completed=state.completed??{};
  for(const branch of run.progress.branches){
    const next=Math.max(0,Math.min(branch.total,Number(completed[branch.branchId]??branch.completed)));
    branch.completed=next;
    branch.state=next>=branch.total?'completed':(state.current?.branchId===branch.branchId?'running':branch.state==='failed'?'failed':'pending');
  }
  run.progress.overall.completed=Math.max(0,Math.min(run.progress.overall.total,Number(state.overallCompleted??run.progress.overall.completed)));
  run.current={
    branchId:state.current?.branchId??null,
    leafId:state.current?.leafId??null,
    promptId:state.current?.promptId??null
  };
  for(const id of state.promptIds??[])if(id&&!run.promptIds.includes(id))run.promptIds.push(id);
}
export class RemoteExecutionService {
  private readonly workers=new Map<string,Promise<void>>();
  constructor(private readonly remote:RemoteControlPlane){}
  start(root:string,runId:string){
    if(this.workers.has(runId))return;
    const task=this.execute(root,runId).catch(async error=>{
      await mutateExecutionRun(root,runId,run=>{
        const failure={code:'REMOTE_EXECUTION_FAILED',message:safeError(error),phase:run.phase,at:new Date().toISOString(),retryable:true};
        run.error=failure;run.errorHistory.push(failure);run.lifecycle='FAILED';run.controls.scheduling='STOPPED';
      });
    }).finally(()=>this.workers.delete(runId));
    this.workers.set(runId,task);
  }
  async stopScheduling(root:string,runId:string){
    try{await this.remote.requestWorker(root,runId,'stop_scene_sequence');return true}catch{return false}
  }
  async forceInterrupt(root:string,runId:string){
    const response=await this.remote.requestWorker(root,runId,'force_interrupt_sequence',{comfyEndpoint:'http://127.0.0.1:8188'});
    const result=asResponse(response.response) as WorkerSequenceResponse&{interrupted?:boolean};
    if(result.interrupted)await mutateExecutionRun(root,runId,run=>{run.controls.interrupt='INTERRUPTED'});
    return Boolean(result.interrupted);
  }
  private async syncState(root:string,runId:string,state:RemoteSequenceState){
    return mutateExecutionRun(root,runId,run=>{applyRemoteState(run,state)});
  }
  private async waitExisting(root:string,runId:string){
    for(;;){
      const status=await this.remote.reconcile(root,runId);
      const state=asResponse(status.response).state??(status.response as any)?.state as RemoteSequenceState|undefined;
      if(state)await this.syncState(root,runId,state);
      if(state?.status&&state.status!=='running'&&state.status!=='interrupting')return state;
      await sleep(750);
    }
  }
  private async execute(root:string,runId:string){
    let run=await getExecutionRun(root,runId);
    if(!run||run.executionTarget!=='remote'||run.lifecycle!=='RUNNING')return;
    const graph=await readJson<ApiGraph>(path.join(root,run.snapshot.workflow.apiPath));
    const workflow=await readJson<unknown>(path.join(root,run.snapshot.workflow.uiPath));
    if(!graph||!workflow)throw new Error('Execution workflow snapshot files are missing.');
    const bindings=enumerateSceneBranches(graph,run);
    const branches=bindings.map(binding=>({
      branchId:binding.branchId,
      leafIds:binding.leafIds,
      expandNodeId:binding.expandNodeId,
      graph:sliceSceneBranchGraph(graph,binding.expandNodeId)
    }));
    await mutateExecutionRun(root,runId,current=>{current.phase='WORKFLOW_PREPARING';current.error=null;});
    run=await getExecutionRun(root,runId);if(!run)return;
    const payload={
      runId,
      projectId:run.projectId,
      outputPrefix:`BatchStudio/${run.projectId}`,
      comfyEndpoint:'http://127.0.0.1:8188',
      workflow,
      branches
    };
    await mutateExecutionRun(root,runId,current=>{current.phase='EXECUTING'});
    let response=asResponse((await this.remote.requestWorker(root,runId,'run_scene_sequence',payload)).response);
    let state=response.state;
    if(response.alreadyRunning)state=await this.waitExisting(root,runId);
    if(!state){
      const reconciled=await this.remote.reconcile(root,runId);
      state=(reconciled.response as any)?.state as RemoteSequenceState|undefined;
    }
    if(!state)throw new Error('Remote Worker returned no sequence state.');
    await this.syncState(root,runId,state);
    if(state.status==='paused'){
      await mutateExecutionRun(root,runId,current=>{current.lifecycle='PAUSED';current.controls.scheduling='STOPPED';current.current.promptId=null;});
      return;
    }
    if(state.status==='interrupted'){
      await mutateExecutionRun(root,runId,current=>{current.lifecycle='INTERRUPTED';current.controls.scheduling='STOPPED';current.controls.interrupt='INTERRUPTED';current.current.promptId=null;});
      return;
    }
    if(state.status==='failed')throw new Error(state.error?.message||state.error?.code||'Remote sequence failed.');
    if(state.status!=='completed')throw new Error(`Remote sequence ended in unexpected state: ${state.status??'unknown'}`);
    await mutateExecutionRun(root,runId,current=>{current.phase='EXECUTION_COMPLETED'});
    const latest=await getExecutionRun(root,runId);if(!latest)return;
    if(!latest.evidence.some(item=>item.kind==='EXECUTION_COMPLETED'&&item.scope==='remote-generation')){
      await recordExecutionEvidence(root,runId,{kind:'EXECUTION_COMPLETED',scope:'remote-generation',data:{
        images:Number(state.overallCompleted??latest.progress.overall.completed),
        outputPrefix:state.artifact?.outputPrefix??`BatchStudio/${latest.projectId}`,
        baselineCapturedAt:state.artifact?.capturedAt??null
      }});
    }
    await mutateExecutionRun(root,runId,current=>{current.phase='COMPLETED';current.lifecycle='COMPLETED';current.completedAt=new Date().toISOString();current.current={branchId:null,leafId:null,promptId:null};current.controls.scheduling='STOPPED';});
  }
}
