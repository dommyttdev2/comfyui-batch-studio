import { useEffect, useState } from 'react';
import type { CivitaiConnectionStatus, R2ConnectionStatus, VastAiConnectionStatus } from '../shared/types';

type ConnectedService='r2'|'civitai'|'vastai';

export function HomeConnectedServices({activeService,onOpenR2,onOpenCivitai,onOpenVastAi}:{activeService:ConnectedService|null;onOpenR2:()=>void;onOpenCivitai:()=>void;onOpenVastAi:()=>void}){
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
  return <div className="home-connected-services-nav" aria-label="連携済みサービス">
    <span className="home-nav-section-label">連携済みサービス</span>
    {services.includes('r2')&&<button className={activeService==='r2'?'active':''} onClick={onOpenR2}><span>Cloudflare R2</span><i className="home-service-dot" aria-label="連携済み"/></button>}
    {services.includes('civitai')&&<button className={activeService==='civitai'?'active':''} onClick={onOpenCivitai}><span>Civitai</span><i className="home-service-dot" aria-label="連携済み"/></button>}
    {services.includes('vastai')&&<button className={activeService==='vastai'?'active':''} onClick={onOpenVastAi}><span>Vast.ai</span><i className="home-service-dot" aria-label="連携済み"/></button>}
  </div>;
}
