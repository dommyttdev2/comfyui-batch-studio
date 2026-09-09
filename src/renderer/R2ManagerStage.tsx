import { useEffect, useRef, useState } from 'react';
import type { R2BatchDownloadTemplate, R2Bucket, R2ConnectionInput, R2ConnectionStatus, R2DownloadInfo, R2ListResult, R2Object, R2SearchResult, R2UploadJob } from '../shared/types';
import { buildAria2Command, formatBatchTotalSize, normalizeAria2ConcurrentDownloads, normalizeAria2Connections } from '../shared/r2-download-utils';
import { normalizeR2ObjectKey } from '../shared/r2-manager-utils';
import type { Runner } from './ui';
import './r2-manager.css';

const fmt=(n:number)=>n<1024?`${n} B`:n<1024**2?`${(n/1024).toFixed(1)} KiB`:n<1024**3?`${(n/1024**2).toFixed(1)} MiB`:`${(n/1024**3).toFixed(2)} GiB`;
const parentPrefix=(prefix:string)=>{const parts=prefix.split('/').filter(Boolean);parts.pop();return parts.length?`${parts.join('/')}/`:''};
const displayPath=(prefix:string)=>prefix?`/${prefix.replace(/\/$/,'')}`:'/';
const sameFileName=(a:string,b:string)=>a.normalize('NFKC').toLocaleLowerCase()===b.normalize('NFKC').toLocaleLowerCase();
const localFileName=(filePath:string)=>filePath.split(/[\\/]/).pop()||filePath;
const uploadObjectKey=(prefix:string,filePath:string)=>{const base=prefix.replace(/^\/+|\/+$/g,'');return `${base?`${base}/`:''}${localFileName(filePath)}`};
const isUploadConflict=(error:unknown)=>error instanceof Error&&error.message.includes('同名のファイルが存在します。');
type UploadConflict={filePath:string;fileName:string;key:string;remaining:string[]};
type TransferJob=R2UploadJob&{kind?:'upload'|'move';sourceKey?:string;destinationKey?:string;startedAt?:string;initialTransferredBytes?:number;completedAt?:string};
const transferSpeed=(job:TransferJob)=>{if(!job.startedAt)return 0;const elapsed=Math.max((Date.now()-new Date(job.startedAt).getTime())/1000,.1);return Math.max(job.transferredBytes-(job.initialTransferredBytes??0),0)/elapsed};
const formatEta=(job:TransferJob)=>{const speed=transferSpeed(job);if(speed<=0||job.transferredBytes>=job.size)return '';const seconds=(job.size-job.transferredBytes)/speed;if(seconds<60)return `残り約${Math.ceil(seconds)}秒`;if(seconds<3600)return `残り約${Math.ceil(seconds/60)}分`;return `残り約${(seconds/3600).toFixed(1)}時間`};

