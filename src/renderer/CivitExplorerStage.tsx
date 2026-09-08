import { useEffect, useMemo, useState } from 'react';
import type { CatalogCollection, CatalogItem, CatalogVersion, CivitaiCatalogStatus, ModelCatalog } from '../shared/types';
import type { Runner } from './ui';
import './civit-explorer.css';

const norm=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ja');
function searchable(item:CatalogItem){return norm([item.modelName,item.versionName,...(item.trainedWords??[]),...(item.versions??[]).flatMap(v=>[v.versionName,...v.files.map(f=>f.name),...(v.trainedWords??[])]),...item.files.map(f=>f.name)].join('\n'))}
function versionFor(item:CatalogItem,versionId?:number):CatalogVersion|undefined{return item.versions?.find(v=>v.versionId===versionId)??item.versions?.find(v=>v.versionId===item.versionId)??item.versions?.[0]}

export function CivitExplorerStage({run}:{run:Runner}){
  const [status,setStatus]=useState<CivitaiCatalogStatus|null>(null),[catalog,setCatalog]=useState<ModelCatalog|null>(null),[collectionId,setCollectionId]=useState<number|null>(null),[query,setQuery]=useState(''),[versionIds,setVersionIds]=useState<Record<number,number>>({});
  const load=async()=>{setStatus(await window.batchStudio.catalog.integratedStatus());setCatalog(await window.batchStudio.catalog.snapshot())};
  useEffect(()=>{void run(load)},[]);
  useEffect(()=>{if(status?.state!=='running')return;const id=window.setInterval(()=>{void window.batchStudio.catalog.integratedStatus().then(async s=>{setStatus(s);if(s.state==='ready')setCatalog(await window.batchStudio.catalog.snapshot())})},700);return()=>clearInterval(id)},[status?.state]);
  const collections=catalog?.collections??[];
  const active=collectionId==null?null:collections.find(c=>c.id===collectionId)??null;
  const q=norm(query.trim());
  const models=useMemo(()=>{const source=active?[active]:collections;const rows:Array<{collection:CatalogCollection;item:CatalogItem}>=[];for(const c of source)for(const item of c.items)if(!q||searchable(item).includes(q))rows.push({collection:c,item});return rows},[active,collections,q]);
  const totalModels=useMemo(()=>collections.reduce((n,c)=>n+c.items.length,0),[collections]);
  return <section className="civit-explorer">
    <div className="civit-explorer-head">
      <div><span className="eyebrow">CIVITAI MODEL INVENTORY</span><h2>Civit Explorer</h2><p>CollectionとModelをサムネイル中心で閲覧します。Projectのモデル選定では全量の model_catalog.json をGrokへ渡します。</p></div>
      <div className="actions"><button disabled={status?.state==='running'||!status?.apiKeyConfigured} onClick={()=>run(async()=>setStatus(await window.batchStudio.catalog.sync()))}>↻ SYNC</button></div>
    </div>
    {status?.state==='running'&&<div className="catalog-progress"><div><strong>{status.phase}</strong><span>{status.completed} / {status.total}</span></div><progress value={status.completed} max={Math.max(status.total,1)}/><p>{status.message}</p></div>}
    {status?.state==='error'&&<div className="issue error">✕ {status.error??status.message}</div>}
    {!status?.apiKeyConfigured&&<div className="issue warning">CIVIT_API_KEY が設定されていません。</div>}
    <div className="civit-explorer-toolbar">
      <label><span>MODEL / FILE / TRIGGER</span><input type="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="モデル名・ファイル名・トリガーワードを検索"/></label>
      <div className="civit-explorer-stats"><div><b>{collections.length}</b><small>Collections</small></div><div><b>{totalModels}</b><small>Models</small></div><div><b>{models.length}</b><small>Shown</small></div></div>
    </div>
    <div className="civit-explorer-layout">
      <aside className="civit-library">
        <div className="civit-pane-title"><div><span className="eyebrow">YOUR LIBRARY</span><h3>コレクション</h3></div><b>{collections.length}</b></div>
        <button className={`civit-collection-card all ${collectionId==null?'active':''}`} onClick={()=>setCollectionId(null)}><span className="civit-collection-thumb all">ALL</span><span><strong>すべてのコレクション</strong><small>{totalModels} models</small></span></button>
        <div className="civit-collection-list">{collections.map(c=><button className={`civit-collection-card ${collectionId===c.id?'active':''}`} key={c.id} onClick={()=>setCollectionId(c.id)}>{c.thumbnailUrl?<img className="civit-collection-thumb" src={c.thumbnailUrl} alt="" loading="lazy"/>:<span className="civit-collection-thumb placeholder">COL</span>}<span className="civit-collection-copy"><strong>{c.name}</strong><small>{c.description||'説明はありません'}</small><span>{c.items.length} models{c.read?` · ${c.read}`:''}</span></span></button>)}</div>
      </aside>
      <main className="civit-model-pane">
        <div className="civit-pane-title"><div><span className="eyebrow">MODEL SHELF</span><h3>{active?.name??'すべてのモデル'}</h3></div><b>{models.length}</b></div>
        {models.length===0?<div className="empty-inline">一致するモデルがありません。</div>:<div className="civit-model-grid">{models.map(({collection,item})=>{const selectedVersionId=versionIds[item.modelId]??item.versionId;const v=versionFor(item,selectedVersionId);const files=v?.files??item.files;const trained=v?.trainedWords??item.trainedWords??[];const image=v?.thumbnailUrl??item.thumbnailUrl;const baseline=v?.strengthBaseline??item.strengthBaseline;const modelUrl=v?.modelUrl??item.modelUrl;return <article className="civit-model-card" key={`${collection.id}:${item.modelId}`}>
          <div className="civit-model-image">{image?<img src={image} alt="" loading="lazy"/>:<div className="civit-model-placeholder">MODEL</div>}<span>{collection.name}</span></div>
          <div className="civit-model-content"><div className="civit-model-title"><div><strong>{item.modelName}</strong><small>Model ID {item.modelId}</small></div>{modelUrl&&<button onClick={()=>window.batchStudio.catalog.openModel(modelUrl)}>Civitai</button>}</div>
          {(item.versions?.length??0)>1?<label className="civit-version-select"><span>Version</span><select value={v?.versionId??item.versionId} onChange={e=>setVersionIds(p=>({...p,[item.modelId]:Number(e.target.value)}))}>{item.versions!.map(x=><option key={x.versionId} value={x.versionId}>{x.versionName}</option>)}</select></label>:<div className="civit-version-static"><span>Version</span><b>{v?.versionName??item.versionName}</b></div>}
          <div className="civit-meta-block"><span>FILES</span>{files.length?<div className="civit-chips">{files.map(f=><code key={f.id} title={f.name}>{f.name}</code>)}</div>:<small>—</small>}</div>
          <div className="civit-meta-block"><span>TRIGGER WORDS</span>{trained.length?<div className="civit-chips words">{trained.map(w=><code key={w}>{w}</code>)}</div>:<small>—</small>}</div>
          <div className="civit-card-footer"><span>Version ID {v?.versionId??item.versionId}</span>{baseline?<b>Baseline {baseline.value}</b>:<span>Baseline —</span>}</div></div>
        </article>})}</div>}
      </main>
    </div>
  </section>;
}
