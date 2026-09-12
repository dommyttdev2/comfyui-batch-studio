import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionEvidence, ExecutionEvidenceKind, ExecutionRun } from '../shared/types.js';
import { exists, readJson } from './fs-utils.js';
import { enumerateSceneBranches, sliceSceneBranchGraph } from './local-execution.js';
import { getExecutionRun, mutateExecutionRun, recordExecutionEvidence, validatedExecutionEvidence } from './execution-run.js';
import { readProjectMeta } from './project-meta.js';
import type { R2Manager } from './r2-manager.js';
import { R2_SINGLE_PUT_LIMIT } from './r2-manager.js';
import { RemoteWorkerRequestError } from './remote-worker.js';
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
type PackageEvidence={artifactCount:number;size:number;sha256:string;manifestSha256:string;outputPrefix:string};
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

class ArtifactPipelineError extends Error {
  constructor(public readonly code:string,message:string){super(message);this.name='ArtifactPipelineError';}
}
function asResponse(value:unknown):WorkerSequenceResponse{return value&&typeof value==='object'&&!Array.isArray(value)?value as WorkerSequenceResponse:{};}
function safeError(error:unknown){return error instanceof Error?error.message:String(error)}
function safeProjectPart(value:string){return value.replace(/[^A-Za-z0-9._-]+/g,'_').replace(/^\.+|\.+$/g,'')||'project'}
function latestEvidence(run:ExecutionRun,kind:ExecutionEvidenceKind,scope?:string):ExecutionEvidence|null{
  const rows=validatedExecutionEvidence(run).valid.filter(item=>item.kind===kind&&(!scope||item.scope===scope));
  return rows.at(-1)??null;
}
async function sha256File(file:string){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}
async function localMatches(file:string,size:number,sha256:string){
  if(!(await exists(file)))return false;
  const info=await stat(file);if(info.size!==size)return false;
  return (await sha256File(file))===sha256;
}
function applyRemoteState(run:ExecutionRun,state:RemoteSequenceState){
  const completed=state.completed??{};
  for(const branch of run.progress.branches){
    const next=Math.max(0,Math.min(branch.total,Number(completed[branch.branchId]??branch.completed)));
    branch.completed=next;
    branch.state=next>=branch.total?'completed':(state.current?.branchId===branch.branchId?'running':branch.state==='failed'?'failed':'pending');
  }
  run.progress.overall.completed=Math.max(0,Math.min(run.progress.overall.total,Number(state.overallCompleted??run.progress.overall.completed)));
  run.current={branchId:state.current?.branchId??null,leafId:state.current?.leafId??null,promptId:state.current?.promptId??null};
  for(const id of state.promptIds??[])if(id&&!run.promptIds.includes(id))run.promptIds.push(id);
}