export function R2ManagerStage({run,readOnly=false,initialBucket='',initialBatchFileNames=[],onBucketChange}:{run:Runner;readOnly?:boolean;initialBucket?:string;initialBatchFileNames?:string[];onBucketChange?:(bucket:string)=>void}){
  const [settings,setSettings]=useState<R2ConnectionStatus|null>(null),[settingsOpen,setSettingsOpen]=useState(false),[buckets,setBuckets]=useState<R2Bucket[]>([]),[bucket,setBucket]=useState(initialBucket),[prefix,setPrefix]=useState(''),[listing,setListing]=useState<R2ListResult|null>(null),[query,setQuery]=useState(''),[searchPage,setSearchPage]=useState<R2SearchResult|null>(null),[selected,setSelected]=useState<Set<string>>(new Set()),[downloads,setDownloads]=useState<R2DownloadInfo[]|null>(null),[batchOpen,setBatchOpen]=useState(false),[uploads,setUploads]=useState<TransferJob[]>([]),[templates,setTemplates]=useState<R2BatchDownloadTemplate[]>([]),[metrics,setMetrics]=useState<any>(null),[createBucketOpen,setCreateBucketOpen]=useState(false),[moveTarget,setMoveTarget]=useState<R2Object|null>(null),[uploadConflict,setUploadConflict]=useState<UploadConflict|null>(null);
  const moveStatuses=useRef(new Map<string,TransferJob['status']>());
  const usable=Boolean(settings?.configured||settings?.secretConfigured);
  const refreshSettings=async()=>setSettings(await window.batchStudio.r2.settings());
  const loadBuckets=async()=>{const b=await window.batchStudio.r2.buckets();setBuckets(b);setBucket(prev=>prev&&b.some(x=>x.name===prev)?prev:readOnly?'':(b[0]?.name??''))};
  const loadList=async()=>{if(!bucket){setListing(null);return}setSearchPage(null);setQuery('');setListing(await window.batchStudio.r2.list(bucket,prefix));};
  const loadUploads=async()=>{
    const next=await window.batchStudio.r2.uploads() as TransferJob[];
    let moveCompleted=false;
    for(const job of next.filter(j=>j.kind==='move')){
      const previous=moveStatuses.current.get(job.id);
      if(previous!=='complete'&&job.status==='complete')moveCompleted=true;
      moveStatuses.current.set(job.id,job.status);
    }
    setUploads(next);
    if(moveCompleted&&bucket)await loadList();
  };
  const loadMetrics=async()=>{const m=await window.batchStudio.r2.metrics();setMetrics(m.configured?m.payload:null)};
  useEffect(()=>{void refreshSettings()},[]);
  useEffect(()=>{if(usable)void run(async()=>{await loadBuckets();if(!readOnly)await loadUploads();await loadMetrics().catch(()=>{})})},[usable,readOnly]);
  useEffect(()=>{if(bucket)void run(loadList);else{setListing(null);setSearchPage(null)}},[bucket,prefix]);
  useEffect(()=>{if(bucket)void window.batchStudio.r2.templates(bucket).then(setTemplates);else setTemplates([])},[bucket]);
  useEffect(()=>{if(readOnly)return;const id=setInterval(()=>{void loadUploads()},1000);return()=>clearInterval(id)},[readOnly,bucket,prefix]);
  useEffect(()=>{if(!bucket)return;const q=query.trim();if(!q){setSearchPage(null);return}const id=window.setTimeout(()=>{void window.batchStudio.r2.search(bucket,q).then(setSearchPage).catch(()=>{})},120);return()=>window.clearTimeout(id)},[bucket,query]);
  const current=searchPage?.objects??listing?.objects??[];
  const selectedBucket=buckets.find(b=>b.name===bucket);
  const moreSearch=()=>run(async()=>{if(!searchPage?.nextToken)return;const next=await window.batchStudio.r2.search(bucket,query,searchPage.nextToken);setSearchPage({...next,objects:[...searchPage.objects,...next.objects],scanned:searchPage.scanned+next.scanned})});
  const toggle=(key:string)=>setSelected(prev=>{const n=new Set(prev);n.has(key)?n.delete(key):n.add(key);return n});
  const deleteSelected=()=>run(async()=>{if(!selected.size||!confirm(`${selected.size}件をR2から削除しますか？`))return;await window.batchStudio.r2.deleteObjects(bucket,[...selected]);setSelected(new Set());await loadList()});
  const processUploads=async(files:string[])=>{for(let i=0;i<files.length;i++){const filePath=files[i];try{await window.batchStudio.r2.beginUpload(bucket,prefix,filePath,false)}catch(error){if(!isUploadConflict(error))throw error;setUploadConflict({filePath,fileName:localFileName(filePath),key:uploadObjectKey(prefix,filePath),remaining:files.slice(i+1)});await loadUploads();return}}await loadUploads()};
  const chooseUpload=()=>run(async()=>{const files=await window.batchStudio.r2.selectUploadFiles();await processUploads(files)});
  const resolveUploadConflict=(overwrite:boolean)=>{const conflict=uploadConflict;if(!conflict)return;setUploadConflict(null);void run(async()=>{if(overwrite)await window.batchStudio.r2.beginUpload(bucket,prefix,conflict.filePath,true);await processUploads(conflict.remaining)})};
  const directDownload=(object:R2Object)=>run(async()=>{const info=await window.batchStudio.r2.downloadInfo(bucket,object.key);const link=document.createElement('a');link.href=info.url;link.download=info.fileName;link.rel='noopener';document.body.append(link);link.click();link.remove()});
  const changeBucket=(next:string)=>{setBucket(next);setPrefix('');setSelected(new Set());if(readOnly)onBucketChange?.(next)};
  return <section className={`r2manager${readOnly?' readonly':''}`}>
    <div className="panelhead"><div><h3>{readOnly?'R2 モデル参照':'R2 ファイル管理'}</h3><p>{readOnly?'モデル配置ではR2を読み取り専用で参照します。管理操作はホームのR2 File Managerから行ってください。':'Cloudflare R2をBatch Studio内から直接操作します。'}</p></div><div className="actions"><button onClick={()=>setSettingsOpen(true)}>接続設定</button>{usable&&<button onClick={()=>run(async()=>{await loadBuckets();await loadMetrics().catch(()=>{})})}>再読込</button>}</div></div>
    {!usable&&<div className="issue warning">R2接続設定が未構成です。「接続設定」から設定してください。</div>}
    {usable&&<>
      {metrics&&<div className="facts r2metrics"><div>Stored <b>{fmt(Number(metrics.stored_bytes??0))}</b></div><div>Objects <b>{Number(metrics.objects??0).toLocaleString()}</b></div><div>Uploading <b>{fmt(Number(metrics.uploading_bytes??0))}</b></div><div>Standard <b>{fmt(Number(metrics.storage_classes?.standard?.stored_bytes??0))}</b></div><div>IA <b>{fmt(Number(metrics.storage_classes?.infrequent_access?.stored_bytes??0))}</b></div></div>}
      <div className="r2toolbar"><select value={bucket} onChange={e=>changeBucket(e.target.value)}>{readOnly&&<option value="">モデル保管バケットを選択</option>}{buckets.map(b=><option key={b.name}>{b.name}</option>)}</select>{selectedBucket?.createdAt&&<small>作成: {new Date(selectedBucket.createdAt).toLocaleString()}</small>}{!readOnly&&<><button onClick={()=>setCreateBucketOpen(true)}>バケット作成</button><button disabled={!bucket} onClick={()=>run(async()=>{if(confirm(`${bucket} を削除しますか？ 空のバケットのみ削除できます。`)){await window.batchStudio.r2.deleteBucket(bucket);setBucket('');await loadBuckets()}})}>バケット削除</button><span className="spacer"/><button disabled={!bucket} onClick={chooseUpload}>アップロード</button></>}{readOnly&&<span className="spacer"/>}<button disabled={!bucket} className="primary" onClick={()=>setBatchOpen(true)}>一括DLのURL生成</button></div>
      {readOnly&&bucket&&<div className="issue info">モデル補完先: <b>{bucket}</b>。バケット選択時点でProject設定へ保存されます。</div>}
      {bucket&&<><PathBar prefix={prefix}/>
      <div className="r2search"><input placeholder="バケット全体をファイル名/パスでリアルタイム検索" value={query} onChange={e=>setQuery(e.target.value)}/>{query&&<small>ローカル同期済み索引から検索</small>}</div>
      <div className="r2table">
        <div className="r2row head"><span/><b>名前</b><b>Storage</b><b>サイズ</b><b>更新</b><b>操作</b></div>
        {!searchPage&&prefix&&<div className="r2row folder parent"><span/><button className="r2namebutton" title={parentPrefix(prefix)||'/'} onClick={()=>setPrefix(parentPrefix(prefix))}>📁 ../</button><span>—</span><span>—</span><span>—</span><span/></div>}
        {!searchPage&&listing?.folders.map(f=><div className="r2row folder" key={f.prefix}><span/><button className="r2namebutton" title={f.prefix} onClick={()=>setPrefix(f.prefix)}>📁 {f.name}</button><span>—</span><span>—</span><span>—</span><span className="actions"><button onClick={()=>setPrefix(f.prefix)}>開く</button></span></div>)}
        {current.map(o=><div className="r2row" key={o.key}>{readOnly?<span/>:<input type="checkbox" checked={selected.has(o.key)} onChange={()=>toggle(o.key)}/>}<span title={o.key}>{searchPage?o.key:o.name}</span><span>{o.storageClass??'STANDARD'}</span><span>{fmt(o.size)}</span><span>{o.lastModified?new Date(o.lastModified).toLocaleString():'-'}</span><span className="actions"><button onClick={()=>void directDownload(o)}>DL</button><button onClick={()=>run(async()=>setDownloads([await window.batchStudio.r2.downloadInfo(bucket,o.key)]))}>DL情報</button>{!readOnly&&<button onClick={()=>setMoveTarget(o)}>移動</button>}</span></div>)}
        {!searchPage&&listing&&listing.folders.length===0&&current.length===0&&<div className="r2empty">このフォルダは空です。</div>}
        {searchPage&&current.length===0&&<div className="r2empty">検索結果がありません。</div>}
      </div>
      {!searchPage&&listing?.nextToken&&<button onClick={()=>run(async()=>{const next=await window.batchStudio.r2.list(bucket,prefix,listing.nextToken);setListing({...next,folders:[...listing.folders,...next.folders],objects:[...listing.objects,...next.objects]})})}>さらに読み込む</button>}
      {searchPage?.nextToken&&<button onClick={moreSearch}>検索結果をさらに表示</button>}
      {!readOnly&&selected.size>0&&<div className="selectionbar"><b>{selected.size}件選択</b><button className="danger" onClick={deleteSelected}>選択したファイルを削除</button></div>}
      {!readOnly&&<TransferJobs jobs={uploads} run={run} refresh={loadUploads}/>}</>}
    </>}
    {settingsOpen&&<SettingsModal status={settings} onClose={()=>setSettingsOpen(false)} onSaved={async()=>{await refreshSettings();setSettingsOpen(false)}} run={run}/>} 
    {createBucketOpen&&<BucketCreateModal onClose={()=>setCreateBucketOpen(false)} onCreated={async()=>{setCreateBucketOpen(false);await loadBuckets()}} run={run}/>} 
    {moveTarget&&bucket&&<MoveObjectModal bucket={bucket} object={moveTarget} onClose={()=>setMoveTarget(null)} onQueued={()=>setMoveTarget(null)}/>} 
    {uploadConflict&&<UploadConflictModal conflict={uploadConflict} onOverwrite={()=>resolveUploadConflict(true)} onSkip={()=>resolveUploadConflict(false)}/>} 
    {downloads&&<DownloadModal downloads={downloads} onClose={()=>setDownloads(null)}/>} 
    {batchOpen&&bucket&&<BatchDownloadModal bucket={bucket} initialPrefix={prefix} initialFileNames={initialBatchFileNames} templates={templates} onClose={()=>setBatchOpen(false)} onGenerated={d=>{setBatchOpen(false);setDownloads(d)}} onTemplates={setTemplates} run={run}/>} 
  </section>;
}

