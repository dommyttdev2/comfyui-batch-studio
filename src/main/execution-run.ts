import { randomUUID } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExecutionEvidence,
  ExecutionEvidenceKind,
  ExecutionPhase,
  ExecutionRun,
  ExecutionRunLifecycle,
  ExecutionRunSnapshot,
  PreflightResult,
  PromptPlanArtifact
} from '../shared/types.js';
import { exists, readJson, writeJsonAtomic } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
import { hashCanonicalJson, validateApiGraphStructure } from './workflow-api.js';

const RUNS_DIR='execution_runs';
const CURRENT_FILE='current.json';
const runLocks=new Map<string,Promise<void>>();

type PreflightProvider=()=>Promise<PreflightResult>;
export type ExecutionEvidenceInput={kind:ExecutionEvidenceKind;scope:string;data?:Record<string,string|number|boolean|null>};

function executionRunsDir(root:string){return path.join(root,RUNS_DIR);}
function executionRunPath(root:string,runId:string){assertRunId(runId);return path.join(executionRunsDir(root),`${runId}.json`);}
function currentRunPath(root:string){return path.join(executionRunsDir(root),CURRENT_FILE);}
function assertRunId(runId:string){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId))throw new Error('Invalid Execution Run ID');}
function clone<T>(value:T):T{return structuredClone(value);}
function initialPhase(target:'local'|'remote'):ExecutionPhase{return target==='remote'?'CLOUD_INSTANCE_RESOLVING':'LOCAL_COMFYUI_CONNECTING';}
function terminalLifecycle(lifecycle:ExecutionRunLifecycle){return lifecycle==='FAILED'||lifecycle==='COMPLETED';}
function resumableLifecycle(lifecycle:ExecutionRunLifecycle){return lifecycle==='PAUSED'||lifecycle==='INTERRUPTED'||lifecycle==='FAILED';}

async function withProjectLock<T>(root:string,fn:()=>Promise<T>):Promise<T>{
  const key=path.resolve(root),previous=runLocks.get(key)??Promise.resolve();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve});
  const tail=previous.then(()=>gate);
  runLocks.set(key,tail);
  await previous;
  try{return await fn();}
  finally{release();if(runLocks.get(key)===tail)runLocks.delete(key);}
}

function assertPersistSafe(value:unknown,keyPath='run'){
  if(typeof value==='string'){
    if(/-----BEGIN [^-]*PRIVATE KEY-----/i.test(value)||/[?&](?:X-Amz-(?:Credential|Signature|Security-Token)|AWSAccessKeyId|Signature|sig|token)=/i.test(value))throw new Error(`Execution Run contains sensitive value at ${keyPath}`);
    return;
  }
  if(Array.isArray(value)){value.forEach((item,index)=>assertPersistSafe(item,`${keyPath}[${index}]`));return;}
  if(!value||typeof value!=='object')return;
  for(const [key,item] of Object.entries(value as Record<string,unknown>)){
    if(/api.?key|secret|credential|private.?key|authorization|presigned.?url|signed.?url|cloudflare.?token/i.test(key))throw new Error(`Execution Run contains forbidden field: ${keyPath}.${key}`);
    assertPersistSafe(item,`${keyPath}.${key}`);
  }
}

async function writeRun(root:string,run:ExecutionRun){
  assertPersistSafe(run);
  await writeJsonAtomic(executionRunPath(root,run.runId),run);
}

async function writeCurrent(root:string,runId:string){assertRunId(runId);await writeJsonAtomic(currentRunPath(root),{schemaVersion:1,runId});}

export async function getExecutionRun(root:string,runId:string):Promise<ExecutionRun|null>{
  return readJson<ExecutionRun>(executionRunPath(root,runId));
}

async function latestExecutionRun(root:string):Promise<ExecutionRun|null>{
  if(!(await exists(executionRunsDir(root))))return null;
  let names:string[]=[];
  try{names=(await readdir(executionRunsDir(root))).filter(name=>name.endsWith('.json')&&name!==CURRENT_FILE);}catch{return null;}
  const runs=(await Promise.all(names.map(async name=>{try{return await getExecutionRun(root,name.replace(/\.json$/,''));}catch{return null;}}))).filter((run):run is ExecutionRun=>Boolean(run));
  return runs.sort((a,b)=>b.startedAt.localeCompare(a.startedAt))[0]??null;
}

