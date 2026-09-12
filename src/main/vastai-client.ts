import type { CloudInstanceStatus, VastAiInstance } from '../shared/types.js';
import { normalizeOpenSshPublicKey } from './ssh-key-pair.js';

const DEFAULT_BASE_URL='https://console.vast.ai';
const REQUEST_TIMEOUT_MS=20_000;
const LIFECYCLE_TIMEOUT_MS=15*60_000;
const LIFECYCLE_POLL_MS=5_000;
type PendingInstanceAction='start'|'stop'|'reboot';

type JsonRecord=Record<string,unknown>;
type FetchLike=typeof fetch;
interface VastRequestInit { method?:'GET'|'PUT'|'POST'|'DELETE'; body?:string; }

function record(value:unknown):JsonRecord{return value&&typeof value==='object'&&!Array.isArray(value)?value as JsonRecord:{};}
function stringValue(value:unknown){return typeof value==='string'&&value.trim()?value.trim():null;}
function numberValue(value:unknown){const n=typeof value==='number'?value:Number(value);return Number.isFinite(n)?n:null;}
function integerValue(value:unknown){const n=numberValue(value);return n!=null&&Number.isInteger(n)?n:null;}
function rawStatusOf(payload:JsonRecord){return String(payload.actual_status??payload.status??'unknown').trim().toLowerCase()||'unknown';}
function delay(ms:number){return new Promise(resolve=>setTimeout(resolve,ms));}
function arrayValue(value:unknown):unknown[]|null{
  if(Array.isArray(value))return value;
  if(typeof value==='string'&&value.trim()){try{const parsed=JSON.parse(value);return Array.isArray(parsed)?parsed:null}catch{return null}}
  return null;
}
function sshKeyItems(payload:unknown):unknown[]{
  const direct=arrayValue(payload);if(direct)return direct;
  const item=record(payload);
  for(const key of ['ssh_keys','keys','results']){const rows=arrayValue(item[key]);if(rows)return rows}
  if(stringValue(item.ssh_key)??stringValue(item.public_key)??stringValue(item.key))return [item];
  return Object.values(item).filter(value=>{const row=record(value);return Boolean(stringValue(row.ssh_key)??stringValue(row.public_key)??stringValue(row.key));});
}
function sshKeyValue(value:unknown){const row=record(value);return stringValue(row.ssh_key)??stringValue(row.public_key)??stringValue(row.key);}
function containsSshKey(items:unknown[],publicKey:string){return items.some(item=>{const value=sshKeyValue(item);if(!value)return false;try{return normalizeOpenSshPublicKey(value)===publicKey}catch{return false}});}

export function normalizeVastStatus(payload:unknown):CloudInstanceStatus{
  const item=record(payload),raw=rawStatusOf(item),intended=String(item.intended_status??'').toLowerCase(),cur=String(item.cur_state??'').toLowerCase(),next=String(item.next_state??'').toLowerCase(),message=String(item.status_msg??'').trim().toLowerCase();
  if(raw==='scheduling')return'scheduling';
  const runningLike=raw==='running';
  const stoppingByIntent=runningLike&&(intended==='stopped'||next==='stopped');
  const stoppingByMessage=runningLike&&/(^|[ ,:;])stopp(?:ed|ing)([ ,:;]|$)/.test(message)&&intended!=='running'&&next!=='running';
  if(stoppingByIntent||stoppingByMessage)return'stopping';
  if(raw==='running')return'running';
  const stoppedLike=raw==='stopped'||raw==='exited';
  const schedulingByIntent=stoppedLike&&(intended==='running'||next==='running');
  const schedulingByMessage=stoppedLike&&/(^|[ ,:;])running([ ,:;]|$)/.test(message)&&next!=='stopped';
  if(schedulingByIntent||schedulingByMessage)return'scheduling';
  if(raw==='stopped'||(raw==='exited'&&intended==='stopped'&&cur==='stopped'))return'stopped';
  if(['loading','starting','rebooting','restarting','creating','connecting'].includes(raw))return'starting';
  if(['stopping','destroying'].includes(raw))return'stopping';
  if(['offline','unavailable'].includes(raw))return'offline';
  if(['error','failed','failure'].includes(raw))return'error';
  return'unknown';
}

