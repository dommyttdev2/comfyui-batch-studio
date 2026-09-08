import { useState } from 'react';
import type { AvailabilityResult, CompileResult, PreflightResult, ProjectSummary } from '../shared/types';
import type { Runner } from './ui';
import { issuesView } from './ui';
import { R2ManagerStage } from './R2ManagerStage';

export function WorkflowStage({project,refresh,run}:{project:ProjectSummary;refresh:()=>Promise<unknown>;run:Runner}){const [r,setR]=useState<CompileResult|null>(null);const hasWorkflow=Boolean(project.artifacts.find(a=>a.key==='workflow')?.relativePath);return <section className="panel"><h3>Workflow Compiler</h3><p>確定済み models.json / prompt_plan.json と Template/Manifestから決定論的に生成します。</p><div className="actions"><button className="primary" onClick={()=>run(async()=>{setR(await window.batchStudio.workflow.compile(project.rootPath));await refresh()})}>ワークフローを生成</button>{(r||hasWorkflow)&&<button onClick={()=>window.batchStudio.project.openFolder(project.rootPath)}>フォルダを開く</button>}</div>{r&&<div className="facts"><div>Branches <b>{r.branchCount}</b></div><div>Images <b>{r.imageCount}</b></div><div>Nodes <b>{r.nodeCount}</b></div><div>Links <b>{r.linkCount}</b></div><div>Output <code>{r.outputPath}</code></div></div>}</section>}

export function AvailabilityStage({project,run}:{project:ProjectSummary;run:Runner}){
  const [r,setR]=useState<AvailabilityResult|null>(null);
  const selectBucket=(bucket:string)=>run(async()=>{await window.batchStudio.project.saveSettings(project.rootPath,{r2Bucket:bucket,r2ModelPrefix:''});setR(await window.batchStudio.availability.check(project.rootPath))});
  return <><section className="panel"><div className="panelhead"><div><h3>モデル配置</h3><p>models.jsonの必須モデルがLocal/R2のどこにあるか確認します。</p></div><div className="actions"><button onClick={()=>run(async()=>setR(await window.batchStudio.availability.check(project.rootPath)))}>再確認</button></div></div>{r&&<>{issuesView(r.validation.issues)}<div className="table">{r.rows.map(x=><div className="tablerow" key={x.ref}><code>{x.ref}</code><span>{x.fileName}</span><span>Local {x.local?'✓':'✕'}</span><span>R2 {x.r2?'✓':'✕'}</span><b>{x.state}</b></div>)}</div></>}</section><section className="panel"><R2ManagerStage run={run} readOnly initialBucket={project.meta?.settings.r2Bucket??''} onBucketChange={bucket=>void selectBucket(bucket)}/></section></>;
}

export function PreflightStage({project,run}:{project:ProjectSummary;run:Runner}){const [r,setR]=useState<PreflightResult|null>(null);return <section className="panel"><button className="primary" onClick={()=>run(async()=>setR(await window.batchStudio.preflight.run(project.rootPath)))}>実行前チェック</button>{r&&<><div className={`preflight ${r.state.toLowerCase()}`}><h2>{r.state}</h2><p>{r.plannedImages}枚予定 / 目標 {r.targetImages??'-'}枚</p></div>{r.sections.map(s=><div className="sectioncheck" key={s.name}><h4>{s.valid?'✓':'✕'} {s.name}</h4>{issuesView(s.issues)}</div>)}{r.warnings.length>0&&<><h3>注意</h3>{issuesView(r.warnings)}</>}</>}</section>}