export async function getCurrentExecutionRun(root:string):Promise<ExecutionRun|null>{
  const pointer=await readJson<{schemaVersion:1;runId:string}>(currentRunPath(root));
  if(pointer?.runId){try{const run=await getExecutionRun(root,pointer.runId);if(run)return run;}catch{}}
  return latestExecutionRun(root);
}

async function captureSnapshot(root:string,preflight:PreflightResult):Promise<ExecutionRunSnapshot>{
  const meta=await readProjectMeta(root),build=meta?.workflowBuild as any;
  const uiPath=String(build?.outputs?.ui?.path??build?.outputPath??'');
  const apiPath=String(build?.outputs?.api?.path??build?.apiOutputPath??'');
  const expectedUiSha=String(build?.outputs?.ui?.sha256??'');
  const expectedApiSha=String(build?.outputs?.api?.sha256??'');
  const expectedIdentity=String(build?.workflowIdentity??'');
  if(!uiPath||!apiPath||!expectedUiSha||!expectedApiSha||!expectedIdentity)throw new Error('Execution cannot start: Workflow/API graph provenance is missing.');
  const ui=await readJson<unknown>(path.join(root,uiPath)),api=await readJson<unknown>(path.join(root,apiPath));
  if(!ui||!api)throw new Error('Execution cannot start: Workflow/API graph file is missing.');
  const apiIssues=validateApiGraphStructure(api).filter(issue=>issue.severity==='error');
  if(apiIssues.length)throw new Error(`Execution cannot start: API graph is invalid: ${apiIssues.map(issue=>issue.message).join(' / ')}`);
  const uiSha256=hashCanonicalJson(ui),apiSha256=hashCanonicalJson(api),workflowIdentity=hashCanonicalJson({uiSha256,apiSha256});
  if(uiSha256!==expectedUiSha||apiSha256!==expectedApiSha||workflowIdentity!==expectedIdentity)throw new Error('Execution cannot start/resume: Workflow/API graph is stale.');
  const brief=await readJson<any>(path.join(root,'project_brief.json'));
  if(!brief?.project?.id)throw new Error('Execution cannot start: project.id is missing.');
  const plan=await readJson<PromptPlanArtifact>(path.join(root,'prompt_plan.json'));
  if(!plan)throw new Error('Execution cannot start: prompt_plan.json is missing.');
  const target=meta?.settings.executionTarget==='remote'?'remote':'local';
  const promptPlanSha256=hashCanonicalJson(plan);
  const planSnapshot={
    sha256:promptPlanSha256,
    branches:plan.branches.map(branch=>({branchId:branch.id,leafIds:branch.leaves.map(leaf=>leaf.id)}))
  };
  const remote=target==='remote'?{provider:meta?.settings.remoteProvider??null,instanceId:meta?.settings.remoteInstanceId??null}:null;
  const runIdentity=hashCanonicalJson({projectId:brief.project.id,target,workflowIdentity,apiSha256,promptPlanSha256});
  return {
    projectId:String(brief.project.id),
    target,
    remote,
    preflight:clone(preflight),
    workflow:{uiPath,apiPath,uiSha256,apiSha256,workflowIdentity},
    plan:planSnapshot,
    runIdentity
  };
}

function sameSnapshot(a:ExecutionRunSnapshot,b:ExecutionRunSnapshot){
  return a.runIdentity===b.runIdentity&&a.workflow.workflowIdentity===b.workflow.workflowIdentity&&a.workflow.apiSha256===b.workflow.apiSha256&&a.plan.sha256===b.plan.sha256;
}

function evidenceFingerprint(runIdentity:string,input:ExecutionEvidenceInput){
  return hashCanonicalJson({runIdentity,kind:input.kind,scope:input.scope,data:input.data??{}});
}

