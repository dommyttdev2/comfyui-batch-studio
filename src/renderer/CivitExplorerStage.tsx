import { useEffect, useMemo, useState } from 'react';
import type { CatalogCollection, CatalogItem, CivitaiCatalogStatus, ModelCatalog } from '../shared/types';
import type { Runner } from './ui';

const norm=(value:string)=>value.normalize('NFKC').toLocaleLowerCase('ja');
function searchable(item:CatalogItem){return norm([item.modelName,...(item.versions??[]).flatMap(v=>v.files.map(f=>f.name)),...item.files.map(f=>f.name)].join('\n'))}

export function CivitExplorerStage({run}:{run:Runner}){
  const [status,setStatus]=useState<CivitaiCatalogStatus|null>(null),[catalog,setCatalog]=useState<ModelCatalog|null>(null),[collectionId,setCollectionId]=useState<number|null>(null),[query,setQuery]=useState('');
  const load=async()=>{setStatus(await window.batchStudio.catalog.integratedStatus());setCatalog(await window.batchStudio.catalog.snapshot())};
  useEffect(()=>{void run(load)},[]);
  useEffect(()=>{if(status?.state!=='running')return;const id=window.setInterval(()=>{void window.batchStudio.catalog.integratedStatus().then(async s=>{setStatus(s);if(s.state==='ready')setCatalog(await window.batchStudio.catalog.snapshot())})},700);return()=>clearInterval(id)},[status?.state]);
  const collections=catalog?.collections??[];
  const active=collectionId==null?null:collections.find(c=>c.id===collectionId)??null;
  const q=norm(query.trim());
  const models=useMemo(()=>{const source=active?[active]:collections;const rows:Array<{collection:CatalogCollection;item:CatalogItem}>=[];for(const c of source)for(const item of c.items)if(!q||searchable(item).includes(q))rows.push({collection:c,item});return rows},[active,collections,q]);
  return <section className="panel">
    <div className="panelhead"><div><h2>Civit Explorer</h2><p>Projectを開かずにCivitai Collectionとモデルカタログを閲覧できます。</p></div><div className="actions"><button disabled={status?.state==='running'||!status?.apiKeyConfigured} onClick={()=>run(async()=>setStatus(await window.batchStudio.catalog.sync()))}>↻ SYNC</button></div></div>
    {status?.state==='running'&&<div className="catalog-progress"><div><strong>{status.phase}</strong><span>{status.completed} / {status.total}</span></div><progress value={status.completed} max={Math.max(status.total,1)}/><p>{status.message}</p></div>}
    {status?.state==='error'&&<div className="issue error">✕ {status.error??status.message}</div>}
    {!status?.apiKeyConfigured&&<div className="issue warning">CIVIT_API_KEY が設定されていません。</div>}
    <div className="catalog-browser-nav"><button className={collectionId==null?'active':''} onClick={()=>setCollectionId(null)}>すべて</button>{collections.map(c=><button key={c.id} className={collectionId===c.id?'active':''} onClick={()=>setCollectionId(c.id)}>{c.name} <span>{c.items.length}</span></button>)}</div>
    <div className="r2search"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="モデル名 / ファイル名を検索"/></div>
    <div className="r2table"><div className="r2row head"><span/><b>モデル</b><b>Version</b><b>ファイル</b><b>操作</b></div>{models.map(({collection,item})=><div className="r2row" key={`${collection.id}:${item.modelId}`}><span/><span><b>{item.modelName}</b><small>{collection.name}</small></span><span>{item.versionName}</span><span>{item.files.map(f=>f.name).join(', ')||'—'}</span><span className="actions">{item.modelUrl&&<button onClick={()=>window.batchStudio.catalog.openModel(item.modelUrl!)}>Civitaiで開く</button>}</span></div>)}</div>
  </section>;
}
