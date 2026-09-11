import { useEffect, useState } from 'react';
import type { AppSettings, AppSettingsStatus, AvailabilityResult, CompileResult, ExecutionPhase, ExecutionRun, ExecutionTarget, ModelsArtifact, PreflightResult, ProjectSummary, VastAiConnectionStatus, VastAiInstance } from '../shared/types';
import type { Runner } from './ui';
import { issuesView } from './ui';
import { R2ManagerStage } from './R2ManagerStage';

export function WorkflowStage({project,refresh,run}:{project:ProjectSummary;refresh:()=>Promise<unknown>;run:Runner}){const [r,setR]=useState<CompileResult|null>(null);const hasWorkflow=Boolean(project.artifacts.find(a=>a.key==='workflow')?.relativePath);return <section className="panel"><h3>Workflow Compiler</h3><p>確定済み models.json / prompt_plan.json と Template/Manifestから決定論的に生成します。</p><div className="actions"><button className="primary" onClick={()=>run(async()=>{setR(await window.batchStudio.workflow.compile(project.rootPath));await refresh()})}>ワークフローを生成</button>{(r||hasWorkflow)&&<button onClick={()=>window.batchStudio.project.openFolder(project.rootPath)}>フォルダを開く</button>}</div>{r&&<div className="facts"><div>Branches <b>{r.branchCount}</b></div><div>Images <b>{r.imageCount}</b></div><div>Nodes <b>{r.nodeCount}</b></div><div>Links <b>{r.linkCount}</b></div><div>Output <code>{r.outputPath}</code></div></div>}</section>}