export function validatedExecutionEvidence(run:ExecutionRun){
  const valid:ExecutionEvidence[]=[],invalid:string[]=[];
  for(const evidence of run.evidence){
    const expected=hashCanonicalJson({runIdentity:run.snapshot.runIdentity,kind:evidence.kind,scope:evidence.scope,data:evidence.data??{}});
    if(evidence.runIdentity===run.snapshot.runIdentity&&evidence.fingerprint===expected)valid.push(evidence);else invalid.push(evidence.id);
  }
  return {valid,invalid};
}

function resumePhase(run:ExecutionRun,evidence:ExecutionEvidence[]):{phase:ExecutionPhase;lifecycle:ExecutionRunLifecycle}{
  const kinds=new Set(evidence.map(item=>item.kind));
  if(kinds.has('LOCAL_FILE_VERIFIED'))return {phase:'COMPLETED',lifecycle:'COMPLETED'};
  if(run.executionTarget==='remote'&&kinds.has('R2_OBJECT_VERIFIED'))return {phase:'LOCAL_DOWNLOADING',lifecycle:'RUNNING'};
  if(run.executionTarget==='remote'&&kinds.has('PACKAGE_VERIFIED'))return {phase:'R2_UPLOAD_URL_ISSUED',lifecycle:'RUNNING'};
  if(kinds.has('EXECUTION_COMPLETED'))return {phase:run.executionTarget==='remote'?'ARTIFACTS_COLLECTING':'LOCAL_OUTPUT_VERIFYING',lifecycle:'RUNNING'};
  if(kinds.has('MODELS_VERIFIED')||kinds.has('MODEL_VERIFIED'))return {phase:'WORKFLOW_PREPARING',lifecycle:'RUNNING'};
  return {phase:initialPhase(run.executionTarget),lifecycle:'RUNNING'};
}

export async function startExecutionRun(root:string,preflightProvider:PreflightProvider):Promise<ExecutionRun>{
  return withProjectLock(root,async()=>{
    const current=await getCurrentExecutionRun(root);
    if(current&&!terminalLifecycle(current.lifecycle))throw new Error(`Execution Run ${current.runId} is already active for this project.`);
    const before=await captureSnapshot(root,{state:'READY',plannedImages:0,targetImages:null,blocking:[],warnings:[],sections:[]});
    const preflight=await preflightProvider();
    if(preflight.state!=='READY')throw new Error(`Execution cannot start: Preflight is BLOCKED: ${preflight.blocking.map(item=>item.message).join(' / ')}`);
    const snapshot=await captureSnapshot(root,preflight);
    if(!sameSnapshot(before,snapshot))throw new Error('Execution cannot start: Workflow/API graph or Prompt Plan changed during Preflight.');
    const now=new Date().toISOString(),runId=randomUUID();
    const branches=snapshot.plan.branches.map(branch=>({branchId:branch.branchId,completed:0,total:branch.leafIds.length,state:'pending' as const}));
    const run:ExecutionRun={
      schemaVersion:1,
      runId,
      projectId:snapshot.projectId,
      executionTarget:snapshot.target,
      remote:snapshot.remote,
      lifecycle:'RUNNING',
      phase:initialPhase(snapshot.target),
      controls:{scheduling:'ACTIVE',interrupt:'IDLE',stopSchedulingRequestedAt:null,forceInterruptRequestedAt:null},
      current:{branchId:null,leafId:null,promptId:null},
      progress:{overall:{completed:0,total:preflight.plannedImages},branches,models:[]},
      promptIds:[],
      evidence:[],
      error:null,
      errorHistory:[],
      snapshot,
      resume:{attempts:0,lastAttemptAt:null,lastValidatedEvidenceIds:[],lastIgnoredEvidenceIds:[],lastDecisionPhase:null},
      startedAt:now,
      updatedAt:now,
      completedAt:null
    };
    await writeRun(root,run);await writeCurrent(root,runId);return run;
  });
}