function PathBar({prefix}:{prefix:string}){return <div className="r2pathbar"><div className="r2path" title={displayPath(prefix)}>{displayPath(prefix)}</div></div>}

function BucketCreateModal({onClose,onCreated,run}:{onClose:()=>void;onCreated:()=>Promise<void>;run:Runner}){
  const [name,setName]=useState('');
  const bucketName=name.trim();
  const submit=()=>{if(!bucketName)return;void run(async()=>{await window.batchStudio.r2.createBucket(bucketName);await onCreated()})};
  return <div className="modal"><form className="modalcard" onSubmit={e=>{e.preventDefault();submit()}}><div className="panelhead"><div><h2>バケット作成</h2><small>新しいR2バケット名を入力してください。</small></div><button type="button" onClick={onClose}>×</button></div><div className="formgrid"><label>バケット名<input autoFocus value={name} onChange={e=>setName(e.target.value)}/></label></div><div className="actions"><button type="button" onClick={onClose}>キャンセル</button><button type="submit" className="primary" disabled={!bucketName}>作成</button></div></form></div>;
}

function MoveObjectModal({bucket,object,onClose,onQueued}:{bucket:string;object:R2Object;onClose:()=>void;onQueued:()=>void}){
  const [destination,setDestination]=useState(object.key),[overwrite,setOverwrite]=useState(false),[moving,setMoving]=useState(false),[error,setError]=useState('');
  let normalized='';let validationError='';try{normalized=normalizeR2ObjectKey(destination)}catch(e){validationError=e instanceof Error?e.message:String(e)}
  const valid=!validationError&&normalized!==object.key;
  const submit=async()=>{if(!valid||moving)return;setMoving(true);setError('');try{await window.batchStudio.r2.move(bucket,object.key,normalized,overwrite);onQueued()}catch(e){setError(e instanceof Error?e.message:String(e));setMoving(false)}};
  return <div className="modal"><form className="modalcard move-object-modal" onSubmit={e=>{e.preventDefault();void submit()}}><div className="panelhead"><div><h2>ファイルを移動</h2><small>移動はバックグラウンド転送として開始され、下部の転送一覧で進捗を確認できます。</small></div><button type="button" disabled={moving} onClick={onClose}>×</button></div><div className="formgrid"><label>移動元<input readOnly value={object.key}/></label><label>移動先のオブジェクトキー<input autoFocus disabled={moving} value={destination} onChange={e=>setDestination(e.target.value)}/></label></div><label className="move-overwrite"><input type="checkbox" disabled={moving} checked={overwrite} onChange={e=>setOverwrite(e.target.checked)}/><span>既存オブジェクトがある場合は上書きする</span></label>{validationError&&<p className="issue warning">{validationError}</p>}{!validationError&&normalized===object.key&&<p className="issue warning">移動先は現在のオブジェクトキーとは異なる値を指定してください。</p>}{moving&&<div className="move-status" role="status" aria-live="polite"><span className="move-spinner" aria-hidden="true"/><span><b>移動ジョブを登録中…</b><small>登録後はこの画面を閉じても転送を継続します。</small></span></div>}{error&&<p className="issue error" role="alert">{error}</p>}<div className="actions move-actions"><button type="button" disabled={moving} onClick={onClose}>キャンセル</button><button type="submit" className="primary" disabled={!valid||moving}>{moving?'登録中…':'移動'}</button></div></form></div>;
}

