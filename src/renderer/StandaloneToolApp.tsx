import { useState } from 'react';
import { CivitExplorerStage } from './CivitExplorerStage';
import { R2ManagerStage } from './R2ManagerStage';
import type { Runner } from './ui';

export type StandaloneWindowTool='r2'|'civit';

export function standaloneToolFromSearch(search:string):StandaloneWindowTool|null{
  const tool=new URLSearchParams(search).get('tool');
  return tool==='r2'||tool==='civit'?tool:null;
}

export function StandaloneToolApp({tool}:{tool:StandaloneWindowTool}){
  const [error,setError]=useState('');
  const run:Runner=async fn=>{setError('');try{return await fn()}catch(e){setError(e instanceof Error?e.message:String(e));return undefined}};
  const title=tool==='r2'?'R2 File Manager':'Civit Explorer';
  return <main className="shell">
    <header className="top"><div><span className="eyebrow">ComfyUI Batch Studio</span><h1>{title}</h1><small>専用ウィンドウ</small></div></header>
    {error&&<div className="errorbar">{error}</div>}
    <div className="body" style={{gridTemplateColumns:'minmax(0,1fr)'}}><section className="workspace">{tool==='r2'?<R2ManagerStage run={run}/>:<CivitExplorerStage run={run}/>}</section></div>
  </main>;
}