export class RemoteExecutionService {
  private readonly workers=new Map<string,Promise<void>>();
  constructor(private readonly remote:RemoteControlPlane,private readonly r2:R2Manager){}
  start(root:string,runId:string){
    if(this.workers.has(runId))return;
    const task=this.execute(root,runId).catch(async error=>{
      await mutateExecutionRun(root,runId,run=>{
        const code=error instanceof ArtifactPipelineError?error.code:'REMOTE_EXECUTION_FAILED';
        const failure={code,message:safeError(error),phase:run.phase,at:new Date().toISOString(),retryable:true};
        run.error=failure;run.errorHistory.push(failure);run.lifecycle='FAILED';run.controls.scheduling='STOPPED';
      });
    }).finally(()=>{this.remote.disconnect(root,runId);this.workers.delete(runId)});
    this.workers.set(runId,task);
  }
  async stopScheduling(root:string,runId:string){try{await this.remote.requestWorker(root,runId,'stop_scene_sequence');return true}catch{return false}}
  async forceInterrupt(root:string,runId:string){
    const response=await this.remote.requestWorker(root,runId,'force_interrupt_sequence',{comfyEndpoint:'http://127.0.0.1:8188'});
    const result=asResponse(response.response) as WorkerSequenceResponse&{interrupted?:boolean};
    if(result.interrupted)await mutateExecutionRun(root,runId,run=>{run.controls.interrupt='INTERRUPTED'});
    return Boolean(result.interrupted);
  }
  private async syncState(root:string,runId:string,state:RemoteSequenceState){return mutateExecutionRun(root,runId,run=>{applyRemoteState(run,state)});}
  private async waitExisting(root:string,runId:string){
    for(;;){
      const status=await this.remote.reconcile(root,runId);
      const state=asResponse(status.response).state??(status.response as any)?.state as RemoteSequenceState|undefined;
      if(state)await this.syncState(root,runId,state);
      if(state?.status&&state.status!=='running'&&state.status!=='interrupting')return state;
      await sleep(750);
    }
  }
  private async runGeneration(root:string,runId:string,run:ExecutionRun){
    const graph=await readJson<ApiGraph>(path.join(root,run.snapshot.workflow.apiPath));
    const workflow=await readJson<unknown>(path.join(root,run.snapshot.workflow.uiPath));
    if(!graph||!workflow)throw new Error('Execution workflow snapshot files are missing.');
    const bindings=enumerateSceneBranches(graph,run);
    const branches=bindings.map(binding=>({branchId:binding.branchId,leafIds:binding.leafIds,expandNodeId:binding.expandNodeId,graph:sliceSceneBranchGraph(graph,binding.expandNodeId)}));
    const outputPrefix=`BatchStudio/${safeProjectPart(run.projectId)}/${runId}`;
    await mutateExecutionRun(root,runId,current=>{current.phase='WORKFLOW_PREPARING';current.error=null;});
    await mutateExecutionRun(root,runId,current=>{current.phase='EXECUTING'});
    let response=asResponse((await this.remote.requestWorker(root,runId,'run_scene_sequence',{runId,projectId:run.projectId,outputPrefix,comfyEndpoint:'http://127.0.0.1:8188',workflow,branches})).response);
    let state=response.state;if(response.alreadyRunning)state=await this.waitExisting(root,runId);
    if(!state){const reconciled=await this.remote.reconcile(root,runId);state=(reconciled.response as any)?.state as RemoteSequenceState|undefined;}
    if(!state)throw new Error('Remote Worker returned no sequence state.');
    await this.syncState(root,runId,state);
    if(state.status==='paused'){await mutateExecutionRun(root,runId,current=>{current.lifecycle='PAUSED';current.controls.scheduling='STOPPED';current.current.promptId=null;});return false;}
    if(state.status==='interrupted'){await mutateExecutionRun(root,runId,current=>{current.lifecycle='INTERRUPTED';current.controls.scheduling='STOPPED';current.controls.interrupt='INTERRUPTED';current.current.promptId=null;});return false;}
    if(state.status==='failed')throw new Error(state.error?.message||state.error?.code||'Remote sequence failed.');
    if(state.status!=='completed')throw new Error(`Remote sequence ended in unexpected state: ${state.status??'unknown'}`);
    const latest=await getExecutionRun(root,runId);if(!latest)return false;
    const completed=Number(state.overallCompleted??latest.progress.overall.completed),expected=latest.progress.overall.total;
    if(completed!==expected)throw new ArtifactPipelineError('REMOTE_ARTIFACT_COUNT_MISMATCH',`Remote generation completed ${completed} artifacts but ${expected} were expected.`);
    await mutateExecutionRun(root,runId,current=>{current.phase='EXECUTION_COMPLETED'});
    if(!latestEvidence(latest,'EXECUTION_COMPLETED','remote-generation')){
      await recordExecutionEvidence(root,runId,{kind:'EXECUTION_COMPLETED',scope:'remote-generation',data:{images:completed,expectedImages:expected,outputPrefix:state.artifact?.outputPrefix??outputPrefix,baselineCapturedAt:state.artifact?.capturedAt??null}});
    }
    return true;
  }
  private packageFromEvidence(evidence:ExecutionEvidence|null):PackageEvidence|null{
    if(!evidence)return null;
    const artifactCount=Number(evidence.data.artifactCount),size=Number(evidence.data.size),sha256=String(evidence.data.sha256??''),manifestSha256=String(evidence.data.manifestSha256??''),outputPrefix=String(evidence.data.outputPrefix??'');
    if(!Number.isSafeInteger(artifactCount)||artifactCount<0||!Number.isSafeInteger(size)||size<0||!/^[0-9a-f]{64}$/i.test(sha256)||!/^[0-9a-f]{64}$/i.test(manifestSha256)||!outputPrefix)return null;
    return {artifactCount,size,sha256:sha256.toLowerCase(),manifestSha256:manifestSha256.toLowerCase(),outputPrefix};
  }
  private async ensurePackage(root:string,runId:string){
    let run=await getExecutionRun(root,runId);if(!run)throw new Error('Execution Run was not found.');
    const existing=this.packageFromEvidence(latestEvidence(run,'PACKAGE_VERIFIED','remote-package'));if(existing)return existing;
    const execution=latestEvidence(run,'EXECUTION_COMPLETED','remote-generation');
    if(!execution)throw new ArtifactPipelineError('REMOTE_ARTIFACT_GENERATION_EVIDENCE_MISSING','Remote generation evidence is missing.');
    const expected=run.progress.overall.total,completed=Number(execution.data.images);
    if(completed!==expected)throw new ArtifactPipelineError('REMOTE_ARTIFACT_COUNT_MISMATCH',`Expected ${expected} generated artifacts but execution evidence reports ${completed}.`);
    await mutateExecutionRun(root,runId,current=>{current.phase='ARTIFACTS_COLLECTING'});
    await mutateExecutionRun(root,runId,current=>{current.phase='ARTIFACTS_PACKAGING'});
    const response=await this.remote.requestWorker(root,runId,'package_artifacts',{runId,expectedCount:expected});
    const value=response.response as any,artifactCount=Number(value?.artifactCount),size=Number(value?.package?.size),sha256=String(value?.package?.sha256??''),manifestSha256=String(value?.manifestSha256??''),outputPrefix=String(execution.data.outputPrefix??'');
    if(artifactCount!==expected)throw new ArtifactPipelineError('REMOTE_ARTIFACT_COUNT_MISMATCH',`Expected ${expected} packaged artifacts but found ${artifactCount}.`);
    if(!Number.isSafeInteger(size)||size<0||!/^[0-9a-f]{64}$/i.test(sha256)||!/^[0-9a-f]{64}$/i.test(manifestSha256))throw new ArtifactPipelineError('REMOTE_ARTIFACT_PACKAGE_INVALID','Remote Worker returned invalid package evidence.');
    await recordExecutionEvidence(root,runId,{kind:'PACKAGE_VERIFIED',scope:'remote-package',data:{artifactCount,expectedArtifactCount:expected,size,sha256:sha256.toLowerCase(),manifestSha256:manifestSha256.toLowerCase(),outputPrefix}});
    return {artifactCount,size,sha256:sha256.toLowerCase(),manifestSha256:manifestSha256.toLowerCase(),outputPrefix};
  }
  private async putWithFreshUrl(root:string,runId:string,offset:number,length:number,urlFactory:()=>Promise<{url:string;headers?:Record<string,string>}>){
    let last:unknown;
    for(let attempt=0;attempt<3;attempt++){
      const signed=await urlFactory();
      try{return await this.remote.requestWorker(root,runId,'upload_artifact_package',{url:signed.url,headers:signed.headers??{},offset,length});}
      catch(error){
        last=error;
        const retryable=error instanceof RemoteWorkerRequestError&&(/^R2_UPLOAD_HTTP_(401|403|408|429|5\d\d)$/.test(error.code)||error.code==='R2_UPLOAD_NETWORK');
        if(!retryable||attempt===2)throw error;
      }
    }
    throw last;
  }
  private async uploadPackage(root:string,runId:string,pkg:PackageEvidence,bucket:string,key:string){
    await mutateExecutionRun(root,runId,current=>{current.phase='R2_UPLOAD_URL_ISSUED'});
    await mutateExecutionRun(root,runId,current=>{current.phase='R2_UPLOADING'});
    let mode:'single'|'multipart'='single';
    if(pkg.size<=R2_SINGLE_PUT_LIMIT){
      await this.putWithFreshUrl(root,runId,0,pkg.size,()=>this.r2.executionPutUrl(bucket,key,pkg.size,pkg.sha256,900));
    }else{
      mode='multipart';const session=await this.r2.beginExecutionMultipart(bucket,key,pkg.size,pkg.sha256),parts:Array<{PartNumber:number;ETag:string}>=[];
      try{
        for(let partNumber=1;partNumber<=session.partCount;partNumber++){
          const offset=(partNumber-1)*session.partSize,length=Math.min(session.partSize,pkg.size-offset);
          const sent=await this.putWithFreshUrl(root,runId,offset,length,()=>this.r2.executionMultipartPartUrl(bucket,key,session.uploadId,partNumber,900));
          const etag=String((sent.response as any)?.etag??'');if(!etag)throw new ArtifactPipelineError('R2_MULTIPART_ETAG_MISSING',`R2 multipart part ${partNumber} returned no ETag.`);
          parts.push({PartNumber:partNumber,ETag:etag});
        }
        await this.r2.completeExecutionMultipart(bucket,key,session.uploadId,parts);
      }catch(error){await this.r2.abortExecutionMultipart(bucket,key,session.uploadId).catch(()=>{});throw error;}
    }
    await mutateExecutionRun(root,runId,current=>{current.phase='R2_UPLOADED'});
    const metadata=await this.r2.objectMetadata(bucket,key);
    if(metadata.size!==pkg.size||metadata.sha256!==pkg.sha256)throw new ArtifactPipelineError('R2_OBJECT_VERIFY_FAILED',`R2 object verification failed (size/hash mismatch).`);
    await recordExecutionEvidence(root,runId,{kind:'R2_OBJECT_VERIFIED',scope:'remote-package',data:{bucket,key,size:pkg.size,sha256:pkg.sha256,uploadMode:mode}});
  }
  private async ensureR2Object(root:string,runId:string,pkg:PackageEvidence){
    const run=await getExecutionRun(root,runId);if(!run)throw new Error('Execution Run was not found.');
    const meta=await readProjectMeta(root),bucket=((process.env.BATCH_STUDIO_R2_BUCKET??'').trim()||(meta?.settings.r2Bucket?.trim()??''));
    if(!bucket)throw new ArtifactPipelineError('R2_BUCKET_REQUIRED','Remote artifact retrieval requires an R2 bucket.');
    const key=`batch-studio/executions/${safeProjectPart(run.projectId)}/${runId}/artifacts.zip`;
    const evidence=latestEvidence(run,'R2_OBJECT_VERIFIED','remote-package');
    if(evidence&&evidence.data.bucket===bucket&&evidence.data.key===key){
      try{const remote=await this.r2.objectMetadata(bucket,key);if(remote.size===pkg.size&&remote.sha256===pkg.sha256)return {bucket,key};}catch{}
    }
    await this.uploadPackage(root,runId,pkg,bucket,key);return {bucket,key};
  }
  private async ensureLocalFile(root:string,runId:string,pkg:PackageEvidence,bucket:string,key:string){
    let run=await getExecutionRun(root,runId);if(!run)throw new Error('Execution Run was not found.');
    const existing=latestEvidence(run,'LOCAL_FILE_VERIFIED','remote-package');
    if(existing&&Number(existing.data.size)===pkg.size&&String(existing.data.sha256)===pkg.sha256&&typeof existing.data.path==='string'&&await localMatches(String(existing.data.path),pkg.size,pkg.sha256))return String(existing.data.path);
    const meta=await readProjectMeta(root),base=(meta?.settings.artifactOutputPath?.trim()||path.join(root,'artifacts')),dir=path.join(base,'execution_runs',runId),finalPath=path.join(dir,`${runId}.zip`),partPath=finalPath+'.part';
    await mkdir(dir,{recursive:true});
    if(await localMatches(finalPath,pkg.size,pkg.sha256)){
      await recordExecutionEvidence(root,runId,{kind:'LOCAL_FILE_VERIFIED',scope:'remote-package',data:{path:finalPath,size:pkg.size,sha256:pkg.sha256,artifactCount:pkg.artifactCount}});return finalPath;
    }
    await rm(finalPath,{force:true}).catch(()=>{});await rm(partPath,{force:true}).catch(()=>{});
    await mutateExecutionRun(root,runId,current=>{current.phase='LOCAL_DOWNLOADING'});
    let last:unknown;
    for(let attempt=0;attempt<3;attempt++){
      try{await this.r2.downloadExecutionObject(bucket,key,partPath);last=null;break}
      catch(error){last=error;await rm(partPath,{force:true}).catch(()=>{});if(attempt<2)await sleep(250*(attempt+1));}
    }
    if(last)throw last;
    await mutateExecutionRun(root,runId,current=>{current.phase='LOCAL_VERIFYING'});
    const info=await stat(partPath),digest=await sha256File(partPath);
    if(info.size!==pkg.size||digest!==pkg.sha256){await rm(partPath,{force:true}).catch(()=>{});throw new ArtifactPipelineError('REMOTE_ARTIFACT_HASH_MISMATCH','Downloaded artifact package SHA-256 does not match the Remote package.');}
    await rename(partPath,finalPath);
    await recordExecutionEvidence(root,runId,{kind:'LOCAL_FILE_VERIFIED',scope:'remote-package',data:{path:finalPath,size:pkg.size,sha256:pkg.sha256,artifactCount:pkg.artifactCount}});
    return finalPath;
  }
  private async cleanup(root:string,runId:string,bucket:string,key:string){
    let run=await getExecutionRun(root,runId);if(!run)throw new Error('Execution Run was not found.');
    if(latestEvidence(run,'CLEANUP_COMPLETED','remote-artifacts'))return;
    await mutateExecutionRun(root,runId,current=>{current.phase='REMOTE_CLEANUP'});
    try{await this.remote.requestWorker(root,runId,'cleanup_artifacts');}catch(error){throw new ArtifactPipelineError('REMOTE_ARTIFACT_CLEANUP_FAILED',safeError(error));}
    try{if(await this.r2.objectExists(bucket,key))await this.r2.deleteExecutionObject(bucket,key);}catch(error){throw new ArtifactPipelineError('R2_ARTIFACT_CLEANUP_FAILED',safeError(error));}
    await recordExecutionEvidence(root,runId,{kind:'CLEANUP_COMPLETED',scope:'remote-artifacts',data:{remote:true,r2:true}});
  }
  private async collectArtifacts(root:string,runId:string){
    const pkg=await this.ensurePackage(root,runId);
    let run=await getExecutionRun(root,runId);if(!run)throw new Error('Execution Run was not found.');
    const local=latestEvidence(run,'LOCAL_FILE_VERIFIED','remote-package'),uploaded=latestEvidence(run,'R2_OBJECT_VERIFIED','remote-package');
    let object:{bucket:string;key:string};
    if(local&&uploaded&&Number(local.data.size)===pkg.size&&String(local.data.sha256)===pkg.sha256&&typeof uploaded.data.bucket==='string'&&typeof uploaded.data.key==='string'){
      object={bucket:uploaded.data.bucket,key:uploaded.data.key};
    }else object=await this.ensureR2Object(root,runId,pkg);
    await this.ensureLocalFile(root,runId,pkg,object.bucket,object.key);
    await this.cleanup(root,runId,object.bucket,object.key);
    await mutateExecutionRun(root,runId,current=>{current.phase='COMPLETED';current.lifecycle='COMPLETED';current.completedAt=new Date().toISOString();current.current={branchId:null,leafId:null,promptId:null};current.controls.scheduling='STOPPED';});
  }
  private async execute(root:string,runId:string){
    let run=await getExecutionRun(root,runId);if(!run||run.executionTarget!=='remote'||run.lifecycle!=='RUNNING')return;
    if(!latestEvidence(run,'EXECUTION_COMPLETED','remote-generation')){
      const completed=await this.runGeneration(root,runId,run);if(!completed)return;
    }
    run=await getExecutionRun(root,runId);if(!run||run.lifecycle!=='RUNNING')return;
    await this.collectArtifacts(root,runId);
  }
}