function UploadConflictModal({conflict,onOverwrite,onSkip}:{conflict:UploadConflict;onOverwrite:()=>void;onSkip:()=>void}){
  return <div className="modal"><div className="modalcard"><div className="panelhead"><div><h2>同名ファイルがあります</h2><small>アップロード先に同じ名前のファイルが存在します。</small></div></div><div className="formgrid"><label>ファイル名<input readOnly value={conflict.fileName}/></label><label>アップロード先<input readOnly value={conflict.key}/></label></div><p className="issue warning">上書きすると、R2上の既存ファイルは新しいファイルに置き換えられます。</p><div className="actions"><button type="button" onClick={onSkip}>上書きしない</button><button type="button" className="primary" onClick={onOverwrite}>上書きする</button></div></div></div>;
}

function SettingsModal({status,onClose,onSaved,run}:{status:R2ConnectionStatus|null;onClose:()=>void;onSaved:()=>void;run:Runner}){const [v,setV]=useState<R2ConnectionInput>({name:status?.name??'Personal R2',accountId:status?.accountId??'',accessKeyId:status?.accessKeyId??'',secretAccessKey:'',publicUrl:status?.publicUrl??'',cloudflareApiToken:''});useEffect(()=>{void window.batchStudio.r2.environment().then(e=>setV(p=>({name:p.name||e.name,accountId:p.accountId||e.accountId,accessKeyId:p.accessKeyId||e.accessKeyId,secretAccessKey:p.secretAccessKey||e.secretAccessKey,publicUrl:p.publicUrl||e.publicUrl,cloudflareApiToken:p.cloudflareApiToken||e.cloudflareApiToken})))},[]);const f=(k:keyof R2ConnectionInput,label:string,type='text')=><label>{label}<input type={type} value={v[k]??''} onChange={e=>setV({...v,[k]:e.target.value})}/></label>;return <div className="modal"><div className="modalcard"><div className="panelhead"><h2>R2 接続設定</h2><button onClick={onClose}>×</button></div><div className="formgrid">{f('name','接続名')}{f('accountId','Cloudflare Account ID')}{f('accessKeyId','R2 Access Key ID')}{f('secretAccessKey',status?.secretConfigured?'Secret Access Key（変更時のみ）':'Secret Access Key','password')}{f('publicUrl','Public URL（任意）')}{f('cloudflareApiToken',status?.metricsTokenConfigured?'Cloudflare API Token（変更時のみ）':'Cloudflare API Token（任意）','password')}</div><p>保存済みSecretは同じAccount / Access Keyなら再入力不要です。SecretはProject JSONやRendererへ保存せずOS暗号化ストレージで保護します。</p><div className="actions"><button onClick={()=>run(()=>window.batchStudio.r2.test(v))}>接続テスト</button><button className="primary" onClick={()=>run(async()=>{await window.batchStudio.r2.saveSettings(v);onSaved()})}>保存</button></div></div></div>}

