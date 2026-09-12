const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-remote-lifecycle-'));
const compiled=path.join(runtime,'compiled');
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',compiled],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(compiled,'main',relative)).href);
const runId='11111111-1111-4111-8111-111111111111';

function instance(status,overrides={}){
  return {provider:'vastai',id:7,label:'test',status,rawStatus:status,intendedStatus:null,curState:null,statusMessage:null,gpuName:'RTX 4090',gpuCount:1,gpuRamMb:24576,hourlyCost:0.2,sshHost:null,sshPort:null,comfyUiPort:null,...overrides};
}
function ready(){return instance('running',{sshHost:'203.0.113.7',sshPort:42022,comfyUiPort:8188});}
function writeRun(root){
  fs.mkdirSync(path.join(root,'execution_runs'),{recursive:true});
  const now='2026-09-12T00:00:00.000Z';
  const run={schemaVersion:1,runId,projectId:'p',executionTarget:'remote',remote:{provider:'vastai',instanceId:7},remoteLifecycle:{initialStatus:null,startedByBatchStudio:false,latest:null,restorePolicy:'restore-if-started',restoredInitialState:false,finalizedAt:null},lifecycle:'RUNNING',phase:'CLOUD_INSTANCE_RESOLVING',controls:{scheduling:'ACTIVE',interrupt:'IDLE',stopSchedulingRequestedAt:null,forceInterruptRequestedAt:null},current:{branchId:null,leafId:null,promptId:null},progress:{overall:{completed:0,total:1},branches:[],models:[]},promptIds:[],evidence:[],error:null,errorHistory:[],snapshot:{projectId:'p',target:'remote',remote:{provider:'vastai',instanceId:7},preflight:{state:'READY',plannedImages:1,targetImages:1,blocking:[],warnings:[],sections:[]},workflow:{uiPath:'x',apiPath:'y',uiSha256:'a',apiSha256:'b',workflowIdentity:'c'},plan:{sha256:'d',branches:[]},runIdentity:'run-identity'},resume:{attempts:0,lastAttemptAt:null,lastValidatedEvidenceIds:[],lastIgnoredEvidenceIds:[],lastDecisionPhase:null},startedAt:now,updatedAt:now,completedAt:null};
  fs.writeFileSync(path.join(root,'execution_runs',runId+'.json'),JSON.stringify(run,null,2)+'\n');
}
class FakeClient{
  constructor(states){this.states=states;this.reads=0;this.starts=0;this.stops=0;}
  async getInstance(id){
    assert.equal(id,7);
    const value=this.states[Math.min(this.reads++,this.states.length-1)];
    if(value instanceof Error)throw value;
    return structuredClone(value);
  }
  async requestStartInstance(id){assert.equal(id,7);this.starts++;}
  async stopInstance(id){assert.equal(id,7);this.stops++;return instance('stopped');}
}
async function scenario(lifecycle,states){
  const root=fs.mkdtempSync(path.join(runtime,'case-'));writeRun(root);
  const client=new FakeClient(states);
  const service=new lifecycle.RemoteInstanceLifecycleService(client,{timeoutMs:100,pollMs:0,sleep:async()=>{}});
  return {root,client,service};
}

(async()=>{
  const lifecycle=await load('remote-instance-lifecycle.js');
  const execution=await load('execution-run.js');

  {
    const {root,client,service}=await scenario(lifecycle,[instance('stopped'),instance('starting'),instance('scheduling'),ready()]);
    const result=await service.prepare(root,runId);
    assert.equal(result.status,'running');assert.equal(client.starts,1);
    let run=await execution.getExecutionRun(root,runId);
    assert.equal(run.phase,'CLOUD_INSTANCE_READY');
    assert.equal(run.remoteLifecycle.initialStatus,'stopped');
    assert.equal(run.remoteLifecycle.startedByBatchStudio,true);
    assert.equal(run.remoteLifecycle.latest.instanceId,7);
    assert.equal(run.remoteLifecycle.latest.status,'running');
    await execution.mutateExecutionRun(root,runId,r=>{r.lifecycle='COMPLETED';r.phase='COMPLETED'});
    await service.finalize(root,runId);
    run=await execution.getExecutionRun(root,runId);
    assert.equal(client.stops,1);
    assert.equal(run.remoteLifecycle.restoredInitialState,true);
    assert.equal(run.remoteLifecycle.latest.status,'stopped');
    assert.ok(run.remoteLifecycle.finalizedAt);
    assert.equal(run.phase,'COMPLETED');
  }

  {
    const {root,client,service}=await scenario(lifecycle,[ready()]);
    await service.prepare(root,runId);
    assert.equal(client.starts,0);
    let run=await execution.getExecutionRun(root,runId);
    assert.equal(run.remoteLifecycle.initialStatus,'running');
    assert.equal(run.remoteLifecycle.startedByBatchStudio,false);
    await execution.mutateExecutionRun(root,runId,r=>{r.lifecycle='COMPLETED';r.phase='COMPLETED'});
    await service.finalize(root,runId);
    run=await execution.getExecutionRun(root,runId);
    assert.equal(client.stops,0,'pre-existing running instance must be kept running');
    assert.equal(run.remoteLifecycle.restoredInitialState,true);
  }

  {
    const {root,client,service}=await scenario(lifecycle,[instance('starting'),ready()]);
    await service.prepare(root,runId);
    assert.equal(client.starts,0,'starting instance must not receive a second start request');
    const run=await execution.getExecutionRun(root,runId);
    assert.equal(run.remoteLifecycle.initialStatus,'starting');
    assert.equal(run.remoteLifecycle.latest.status,'running');
  }

  {
    const {root,client,service}=await scenario(lifecycle,[instance('scheduling'),instance('starting'),ready()]);
    await service.prepare(root,runId);
    assert.equal(client.starts,0,'scheduling instance must be polled instead of replaced');
    const run=await execution.getExecutionRun(root,runId);
    assert.equal(run.remoteLifecycle.initialStatus,'scheduling');
  }

  {
    const {service}=await scenario(lifecycle,[instance('error',{statusMessage:'provider failure'})]);
    await assert.rejects(()=>service.prepare(path.dirname(path.join(runtime,'noop')),runId),/was not found/);
  }

  {
    const {root,service}=await scenario(lifecycle,[instance('error',{statusMessage:'provider failure'})]);
    await assert.rejects(()=>service.prepare(root,runId),/entered error: provider failure/);
  }

  {
    const {root,service}=await scenario(lifecycle,[new Error('Vast.ai API 404: instance missing')]);
    await assert.rejects(()=>service.prepare(root,runId),/instance missing/);
    const run=await execution.getExecutionRun(root,runId);
    assert.equal(run.remote.instanceId,7,'selected instance identity must remain unchanged on provider failure');
  }

  {
    const {root,client,service}=await scenario(lifecycle,[instance('running'),ready()]);
    await service.prepare(root,runId);
    assert.equal(client.reads,2,'running without SSH endpoint must continue polling until endpoint is ready');
  }

  console.log('Remote Vast instance lifecycle tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>fs.rmSync(runtime,{recursive:true,force:true}));
