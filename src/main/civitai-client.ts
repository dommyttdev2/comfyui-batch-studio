export interface CivitaiCollectionMeta {
  id:number;
  name:string;
  description:string;
  read:string;
  type:string;
  imageId?:number;
}

export interface CivitaiCollectionItemsResult {
  items:any[];
  pages:number;
}

export class CivitaiApiError extends Error {
  constructor(message:string,readonly statusCode=502){super(message);}
}

export interface CivitaiClientOptions {
  apiKey:string;
  baseUrl:string;
  matureBaseUrl:string;
  deadlineMs:number;
}

export class CivitaiClient {
  private readonly apiKey:string;
  private readonly baseUrl:string;
  private readonly matureBaseUrl:string;
  private readonly deadlineMs:number;
  private readonly maxCollectionPages:number;

  constructor(options:CivitaiClientOptions){
    this.apiKey=options.apiKey;
    this.baseUrl=options.baseUrl.replace(/\/$/,'');
    this.matureBaseUrl=options.matureBaseUrl.replace(/\/$/,'');
    this.deadlineMs=Math.max(1000,options.deadlineMs);
    this.maxCollectionPages=Math.max(1,Math.floor(Number(process.env.CIVITAI_MAX_COLLECTION_PAGES??1000)));
  }

  private async getJson(endpoint:string,params?:Record<string,string|number|boolean>,base=this.baseUrl){
    const url=new URL(endpoint,base);
    for(const [key,value] of Object.entries(params??{}))url.searchParams.set(key,String(value));
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(new Error(`Civitai request deadline exceeded after ${this.deadlineMs} ms.`)),this.deadlineMs);
    let response:Response;
    try{
      response=await fetch(url,{headers:{Authorization:`Bearer ${this.apiKey}`,Accept:'application/json','User-Agent':'comfyui-batch-studio/1.0'},signal:controller.signal});
    }catch(error){
      throw new CivitaiApiError(`Civitaiへの接続に失敗しました: ${error instanceof Error?error.message:String(error)}`);
    }finally{clearTimeout(timer);}
    if(response.status===401||response.status===403)throw new CivitaiApiError('CIVIT_API_KEYが無効か、CollectionsRead権限がありません。',response.status);
    if(response.status===429)throw new CivitaiApiError('Civitaiのレート制限に達しました。再試行上限を超えたため同期を停止しました。',429);
    if(!response.ok)throw new CivitaiApiError(`Civitai APIがHTTP ${response.status}を返しました。`,response.status);
    try{return await response.json();}catch{throw new CivitaiApiError('Civitai APIから不正なJSONが返されました。');}
  }

  private async trpc(procedure:string,payload:Record<string,unknown>,base=this.baseUrl){
    const body=await this.getJson(`/api/trpc/${procedure}`,{input:JSON.stringify({json:payload})},base);
    const result=body?.result?.data?.json;
    if(result===undefined)throw new CivitaiApiError(body?.error?.json?.message??'Civitai内部APIの形式が変更されました。');
    return result;
  }

  async getCollections():Promise<CivitaiCollectionMeta[]>{
    const raw=await this.trpc('collection.getAllUser',{});
    if(!Array.isArray(raw))throw new CivitaiApiError('コレクション一覧の形式が変更されました。');
    return raw.filter((x:any)=>x?.type==='Model'||x?.type==null).map((x:any)=>({
      id:Number(x.id),
      name:String(x.name??'名称未設定'),
      description:String(x.description??''),
      read:String(x.read??'Private'),
      type:String(x.type??'Model'),
      imageId:x.imageId==null?undefined:Number(x.imageId),
    }));
  }

  async getCollectionItems(collectionId:number):Promise<CivitaiCollectionItemsResult>{
    const items:any[]=[];
    let cursor:string|undefined;
    const seen=new Set<string>();
    for(let page=0;page<this.maxCollectionPages;page++){
      const payload:any={collectionId,limit:100,browsingLevel:31};
      if(cursor)payload.cursor=cursor;
      const data=await this.trpc('collection.getAllCollectionItems',payload,this.matureBaseUrl);
      const rows=Array.isArray(data?.collectionItems)?data.collectionItems:[];
      items.push(...rows);
      if(!data?.nextCursor)return {items,pages:page+1};
      cursor=String(data.nextCursor);
      if(seen.has(cursor))throw new CivitaiApiError('Civitai APIが同じページカーソルを返しました。');
      seen.add(cursor);
    }
    throw new CivitaiApiError('コレクションのページ数が安全上限を超えました。');
  }

  getModel(modelId:number){return this.getJson(`/api/v1/models/${modelId}`);}
  getModelVersion(versionId:number){return this.getJson(`/api/v1/model-versions/${versionId}`);}
  getImages(params:Record<string,string|number|boolean>){return this.getJson('/api/v1/images',params);}

  async getImageUrl(imageId:number){
    const payload=await this.getImages({imageId,limit:1});
    const row=Array.isArray(payload?.items)?payload.items[0]:null;
    return typeof row?.url==='string'?row.url:null;
  }
}