function mappedTcpEndpoint(payload:JsonRecord,internalPort:number){
  const ports=record(payload.ports),mappings=ports[`${internalPort}/tcp`];
  if(!Array.isArray(mappings))return null;
  const publicHost=stringValue(payload.public_ipaddr);
  for(const candidate of mappings){
    const mapping=record(candidate),host=publicHost??stringValue(mapping.HostIp),port=integerValue(mapping.HostPort);
    if(host&&host!=='0.0.0.0'&&host!=='::'&&port&&port>0)return {host,port,internalPort};
  }
  return null;
}
function publicSshEndpoint(payload:JsonRecord){return mappedTcpEndpoint(payload,22);}
export function resolveVastComfyUiPort(payload:unknown){
  const ports=record(record(payload).ports);
  for(const internalPort of [18188,8188]){
    const mappings=ports[`${internalPort}/tcp`];
    if(Array.isArray(mappings)&&mappings.some(candidate=>{const port=integerValue(record(candidate).HostPort);return port!=null&&port>0;}))return internalPort;
  }
  return null;
}

export function normalizeVastInstance(payload:unknown):VastAiInstance{
  const item=record(payload),id=integerValue(item.id);
  if(id==null||id<1)throw new Error('Vast.ai Instance応答に有効なIDがありません。');
  const status=normalizeVastStatus(item),mapped=status==='running'?publicSshEndpoint(item):null;
  const sshHost=status==='running'?(mapped?.host??stringValue(item.ssh_host)??stringValue(item.public_ipaddr)):null,sshPort=status==='running'?(mapped?.port??integerValue(item.ssh_port)??null):null,comfyUiPort=status==='running'?resolveVastComfyUiPort(item):null;
  return {provider:'vastai',id,label:stringValue(item.label),status,rawStatus:rawStatusOf(item),intendedStatus:stringValue(item.intended_status),curState:stringValue(item.cur_state),nextState:stringValue(item.next_state),statusMessage:stringValue(item.status_msg),gpuName:stringValue(item.gpu_name),gpuCount:integerValue(item.num_gpus),gpuRamMb:integerValue(item.gpu_ram)??integerValue(item.gpu_totalram),hourlyCost:numberValue(item.dph_total),sshHost,sshPort,comfyUiPort};
}

function messageFromPayload(payload:unknown){const item=record(payload);return stringValue(item.msg)??stringValue(item.error)??stringValue(item.detail);}

export class VastAiInstanceNotFoundError extends Error {
  constructor(public readonly instanceId:number){super(`Vast.ai Instance ${instanceId} が見つかりません。`);this.name='VastAiInstanceNotFoundError';}
}

