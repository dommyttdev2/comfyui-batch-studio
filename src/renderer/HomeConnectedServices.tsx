import { useEffect, useState } from 'react';
import type { CivitaiConnectionStatus, R2ConnectionStatus, VastAiConnectionStatus } from '../shared/types';

type ConnectedService='r2'|'civitai'|'vastai';

export function HomeConnectedServices({onOpenR2,onOpenCivitai,onOpenVastAi}:{onOpenR2:()=>void;onOpenCivitai:()=>void;onOpenVastAi:()=>void}){
  const [services,setServices]=useState<ConnectedService[]>([]);
  useEffect(()=>{
    let cancelled=false;
    void Promise.allSettled([
      window.batchStudio.r2.settings(),
      window.batchStudio.civitai.settings(),
      window.batchStudio.vastai.settings(),
    ]).then(results=>{
      if(cancelled)return;
      const next:ConnectedService[]=[];
      const r2=results[0].status==='fulfilled'?results[0].value as R2ConnectionStatus:null;
      const civitai=results[1].status==='fulfilled'?results[1].value as CivitaiConnectionStatus:null;
      const vastai=results[2].status==='fulfilled'?results[2].value as VastAiConnectionStatus:null;
      if(r2&&(r2.configured||r2.secretConfigured))next.push('r2');
      if(civitai?.configured)next.push('civitai');
      if(vastai?.configured)next.push('vastai');
      setServices(next);
    });
    return()=>{cancelled=true};
  },[]);
  if(!services.length)return null;
  return <section className="recent-projects connected-services" aria-labelledby="connected-services-title">
    <div className="panelhead"><div><h3 id="connected-services-title">連携済みサービス</h3><p>設定済みのサービスへホームから直接アクセスできます。</p></div></div>
    <div className="service-card-grid">
      {services.includes('r2')&&<button className="service-card" onClick={onOpenR2}><div><strong>Cloudflare R2</strong><span>R2 File Manager</span></div><b className="ok">連携済み</b><p>モデル・成果物ストレージを開きます。</p></button>}
      {services.includes('civitai')&&<button className="service-card" onClick={onOpenCivitai}><div><strong>Civitai</strong><span>Civit Explorer</span></div><b className="ok">連携済み</b><p>モデルカタログとCivitai情報を開きます。</p></button>}
      {services.includes('vastai')&&<button className="service-card" onClick={onOpenVastAi}><div><strong>Vast.ai</strong><span>Cloud Instance Manager</span></div><b className="ok">連携済み</b><p>GPU Instanceの状態確認・起動・停止を開きます。</p></button>}
    </div>
  </section>;
}
