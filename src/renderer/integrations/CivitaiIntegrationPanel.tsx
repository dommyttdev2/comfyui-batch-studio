import { useEffect, useState } from 'react';
import type { CivitaiConnectionStatus } from '../../shared/types';
import type { Runner } from '../ui';

function statusLabel(status:CivitaiConnectionStatus|null){if(!status?.configured)return'未設定';return status.source==='environment'?'環境変数を使用':'設定済み';}

export function CivitaiIntegrationPanel({run,onBack,onOpenExplorer,onStatus}:{run:Runner;onBack:()=>void;onOpenExplorer:()=>void;onStatus:(s:CivitaiConnectionStatus)=>void}){
  const [status,setStatus]=useState<CivitaiConnectionStatus|null>(null),[apiKey,setApiKey]=useState('');
  useEffect(()=>{let cancelled=false;void window.batchStudio.civitai.settings().then(s=>{if(!cancelled){setStatus(s);onStatus(s)}}).catch(()=>{});return()=>{cancelled=true};},[]);
  const save=()=>run(async()=>{const next=await window.batchStudio.civitai.saveSettings({apiKey});setStatus(next);onStatus(next);setApiKey('');});
  return <section className="panel service-page"><div className="service-page-head"><button onClick={onBack}>← サービス連携</button><div><h3>Civitai</h3><p>Collectionからモデルカタログを同期するためのAPI Keyです。</p></div><b className={status?.configured?'ok':'muted'}>{statusLabel(status)}</b></div><div className="formgrid service-form"><label className="wide">Civitai API Key<input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder={status?.configured?'設定済み（変更時のみ入力）':'API Keyを入力'}/></label></div><p className="hint">環境変数: <code>CIVIT_API_KEY</code></p><div className="actions service-actions"><button className="primary" disabled={!apiKey.trim()} onClick={()=>void save()}>保存</button><button onClick={onOpenExplorer}>Civit Explorerを開く</button></div></section>;
}