export class VastAiClient {
  private readonly pendingInstanceActions=new Map<number,{action:PendingInstanceAction;requestedAt:number}>();
  constructor(private readonly apiKeyProvider:()=>Promise<string>,private readonly fetchImpl:FetchLike=fetch,private readonly baseUrl=DEFAULT_BASE_URL){}
  private withPendingAction(instance:VastAiInstance){
    const pending=this.pendingInstanceActions.get(instance.id);
    if(!pending)return instance;
    if(instance.status==='error'||instance.status==='offline'){this.pendingInstanceActions.delete(instance.id);return instance;}
    if(pending.action==='start'){
      if(instance.status==='running'){this.pendingInstanceActions.delete(instance.id);return instance;}
      if(instance.status==='stopped'||instance.status==='unknown'){
        return {...instance,status:'scheduling' as const,statusMessage:instance.statusMessage??'起動要求を送信済み。Vast.aiでGPU割り当て待ちの可能性があります。'};
      }
      return instance;
    }
    if(pending.action==='stop'){
      if(instance.status==='stopped'){this.pendingInstanceActions.delete(instance.id);return instance;}
      if(instance.status==='running'||instance.status==='starting'||instance.status==='scheduling'||instance.status==='unknown'){
        return {...instance,status:'stopping' as const,statusMessage:instance.statusMessage??'停止要求を送信済みです。'};
      }
      return instance;
    }
    if(instance.status==='starting'||instance.rawStatus==='rebooting'){return instance;}
    if(instance.status==='running'){
      return {...instance,status:'starting' as const,statusMessage:instance.statusMessage??'再起動要求を送信済みです。'};
    }
    return instance;
  }
  private async request(endpoint:string,init:VastRequestInit={}):Promise<unknown>{
    const apiKey=(await this.apiKeyProvider()).trim();if(!apiKey)throw new Error('VASTAI_API_KEYが設定されていません。');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT_MS);
    try{
      const response=await this.fetchImpl(`${this.baseUrl}${endpoint}`,{method:init.method??'GET',body:init.body,signal:controller.signal,headers:{Accept:'application/json',Authorization:`Bearer ${apiKey}`,...(init.body?{'Content-Type':'application/json'}:{})}});
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
      for(const item of items)instances.push(this.withPendingAction(normalizeVastInstance(item)));
      token=stringValue(payload.next_token);pages+=1;if(pages>100)throw new Error('Vast.ai Instance一覧のページングが終了しません。');
    }while(token);
    return instances.sort((a,b)=>Number(b.status==='running')-Number(a.status==='running')||b.id-a.id);
  }
  async listSshKeys(){return sshKeyItems(await this.request('/api/v0/ssh/'));}
  async listInstanceSshKeys(instanceId:number){if(!Number.isInteger(instanceId)||instanceId<1)throw new Error('Vast.ai Instance IDが不正です。');return sshKeyItems(await this.request(`/api/v0/instances/${instanceId}/ssh/`));}
  async ensureSshAccess(instanceId:number,publicKeyValue:string){
    if(!Number.isInteger(instanceId)||instanceId<1)throw new Error('Vast.ai Instance IDが不正です。');
    const publicKey=normalizeOpenSshPublicKey(publicKeyValue),accountKeys=await this.listSshKeys();
    const accountAlreadyRegistered=containsSshKey(accountKeys,publicKey);
    if(!accountAlreadyRegistered)await this.request('/api/v0/ssh/',{method:'POST',body:JSON.stringify({ssh_key:publicKey})});
    const instanceKeys=await this.listInstanceSshKeys(instanceId),instanceAlreadyAttached=containsSshKey(instanceKeys,publicKey);
    if(!instanceAlreadyAttached)await this.request(`/api/v0/instances/${instanceId}/ssh/`,{method:'POST',body:JSON.stringify({ssh_key:publicKey})});
    return {accountAlreadyRegistered,instanceAlreadyAttached,instanceAttached:true};
  }
  async getInstance(id:number){
    if(!Number.isInteger(id)||id<1)throw new Error('Vast.ai Instance IDが不正です。');
    let payload:JsonRecord;
    try{payload=record(await this.request(`/api/v0/instances/${id}/`));}
    catch(error){if(error instanceof Error&&error.message.startsWith('Vast.ai API 404:'))throw new VastAiInstanceNotFoundError(id);throw error;}
    const raw=payload.instances??payload,item=record(raw),responseId=integerValue(item.id);
    if(responseId==null)throw new VastAiInstanceNotFoundError(id);
    if(responseId!==id)throw new Error(`Vast.ai Instance応答のIDが一致しません。requested=${id}, actual=${responseId}`);
    return this.withPendingAction(normalizeVastInstance(item));
  }
  private async setState(id:number,state:'running'|'stopped'){if(!Number.isInteger(id)||id<1)throw new Error('Vast.ai Instance IDが不正です。');await this.request(`/api/v0/instances/${id}/`,{method:'PUT',body:JSON.stringify({state})});}
  async requestStartInstance(id:number){await this.setState(id,'running');this.pendingInstanceActions.set(id,{action:'start',requestedAt:Date.now()});}
  async requestStopInstance(id:number){await this.setState(id,'stopped');this.pendingInstanceActions.set(id,{action:'stop',requestedAt:Date.now()});}
  async requestRebootInstance(id:number){if(!Number.isInteger(id)||id<1)throw new Error('Vast.ai Instance IDが不正です。');await this.request(`/api/v0/instances/reboot/${id}/`,{method:'PUT'});this.pendingInstanceActions.set(id,{action:'reboot',requestedAt:Date.now()});}
  async destroyInstance(id:number){if(!Number.isInteger(id)||id<1)throw new Error('Vast.ai Instance IDが不正です。');await this.request(`/api/v0/instances/${id}/`,{method:'DELETE'});this.pendingInstanceActions.delete(id);}
  private async waitForStatus(id:number,target:'running'|'stopped',timeoutMs=LIFECYCLE_TIMEOUT_MS){
    const deadline=Date.now()+timeoutMs;
    while(true){
      const current=await this.getInstance(id);
      if(current.status===target)return current;
      if(current.status==='error'||current.status==='offline')throw new Error(`Vast.ai Instance ${id} が ${current.status} 状態になりました: ${current.statusMessage??current.rawStatus}`);
      if(Date.now()>=deadline)throw new Error(`Vast.ai Instance ${id} が ${target} 状態になるまでの待機がタイムアウトしました。`);
      await delay(LIFECYCLE_POLL_MS);
    }
  }
  async startInstance(id:number){await this.requestStartInstance(id);return this.waitForStatus(id,'running');}
  async stopInstance(id:number){await this.requestStopInstance(id);return this.waitForStatus(id,'stopped');}
}
