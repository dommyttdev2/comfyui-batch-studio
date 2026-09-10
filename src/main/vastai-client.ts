import type { CloudInstanceStatus, VastAiInstance } from '../shared/types.js';

const DEFAULT_BASE_URL='https://console.vast.ai';
const REQUEST_TIMEOUT_MS=20_000;

type JsonRecord=Record<string,unknown>;
type FetchLike=typeof fetch;

function record(value:unknown):JsonRecord{return value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{};}
function stringValue(value:unknown){return typeof value==='string'&&value.trim()?value.trim():null;}
function numberValue(value:unknown){const n=typeof value==='number'?value:Number(value);return Number.isFinite(n)?n:null;}
function integerValue(value:unknown){const n=numberValue(value);return n!=null&&Number.isInteger(n)?n:null;}
function rawStatusOf(payload:JsonRecord){return String(payload.actual_status??payload.status??'unknown').trim().toLowerCase()||'unknown';}

export function normalizeVastStatus(payload:unknown):CloudInstanceStatus{
  const item=record(payload),raw=rawStatusOf(item),intended=String(item.intended_status??'').toLowerCase(),cur=String(item.cur_state??'').toLowerCase();
  if(raw==='running')return'running';
  if(raw==='stopped'||(raw==='exited'&&intended==='stopped'&&cur==='stopped'))return'stopped';
  if(raw==='scheduling')return'scheduling';
  if(['loading','starting','rebooting','restarting'].includes(raw))return'starting';
  if(['stopping','destroying'].includes(raw))return'stopping';
  if(['offline','unavailable'].includes(raw))return'offline';
  if(['error','failed','failure'].includes(raw))return'error';
  return'unknown';
}

function publicSshEndpoint(payload:JsonRecord){
  const ports=record(payload.ports),mappings=ports['22/tcp'];
  if(!Array.isArray(mappings))return null;
  const publicHost=stringValue(payload.public_ipaddr);
  for(const candidate of mappings){
    const mapping=record(candidate),host=publicHost??stringValue(mapping.HostIp),port=integerValue(mapping.HostPort);
    if(host&&host!=='0.0.0.0'&&host!=='::'&&port&&port>0)return {host,port};
  }
  return null;
}

export function normalizeVastInstance(payload:unknown):VastAiInstance{
  const item=record(payload),id=integerValue(item.id);
  if(id==null||id<1)throw new Error('Vast.ai Instance応答に有効なIDがありません。');
  const status=normalizeVastStatus(item),mapped=status==='running'?publicSshEndpoint(item):null;
  const sshHost=mapped?.host??(status==='running'?stringValue(item.ssh_host)??stringValue(item.public_ipaddr):null),sshPort=mapped?.port??(status==='running'?integerValue(item.ssh_port):null);
  return {
    provider:'vastai',id,label:stringValue(item.label),status,rawStatus:rawStatusOf(item),intendedStatus:stringValue(item.intended_status),curState:stringValue(item.cur_state),statusMessage:stringValue(item.status_msg),gpuName:stringValue(item.gpu_name),gpuCount:integerValue(item.num_gpus),gpuRamMb:integerValue(item.gpu_ram)??integerValue(item.gpu_totalram),hourlyCost:numberValue(item.dph_total),sshHost,sshPort
  };
}

function messageFromPayload(payload:unknown){const item=record(payload);return stringValue(item.msg)??stringValue(item.error)??stringValue(item.detail);}

export class VastAiClient {
  constructor(private readonly apiKeyProvider:()=>Promise<string>,private readonly fetchImpl:FetchLike=fetch,private readonly baseUrl=DEFAULT_BASE_URL){}
  private async request(endpoint:string,init:RequestInit={}):Promise<unknown>{
    const apiKey=(await this.apiKeyProvider()).trim();if(!apiKey)throw new Error('VASTAI_API_KEYが設定されていません。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    try{
      const response=await this.fetchImpl(`${this.baseUrl}${endpoint}`,{...init,signal:controller.signal,headers:{Accept:'application/json',Authorization:`Bearer ${apiKey}`,...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers??{})}});
      const raw=await response.text();let payload:unknown={};if(raw){try{payload=JSON.parse(raw);}catch{payload={msg:raw};}}
      if(!response.ok)throw new Error(`Vast.ai API ${response.status}: ${messageFromPayload(payload)??response.statusText}`);
      return payload;
    }catch(error){if(error instanceof Error&&error.name==='AbortError')throw new Error('Vast.ai APIへの接続がタイムアウトしました。');throw error;}finally{clearTimeout(timer);}
  }
  async testConnection(){await this.request('/api/v1/instances/?limit=1');}
  async listInstances():Promise<VastAiInstance[]>{
    const instances:VastAiInstance[]=[];let token:string|null=null,pages=0;
    do{
      const params=new URLSearchParams({limit:'25'});if(token)params.set('after_token',token);
      const payload=record(await this.request(`/api/v1/instances/?${params.toString()}`)),items=payload.instances;
      if(!Array.isArray(items))throw new Error('Vast.ai Instance一覧応答が不正です。');
      for(const item of items)instances.push(normalizeVastInstance(item));
      token=stringValue(payload.next_token);pages+=1;if(pages>100)throw new Error('Vast.ai Instance一覧のページングが終了しません。');
    }while(token);
    return instances.sort((a,b)=>Number(b.status==='running')-Number(a.status==='running')||b.id-a.id);
  }
  async getInstance(id:number){
    if(!Number.isInteger(id)||id<1)throw new Error('Vast.ai Instance IDが不正です。');
    const payload=record(await this.request(`/api/v0/instances/${id}/`));return normalizeVastInstance(payload.instances??payload);
  }
  private async setState(id:number,state:'running'|'stopped'){
    if(!Number.isInteger(id)||id<1)throw new Error('Vast.ai Instance IDが不正です。');
    await this.request(`/api/v0/instances/${id}/`,{method:'PUT',body:JSON.stringify({state})});
  }
  async startInstance(id:number){await this.setState(id,'running');}
  async stopInstance(id:number){await this.setState(id,'stopped');}
}