function appSettingsInput(s:AppSettingsStatus):AppSettings{return {comfyUiInstallPath:s.comfyUiInstallPath,catalogPath:s.catalogPath,r2Bucket:s.r2Bucket,r2ModelPrefix:s.r2ModelPrefix,r2IndexPath:s.r2IndexPath,templatePath:s.templatePath,manifestPath:s.manifestPath}}
function vastInstanceLabel(instance:VastAiInstance){const label=instance.label?` | ${instance.label}`:'',gpu=instance.gpuName?` | ${instance.gpuName}`:'';return `#${instance.id} | ${instance.status.toUpperCase()}${gpu}${label}`;}
export function AvailabilityStage({project,setProject,run}:{project:ProjectSummary;setProject:(p:ProjectSummary)=>void;run:Runner}){
  const [r,setR]=useState<AvailabilityResult|null>(null),[modelFileNames,setModelFileNames]=useState<string[]>([]),[appSettings,setAppSettings]=useState<AppSettingsStatus|null>(null),[vastStatus,setVastStatus]=useState<VastAiConnectionStatus|null>(null),[vastInstances,setVastInstances]=useState<VastAiInstance[]>([]),[cloudError,setCloudError]=useState('');
  const target:ExecutionTarget=project.meta?.settings.executionTarget==='remote'?'remote':'local';
  const selectedInstanceId=project.meta?.settings.remoteProvider==='vastai'?project.meta.settings.remoteInstanceId:undefined;
  const loadCloud=async()=>{setCloudError('');const status=await window.batchStudio.vastai.settings();setVastStatus(status);if(!status.configured){setVastInstances([]);return;}try{setVastInstances(await window.batchStudio.vastai.instances())}catch(e){setVastInstances([]);setCloudError(e instanceof Error?e.message:String(e));}};
  useEffect(()=>{let cancelled=false;void window.batchStudio.artifact.read(project.rootPath,'models','confirmed').then(a=>{if(cancelled||!a.content)return;try{const models=JSON.parse(a.content) as ModelsArtifact;const baseFile=models.modelFamily==='anima'?(models.diffusionModel?.fileName??models.checkpoint?.fileName):models.checkpoint?.fileName;const names=[baseFile,models.textEncoder?.fileName,models.vae?.fileName,...models.loras.map(x=>x.fileName)].filter((x):x is string=>typeof x==='string'&&x.length>0);setModelFileNames(names)}catch{setModelFileNames([])}}).catch(()=>{if(!cancelled)setModelFileNames([])});void window.batchStudio.appSettings.get().then(s=>{if(!cancelled)setAppSettings(s)}).catch(()=>{});void loadCloud().catch(()=>{});return()=>{cancelled=true}},[project.rootPath]);
  const check=()=>run(async()=>{const [settings,result]=await Promise.all([window.batchStudio.appSettings.get(),window.batchStudio.availability.check(project.rootPath)]);setAppSettings(settings);setR(result);if(target==='remote')await loadCloud()});
  const setTarget=(executionTarget:ExecutionTarget)=>run(async()=>{const updated=await window.batchStudio.project.saveSettings(project.rootPath,{executionTarget});setProject(updated);const result=await window.batchStudio.availability.check(project.rootPath);setR(result);if(executionTarget==='remote')await loadCloud()});
  const setRemoteInstance=(value:string)=>run(async()=>{const remoteInstanceId=Number(value);if(!Number.isInteger(remoteInstanceId)||remoteInstanceId<1)return;const updated=await window.batchStudio.project.saveSettings(project.rootPath,{executionTarget:'remote',remoteProvider:'vastai',remoteInstanceId});setProject(updated)});
  const selectBucket=(bucket:string)=>run(async()=>{const current=await window.batchStudio.appSettings.get();const updated=await window.batchStudio.appSettings.save({...appSettingsInput(current),r2Bucket:bucket});setAppSettings(updated);setR(await window.batchStudio.availability.check(project.rootPath))});
  const localRequirement=target==='local'?'必須':'任意',r2Requirement=target==='remote'?'必須':'任意';
  const selectedInstance=vastInstances.find(x=>x.id===selectedInstanceId);
  return <><section className="panel"><div className="panelhead"><div><h3>モデル配置</h3><p>ワークフロー実行先に応じて、必須となるモデル配置先を切り替えます。</p></div><div className="actions"><button onClick={()=>void check()}>再確認</button></div></div><div className="facts"><div><span className="eyebrow">ワークフロー実行先</span><div className="actions"><button className={target==='local'?'primary':''} onClick={()=>void setTarget('local')}>ローカル</button><button className={target==='remote'?'primary':''} onClick={()=>void setTarget('remote')}>リモート</button></div></div><div><span className="eyebrow">ローカル配置</span><b>{localRequirement}</b><small style={{display:'block',marginTop:6,color:'#8993a2'}}>ローカル実行時のみ必須</small></div><div><span className="eyebrow">R2配置</span><b>{r2Requirement}</b><small style={{display:'block',marginTop:6,color:'#8993a2'}}>リモート実行時のみ必須</small></div></div>{target==='local'&&<p className="hint">ローカル探索先: <code>{appSettings?.modelsPath??'未設定'}</code>。環境設定で指定したComfyUIインストール先の <code>models</code> 配下を再帰的に確認します。</p>}{target==='remote'&&<><div className="environment-section"><div className="panelhead"><div><h3>クラウド実行先</h3><p>サービス連携で設定したVast.aiの既存Instanceから、このProjectの実行先を選択します。</p></div><button disabled={!vastStatus?.configured} onClick={()=>void run(loadCloud)}>Instance更新</button></div>{!vastStatus?.configured?<p className="hint">Vast.aiが未設定です。プロジェクトを閉じ、ホームの「サービス連携 → クラウドインスタンス → Vast.ai」でAPI KeyとSSH秘密鍵を設定してください。</p>:<div className="formgrid"><label className="wide">Vast.ai Instance<select value={selectedInstanceId??''} onChange={e=>void setRemoteInstance(e.target.value)}><option value="">選択してください</option>{vastInstances.map(instance=><option key={instance.id} value={instance.id}>{vastInstanceLabel(instance)}</option>)}</select></label></div>}{cloudError&&<div className="errorbar">{cloudError}</div>}{selectedInstance&&<div className="facts"><div>Instance <b>#{selectedInstance.id}</b></div><div>Status <b>{selectedInstance.status.toUpperCase()}</b></div><div>GPU <b>{selectedInstance.gpuName??'-'}</b></div><div>SSH <code>{selectedInstance.sshHost&&selectedInstance.sshPort?`${selectedInstance.sshHost}:${selectedInstance.sshPort}`:'起動後に取得'}</code></div></div>}</div><p className="hint">リモート実行ではR2配置が必須です。SSH Host/PortはProjectへ固定保存せず、実行時にVast.ai APIから最新値を解決します。</p></>}{r&&<>{issuesView(r.validation.issues)}<div className="table">{r.rows.map(x=><div className="tablerow" key={x.ref}><code>{x.ref}</code><span>{x.fileName}</span><span>Local {localRequirement} {x.local?'✓':'✕'}</span><span>R2 {r2Requirement} {x.r2?'✓':'✕'}</span><b>{x.state==='available'?'要件OK':x.state==='transfer-required'?(target==='local'?'Localへ配置':'R2へ配置'):'未配置'}</b></div>)}</div></>}</section>{appSettings&&<section className="panel"><R2ManagerStage run={run} readOnly initialBucket={appSettings.r2Bucket} initialBatchFileNames={modelFileNames} onBucketChange={bucket=>void selectBucket(bucket)}/></section>}</>;
}

export function PreflightStage({project,run}:{project:ProjectSummary;run:Runner}){const [r,setR]=useState<PreflightResult|null>(null);return <section className="panel"><button className="primary" onClick={()=>run(async()=>setR(await window.batchStudio.preflight.run(project.rootPath)))}>実行前チェック</button>{r&&<><div className={`preflight ${r.state.toLowerCase()}`}><h2>{r.state}</h2><p>{r.plannedImages}枚予定 / 目標 {r.targetImages??'-'}枚</p></div>{r.sections.map(s=><div className="sectioncheck" key={s.name}><h4>{s.valid?'✓':'✕'} {s.name}</h4>{issuesView(s.issues)}</div>)}{r.warnings.length>0&&<><h3>注意</h3>{issuesView(r.warnings)}</>}</>}</section>}

const EXECUTION_PHASES:ExecutionPhase[]=['LOCAL_COMFYUI_CONNECTING','LOCAL_CAPABILITY_CHECKING','CLOUD_INSTANCE_RESOLVING','CLOUD_INSTANCE_STARTING','CLOUD_INSTANCE_READY','SSH_CONNECTING','SSH_CONNECTED','REMOTE_WORKER_PREPARING','REMOTE_ENVIRONMENT_CHECKING','REMOTE_MODELS_CHECKING','REMOTE_MODELS_DOWNLOADING','REMOTE_MODELS_READY','WORKFLOW_PREPARING','EXECUTING','EXECUTION_COMPLETED','ARTIFACTS_COLLECTING','ARTIFACTS_PACKAGING','R2_UPLOAD_URL_ISSUED','R2_UPLOADING','R2_UPLOADED','LOCAL_DOWNLOADING','LOCAL_VERIFYING','LOCAL_OUTPUT_VERIFYING','REMOTE_CLEANUP','CLOUD_INSTANCE_FINALIZING','COMPLETED'];
const phaseIndex=(phase:ExecutionPhase)=>EXECUTION_PHASES.indexOf(phase);
const reached=(phase:ExecutionPhase,target:ExecutionPhase)=>phaseIndex(phase)>=phaseIndex(target);
const pct=(completed:number,total:number)=>total>0?Math.min(100,Math.round(completed/total*100)):0;
const phaseLabel=(phase:ExecutionPhase)=>phase.replaceAll('_',' ');
function connectionStatus(run:ExecutionRun){
  if(run.lifecycle==='FAILED')return'FAILED';
  if(run.executionTarget==='local')return run.phase==='LOCAL_COMFYUI_CONNECTING'?'ComfyUI 接続中':reached(run.phase,'LOCAL_CAPABILITY_CHECKING')?'ComfyUI 接続済み':'待機';
  if(['CLOUD_INSTANCE_RESOLVING','CLOUD_INSTANCE_STARTING','CLOUD_INSTANCE_READY'].includes(run.phase))return'Instance 準備中';
  if(run.phase==='SSH_CONNECTING')return'SSH 接続中';
  return reached(run.phase,'SSH_CONNECTED')?'SSH 接続済み':'待機';
}
function modelStatus(run:ExecutionRun){
  if(run.executionTarget==='local')return reached(run.phase,'WORKFLOW_PREPARING')?'準備完了':run.phase==='LOCAL_CAPABILITY_CHECKING'?'確認中':'待機';
  if(run.phase==='REMOTE_MODELS_DOWNLOADING')return'R2 → Remote 転送中';
  if(run.phase==='REMOTE_MODELS_CHECKING')return'配置確認中';
  return reached(run.phase,'REMOTE_MODELS_READY')?'準備完了':'待機';
}
function deliveryStatus(run:ExecutionRun){
  const packaging=reached(run.phase,'ARTIFACTS_PACKAGING')?(reached(run.phase,'R2_UPLOAD_URL_ISSUED')?'完了':'処理中'):'待機';
  const r2=run.executionTarget==='local'?'対象外':reached(run.phase,'R2_UPLOADED')?'完了':run.phase==='R2_UPLOADING'?'アップロード中':run.phase==='R2_UPLOAD_URL_ISSUED'?'URL発行済み':'待機';
  const download=run.executionTarget==='local'?'対象外':reached(run.phase,'LOCAL_VERIFYING')?'完了':run.phase==='LOCAL_DOWNLOADING'?'ダウンロード中':'待機';
  const verify=run.lifecycle==='COMPLETED'?'完了':run.phase==='LOCAL_OUTPUT_VERIFYING'||run.phase==='LOCAL_VERIFYING'?'検証中':'待機';
  return{packaging,r2,download,verify};
}

export function ExecutionStage({project,run}:{project:ProjectSummary;run:Runner}){
  const [current,setCurrent]=useState<ExecutionRun|null>(null),[preflight,setPreflight]=useState<PreflightResult|null>(null),[checking,setChecking]=useState(true),[monitorError,setMonitorError]=useState('');
  const refreshPreflight=async()=>{setChecking(true);try{setPreflight(await window.batchStudio.preflight.run(project.rootPath));setMonitorError('')}catch(e){setMonitorError(e instanceof Error?e.message:String(e))}finally{setChecking(false)}};
  useEffect(()=>{let cancelled=false;let timer:number|undefined;
    const load=async()=>{try{const value=await window.batchStudio.execution.status(project.rootPath);if(!cancelled){setCurrent(value);setMonitorError('')}}catch(e){if(!cancelled)setMonitorError(e instanceof Error?e.message:String(e))}};
    void Promise.all([load(),refreshPreflight()]);
    timer=window.setInterval(()=>void load(),1500);
    return()=>{cancelled=true;if(timer!==undefined)window.clearInterval(timer)};
  },[project.rootPath]);
  const apply=async(action:()=>Promise<ExecutionRun>)=>{const value=await run(action);if(value)setCurrent(value)};
  const active=current?.lifecycle==='RUNNING'||current?.lifecycle==='PAUSED'||current?.lifecycle==='INTERRUPTED';
  const canStart=preflight?.state==='READY'&&!active;
  const canResume=Boolean(current&&['PAUSED','INTERRUPTED','FAILED'].includes(current.lifecycle));
  const branch=current?.progress.branches.find(x=>x.branchId===current.current.branchId)??null;
  const delivery=current?deliveryStatus(current):null;
  const generationDone=Boolean(current&&(reached(current.phase,'EXECUTION_COMPLETED')||current.lifecycle==='COMPLETED'));
  const deliveryDone=Boolean(current&&current.lifecycle==='COMPLETED');
  const blockedReasons=preflight?.state==='BLOCKED'?preflight.blocking:[];
  const outputPath=project.meta?.settings.artifactOutputPath??project.rootPath;
  return <div className="execution-screen">
    <section className="panel"><div className="panelhead"><div><h3>Execution Run</h3><p>永続化された Run State を監視し、Start / Stop scheduling / Force interrupt / Resume を操作します。</p></div><button onClick={()=>void refreshPreflight()} disabled={checking}>{checking?'確認中…':'Preflight再確認'}</button></div>
    {monitorError&&<div className="errorbar">{monitorError}</div>}
    <div className={'preflight '+(preflight?.state==='READY'?'ready':'blocked')}><h2>{checking?'CHECKING':preflight?.state??'UNKNOWN'}</h2><p>{preflight?.state==='READY'?'Start可能です':'StartにはPreflight READYが必要です'}</p></div>
    {blockedReasons.length>0&&<><h4>Startできない理由</h4>{issuesView(blockedReasons)}</>}
    <div className="actions execution-actions"><button className="primary" disabled={!canStart} onClick={()=>void apply(()=>window.batchStudio.execution.start(project.rootPath))}>Start</button><button disabled={!current||current.lifecycle!=='RUNNING'||current.controls.scheduling!=='ACTIVE'} onClick={()=>current&&void apply(()=>window.batchStudio.execution.stopScheduling(project.rootPath,current.runId))}>Stop scheduling</button><button className="danger" disabled={!current||current.lifecycle!=='RUNNING'||current.controls.interrupt!=='IDLE'} onClick={()=>current&&void apply(()=>window.batchStudio.execution.forceInterrupt(project.rootPath,current.runId))}>Force interrupt</button><button disabled={!canResume} onClick={()=>current&&void apply(()=>window.batchStudio.execution.resume(project.rootPath,current.runId))}>Resume</button><button disabled={current?.lifecycle!=='COMPLETED'} onClick={()=>void window.batchStudio.project.openFolder(outputPath)}>Open local output directory</button></div>
    </section>

    {!current?<section className="panel execution-empty"><h3>Runはまだありません</h3><p>PreflightがREADYならStartできます。開始後のRun ID・phase・progressはProject内に永続化され、画面再読込後も復元されます。</p></section>:<>
      <section className="panel"><div className="execution-run-head"><div><span className="eyebrow">Current Run ID</span><code>{current.runId}</code></div><span className={'run-lifecycle '+current.lifecycle.toLowerCase()}>{current.lifecycle}</span></div>
      <div className="facts execution-facts"><div><span>Execution target</span><b>{current.executionTarget==='remote'?'Remote':'Local'}</b></div><div><span>Current phase</span><b>{phaseLabel(current.phase)}</b></div><div><span>Connection status</span><b>{connectionStatus(current)}</b></div><div><span>Model preparation</span><b>{modelStatus(current)}</b></div></div>
      {current.executionTarget==='remote'&&<div className="remote-phase-note"><b>Remote phase separation</b><span>Instance / SSH / model preparation / generation / artifact transfer を独立phaseとして監視します。</span></div>}
      </section>
      <section className="panel"><div className="panelhead"><div><h3>Generation progress</h3><p>generation completed と artifact delivery completed は別状態です。</p></div><b>{current.progress.overall.completed} / {current.progress.overall.total}</b></div>
      <progress className="execution-progress" max={100} value={pct(current.progress.overall.completed,current.progress.overall.total)}/>
      <div className="facts execution-facts"><div><span>Generation completed</span><b>{generationDone?'完了':'未完了'}</b></div><div><span>Artifact delivery completed</span><b>{deliveryDone?'完了':'未完了'}</b></div><div><span>Current branch</span><b>{current.current.branchId??'-'}</b></div><div><span>Current prompt ID</span><b>{current.current.promptId??current.current.leafId??'-'}</b></div></div>
      {branch&&<div className="branch-progress"><div><span>Branch progress · {branch.branchId}</span><b>{branch.completed} / {branch.total} · {branch.state}</b></div><progress max={100} value={pct(branch.completed,branch.total)}/></div>}
      </section>

      <section className="panel"><h3>Artifact delivery</h3><div className="execution-status-grid"><div><span>Artifact packaging</span><b>{delivery?.packaging}</b></div><div><span>R2 upload</span><b>{delivery?.r2}</b></div><div><span>Local download</span><b>{delivery?.download}</b></div><div><span>Final verification</span><b>{delivery?.verify}</b></div></div></section>
      <section className="panel"><h3>Control state</h3><div className="facts execution-facts"><div><span>Scheduling</span><b>{current.controls.scheduling}</b></div><div><span>Interrupt</span><b>{current.controls.interrupt}</b></div><div><span>Updated</span><b>{new Date(current.updatedAt).toLocaleString()}</b></div><div><span>Resume attempts</span><b>{current.resume.attempts}</b></div></div><p className="hint">Local output: <code>{outputPath}</code></p></section>
      {(current.error||current.lifecycle==='FAILED')&&<section className="panel execution-failure"><h3>{current.lifecycle}</h3>{current.error?<><p><b>{current.error.code}</b> · {current.error.message}</p><small>phase: {phaseLabel(current.error.phase)} / retryable: {current.error.retryable?'yes':'no'}</small></>:<p>RunはFAILEDです。保存済みerror detailはありません。</p>}</section>}
    </>}
  </div>;
}