function TransferJobs({jobs,run,refresh}:{jobs:TransferJob[];run:Runner;refresh:()=>Promise<void>}){
  const active=jobs.filter(j=>!['complete','cancelled'].includes(j.status));
  if(!active.length)return null;
  return <section className="r2uploads"><h4>転送</h4>{active.map(j=>{
    const move=j.kind==='move',percent=j.size?Math.floor(j.transferredBytes/j.size*100):j.status==='complete'?100:0,speed=transferSpeed(j),eta=formatEta(j);
    const status=move?(j.status==='uploading'?'移動中':j.status==='failed'?'移動失敗':j.status):j.status;
    return <div className="uploadjob" key={j.id}><div><b>{move?`移動: ${j.destinationKey??j.key}`:j.fileName}</b><small>{move?`${j.sourceKey??''} → ${j.destinationKey??j.key}`:j.key}</small></div><progress max={Math.max(j.size,1)} value={j.transferredBytes}/><span>{status} {percent}%{speed>0&&j.status==='uploading'?<small>{fmt(speed)}/s{eta?`・${eta}`:''}</small>:null}</span><div className="actions">{!move&&<>{j.status==='uploading'?<button onClick={()=>run(async()=>{await window.batchStudio.r2.pauseUpload(j.id);await refresh()})}>一時停止</button>:<button onClick={()=>run(async()=>{await window.batchStudio.r2.resumeUpload(j.id);await refresh()})}>再開</button>}<button onClick={()=>run(async()=>{await window.batchStudio.r2.cancelUpload(j.id);await refresh()})}>キャンセル</button></>}{move&&j.status==='failed'&&<small>ファイル一覧を確認して再実行してください。</small>}</div>{j.error&&<span className="error transfer-error">{j.error}</span>}</div>})}</section>
}