export async function mutateExecutionRun(root:string,runId:string,mutator:(run:ExecutionRun)=>ExecutionRun|void):Promise<ExecutionRun>{
  return withProjectLock(root,async()=>{
    const current=await getExecutionRun(root,runId);if(!current)throw new Error(`Execution Run ${runId} was not found.`);
    const working=clone(current),result=mutator(working),next=(result??working) as ExecutionRun;
    next.updatedAt=new Date().toISOString();
    if(next.lifecycle==='COMPLETED'&&!next.completedAt)next.completedAt=next.updatedAt;
    await writeRun(root,next);return next;
  });
}

export async function recordExecutionEvidence(root:string,runId:string,input:ExecutionEvidenceInput):Promise<ExecutionRun>{
  assertPersistSafe(input,'evidence');
  return mutateExecutionRun(root,runId,run=>{
    const evidence:ExecutionEvidence={
      id:randomUUID(),
      kind:input.kind,
      scope:input.scope,
      runIdentity:run.snapshot.runIdentity,
      fingerprint:evidenceFingerprint(run.snapshot.runIdentity,input),
      recordedAt:new Date().toISOString(),
      data:input.data??{}
    };
    run.evidence.push(evidence);
  });
}

export async function requestStopScheduling(root:string,runId:string):Promise<ExecutionRun>{
  return mutateExecutionRun(root,runId,run=>{
    if(run.lifecycle!=='RUNNING')throw new Error(`Execution Run ${runId} is not running.`);
    if(run.controls.scheduling==='ACTIVE'){run.controls.scheduling='STOP_REQUESTED';run.controls.stopSchedulingRequestedAt=new Date().toISOString();}
  });
}

export async function requestForceInterrupt(root:string,runId:string):Promise<ExecutionRun>{
  return mutateExecutionRun(root,runId,run=>{
    if(run.lifecycle!=='RUNNING')throw new Error(`Execution Run ${runId} is not running.`);
    if(run.controls.interrupt==='IDLE'){run.controls.interrupt='FORCE_REQUESTED';run.controls.forceInterruptRequestedAt=new Date().toISOString();}
  });
}

export async function resumeExecutionRun(root:string,runId:string,preflightProvider:PreflightProvider):Promise<ExecutionRun>{
  return withProjectLock(root,async()=>{
    const run=await getExecutionRun(root,runId);if(!run)throw new Error(`Execution Run ${runId} was not found.`);
    if(!resumableLifecycle(run.lifecycle))throw new Error(`Execution Run ${runId} is not resumable from ${run.lifecycle}.`);
    const placeholder:PreflightResult={state:'READY',plannedImages:run.snapshot.preflight.plannedImages,targetImages:run.snapshot.preflight.targetImages,blocking:[],warnings:[],sections:[]};
    const before=await captureSnapshot(root,placeholder);
    if(!sameSnapshot(run.snapshot,before))throw new Error('Execution cannot resume: Workflow/API graph or Prompt Plan is stale.');
    const preflight=await preflightProvider();
    if(preflight.state!=='READY')throw new Error(`Execution cannot resume: Preflight is BLOCKED: ${preflight.blocking.map(item=>item.message).join(' / ')}`);
    const after=await captureSnapshot(root,preflight);
    if(!sameSnapshot(run.snapshot,after))throw new Error('Execution cannot resume: Workflow/API graph or Prompt Plan changed during validation.');
    const checked=validatedExecutionEvidence(run),decision=resumePhase(run,checked.valid),now=new Date().toISOString();
    const next:ExecutionRun={
      ...run,
      lifecycle:decision.lifecycle,
      phase:decision.phase,
      controls:{scheduling:'ACTIVE',interrupt:'IDLE',stopSchedulingRequestedAt:null,forceInterruptRequestedAt:null},
      error:null,
      resume:{attempts:run.resume.attempts+1,lastAttemptAt:now,lastValidatedEvidenceIds:checked.valid.map(item=>item.id),lastIgnoredEvidenceIds:checked.invalid,lastDecisionPhase:decision.phase},
      updatedAt:now,
      completedAt:decision.lifecycle==='COMPLETED'?(run.completedAt??now):null
    };
    await writeRun(root,next);await writeCurrent(root,runId);return next;
  });
}
