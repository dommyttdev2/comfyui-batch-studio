const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export interface CivitaiRateLimitState {
  waiting:boolean;
  retryAt:number|null;
  retryAfterSeconds:number;
  consecutive429:number;
}

function parseRetryAfter(value:string|null,now=Date.now()):number|null{
  if(!value)return null;
  const seconds=Number(value);
  if(Number.isFinite(seconds)&&seconds>=0)return Math.ceil(seconds*1000);
  const date=Date.parse(value);
  return Number.isFinite(date)?Math.max(0,date-now):null;
}

function normalizedHosts(){
  const values=[process.env.CIVITAI_BASE_URL??'https://civitai.com',process.env.CIVITAI_MATURE_BASE_URL??'https://civitai.red'];
  const hosts=new Set<string>();
  for(const value of values){try{hosts.add(new URL(value).hostname.toLowerCase())}catch{}}
  return hosts;
}

export class CivitaiRequestPolicy {
  private readonly originalFetch:typeof fetch;
  private readonly hosts:Set<string>;
  private readonly minIntervalMs:number;
  private readonly minRetryMs:number;
  private readonly timeoutMs:number;
  private nextRequestAt=0;
  private blockedUntil=0;
  private gate:Promise<void>=Promise.resolve();
  private consecutive429=0;
  private installed=false;

  constructor(originalFetch:typeof fetch=globalThis.fetch){
    this.originalFetch=originalFetch;
    this.hosts=normalizedHosts();
    this.minIntervalMs=Math.max(0,Number(process.env.CIVITAI_REQUEST_INTERVAL_MS??350));
    this.minRetryMs=Math.max(1,Number(process.env.CIVITAI_MIN_RETRY_MS??1000));
    this.timeoutMs=Math.max(1000,Number(process.env.CIVITAI_TIMEOUT??20)*1000);
  }

  install(){
    if(this.installed)return;
    this.installed=true;
    const self=this;
    globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>self.fetch(input,init)) as typeof fetch;
  }

  status():CivitaiRateLimitState{
    const now=Date.now(),waiting=this.blockedUntil>now;
    return {waiting,retryAt:waiting?this.blockedUntil:null,retryAfterSeconds:waiting?Math.max(1,Math.ceil((this.blockedUntil-now)/1000)):0,consecutive429:this.consecutive429};
  }

  private isCivitai(input:RequestInfo|URL){
    try{const raw=typeof input==='string'||input instanceof URL?String(input):input.url;return this.hosts.has(new URL(raw).hostname.toLowerCase())}catch{return false}
  }

  private async waitForSlot(){
    const task=this.gate.then(async()=>{
      const now=Date.now(),wait=Math.max(0,this.nextRequestAt-now,this.blockedUntil-now);
      if(wait>0)await sleep(wait);
      this.nextRequestAt=Date.now()+this.minIntervalMs;
    });
    this.gate=task.catch(()=>{});
    await task;
  }

  private retryDelay(response:Response){
    const fromHeader=parseRetryAfter(response.headers.get('Retry-After'));
    if(fromHeader!=null)return Math.max(this.minRetryMs,fromHeader);
    const exponential=Math.min(60_000,2_000*(2**Math.min(this.consecutive429,5)));
    return Math.max(this.minRetryMs,exponential+Math.floor(Math.random()*1000));
  }

  private async fetch(input:RequestInfo|URL,init?:RequestInit):Promise<Response>{
    if(!this.isCivitai(input))return this.originalFetch(input,init);
    for(;;){
      await this.waitForSlot();
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
      let response:Response;
      try{
        response=await this.originalFetch(input,{...init,signal:controller.signal});
      }finally{clearTimeout(timer)}
      if(response.status!==429){this.consecutive429=0;return response}
      this.consecutive429+=1;
      const delay=this.retryDelay(response);
      this.blockedUntil=Math.max(this.blockedUntil,Date.now()+delay);
    }
  }
}

export { parseRetryAfter };