function DownloadModal({downloads,onClose}:{downloads:R2DownloadInfo[];onClose:()=>void}){
  const [tab,setTab]=useState<'url'|'curl'|'wget'|'aria2c'>('url'),[connections,setConnections]=useState(3),[concurrent,setConcurrent]=useState(3);
  const text=tab==='aria2c'?buildAria2Command(downloads,connections,concurrent):downloads.map(d=>d.commands[tab]).join('\n');
  return <div className="modal"><div className="modalcard large"><div className="panelhead"><div><h2>ダウンロード情報</h2><small>{downloads.length}件 / {downloads.every(d=>d.public)?'Public URL':'署名URL'}</small></div><button onClick={onClose}>×</button></div><div className="tabs">{(['url','curl','wget','aria2c'] as const).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t}</button>)}</div>{tab==='aria2c'&&<div className="aria2-settings"><label>同時ダウンロード数（-j）<input type="number" min={1} max={16} value={concurrent} onChange={e=>setConcurrent(normalizeAria2ConcurrentDownloads(e.target.value))}/></label><label>1ファイルあたり接続数（-x）<input type="number" min={1} max={16} value={connections} onChange={e=>setConnections(normalizeAria2Connections(e.target.value))}/></label><small>1～16。既に同名ファイルがある場合は上書き・自動リネームせずスキップします。</small></div>}<textarea className="commandbox" readOnly value={text}/><div className="actions"><button className="primary" onClick={()=>window.batchStudio.clipboard.writeText(text)}>すべてコピー</button></div></div></div>
}

function BatchDownloadModal({bucket,initialPrefix,initialFileNames,templates,onClose,onGenerated,onTemplates,run}:{bucket:string;initialPrefix:string;initialFileNames:string[];templates:R2BatchDownloadTemplate[];onClose:()=>void;onGenerated:(d:R2DownloadInfo[])=>void;onTemplates:(t:R2BatchDownloadTemplate[])=>void;run:Runner}){
  const [prefix,setPrefix]=useState(initialPrefix),[listing,setListing]=useState<R2ListResult|null>(null),[query,setQuery]=useState(''),[searchPage,setSearchPage]=useState<R2SearchResult|null>(null),[selected,setSelected]=useState<Map<string,{key:string;name:string;size?:number}>>(new Map()),[templateName,setTemplateName]=useState(''),[templateId,setTemplateId]=useState('');
  const load=()=>run(async()=>{setSearchPage(null);setQuery('');setListing(await window.batchStudio.r2.list(bucket,prefix))});
  useEffect(()=>{void load()},[prefix]);
  useEffect(()=>{let cancelled=false;if(!initialFileNames.length)return;void (async()=>{const seeded=new Map<string,{key:string;name:string;size?:number}>();for(const fileName of [...new Set(initialFileNames)].slice(0,500)){const page=await window.batchStudio.r2.search(bucket,fileName);const match=page.objects.find(o=>sameFileName(o.name,fileName));if(match)seeded.set(match.key,{key:match.key,name:match.name,size:match.size})}if(!cancelled)setSelected(seeded)})().catch(()=>{});return()=>{cancelled=true}},[bucket,initialFileNames.join('\u0000')]);
  useEffect(()=>{const q=query.trim();if(!q){setSearchPage(null);return}const id=window.setTimeout(()=>{void window.batchStudio.r2.search(bucket,q).then(setSearchPage).catch(()=>{})},120);return()=>window.clearTimeout(id)},[bucket,query]);
  const visible=searchPage?.objects??listing?.objects??[];
  const selectedTotal=[...selected.values()].reduce((total,item)=>total+Number(item.size??0),0);
  const toggle=(o:R2Object)=>setSelected(prev=>{const n=new Map(prev);n.has(o.key)?n.delete(o.key):n.size<500&&n.set(o.key,{key:o.key,name:o.name,size:o.size});return n});
  const addVisible=()=>setSelected(prev=>{const n=new Map(prev);for(const o of visible){if(n.size>=500)break;n.set(o.key,{key:o.key,name:o.name,size:o.size})}return n});
  const more=()=>run(async()=>{if(!searchPage?.nextToken)return;const next=await window.batchStudio.r2.search(bucket,query,searchPage.nextToken);setSearchPage({...next,objects:[...searchPage.objects,...next.objects],scanned:searchPage.scanned+next.scanned})});
  const applyTemplate=(id:string)=>{setTemplateId(id);const t=templates.find(x=>x.id===id);if(t)setSelected(new Map(t.objects.map(o=>[o.key,o])))};
  const overwriteTemplate=()=>{const t=templates.find(x=>x.id===templateId);if(!t||!selected.size)return;void run(async()=>onTemplates(await window.batchStudio.r2.saveTemplate({id:t.id,name:t.name,bucket,objects:[...selected.values()]})))};
  return <div className="modal"><div className="modalcard xlarge batch-download-modal">
    <div className="batch-modal-head"><div><h2>一括DLのURL生成</h2><small>メイン一覧とは独立した選択です。最大500件。</small></div><button onClick={onClose}>×</button></div>
    <section className="batchtemplates top">
      <div className="batch-template-heading"><h3>テンプレート</h3><small>保存済みテンプレートを選択するとファイル選択へ反映します。</small></div>
      <div className="batch-template-controls">
        <div className="batch-template-row"><select value={templateId} onChange={e=>applyTemplate(e.target.value)}><option value="">テンプレートを選択</option>{templates.map(t=><option key={t.id} value={t.id}>{t.name}（{t.objects.length}件）</option>)}</select><div className="batch-template-actions"><button disabled={!templateId||!selected.size} onClick={overwriteTemplate}>現在の選択で上書き</button><button disabled={!templateId} onClick={()=>run(async()=>{onTemplates(await window.batchStudio.r2.deleteTemplate(templateId));setTemplateId('')})}>削除</button></div></div>
        <div className="batch-template-row"><input placeholder="新しいテンプレート名" value={templateName} maxLength={100} onChange={e=>setTemplateName(e.target.value)}/><button disabled={!templateName.trim()||!selected.size} onClick={()=>run(async()=>{onTemplates(await window.batchStudio.r2.saveTemplate({name:templateName,bucket,objects:[...selected.values()]}));setTemplateName('')})}>現在の選択を保存</button></div>
      </div>
    </section>
    <section className="batchbrowser">
      <PathBar prefix={prefix}/>
      <div className="batch-browser-search"><input value={query} placeholder="バケット全体をリアルタイム検索" onChange={e=>setQuery(e.target.value)}/><button onClick={addVisible}>表示中をすべて選択</button></div>
      <div className="r2table compact"><div className="r2row head"><span/><b>名前</b><b>サイズ</b></div>{!searchPage&&prefix&&<div className="r2row folder parent"><span/><button className="r2namebutton" onClick={()=>setPrefix(parentPrefix(prefix))}>📁 ../</button><span>—</span></div>}{!searchPage&&listing?.folders.map(f=><div className="r2row folder" key={f.prefix}><span/><button className="r2namebutton" onClick={()=>setPrefix(f.prefix)}>📁 {f.name}</button><span>—</span></div>)}{visible.map(o=><label className="r2row" key={o.key}><input type="checkbox" checked={selected.has(o.key)} disabled={!selected.has(o.key)&&selected.size>=500} onChange={()=>toggle(o)}/><span>{searchPage?o.key:o.name}</span><span>{fmt(o.size)}</span></label>)}</div>
      {searchPage?.nextToken&&<button className="batch-more" onClick={more}>検索結果をさらに表示</button>}
    </section>
    <section className="batchselected"><div className="batch-selected-head"><h3>選択済みファイル {selected.size} / 500件 <small>合計 {formatBatchTotalSize(selectedTotal)}</small></h3><button onClick={()=>setSelected(new Map())}>すべて解除</button></div>{[...selected.values()].map(o=><div className="selecteditem" key={o.key}><span><b>{o.name}</b><small>{o.key}</small></span><span>{o.size!=null?fmt(o.size):''}</span><button onClick={()=>setSelected(p=>{const n=new Map(p);n.delete(o.key);return n})}>×</button></div>)}</section>
    <div className="batch-modal-footer"><button onClick={onClose}>キャンセル</button><button className="primary" disabled={!selected.size} onClick={()=>run(async()=>{onGenerated(await window.batchStudio.r2.batchDownloadInfo(bucket,[...selected.keys()]))})}>選択した{selected.size}件を生成</button></div>
  </div></div>;
}
