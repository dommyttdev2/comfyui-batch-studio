import path from 'node:path';
import { ListBucketsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { R2Object, R2SearchResult } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import { R2ConfigStore } from './r2-config.js';

interface R2ObjectIndexState {
  schemaVersion: 1;
  syncedAt: string | null;
  buckets: Record<string, R2Object[]>;
}

const PAGE_SIZE=250;
const syncQueues=new Map<string,Promise<void>>();

function serialize(item:any):R2Object{const key=String(item.Key??'');return {key,name:key.split('/').pop()||key,size:Number(item.Size??0),etag:String(item.ETag??'').replace(/^"|"$/g,''),lastModified:item.LastModified?.toISOString?.()??null,storageClass:String(item.StorageClass??'STANDARD')}}
const clean=(value:string)=>value.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');

export class R2ObjectIndex {
  private readonly filePath:string;
  constructor(private readonly config:R2ConfigStore,userData:string){this.filePath=path.join(userData,'r2','object-index.json')}
  private async read():Promise<R2ObjectIndexState>{const value=await readJson<R2ObjectIndexState>(this.filePath);return value?.schemaVersion===1?value:{schemaVersion:1,syncedAt:null,buckets:{}}}
  async sync():Promise<void>{
    const previous=syncQueues.get(this.filePath)??Promise.resolve();
    const next=previous.catch(()=>{}).then(()=>this.doSync());
    let tracked:Promise<void>;
    tracked=next.finally(()=>{if(syncQueues.get(this.filePath)===tracked)syncQueues.delete(this.filePath)});
    syncQueues.set(this.filePath,tracked);
    return tracked;
  }
  private async doSync():Promise<void>{const c=await this.config.credentials(),secretAccessKey=c.secretAccessKey?.trim();if(!secretAccessKey)throw new Error('Secret Access Keyが必要です。');const client=new S3Client({endpoint:`https://${c.accountId}.r2.cloudflarestorage.com`,region:'auto',credentials:{accessKeyId:c.accessKeyId,secretAccessKey},maxAttempts:5}),listed=await client.send(new ListBucketsCommand({})),buckets:Record<string,R2Object[]>={};for(const bucket of listed.Buckets??[]){const name=bucket.Name??'';if(!name)continue;let token:string|undefined;const objects:R2Object[]=[];do{const page=await client.send(new ListObjectsV2Command({Bucket:name,MaxKeys:1000,ContinuationToken:token}));for(const item of page.Contents??[])if(item.Key&&!item.Key.endsWith('/'))objects.push(serialize(item));token=page.NextContinuationToken}while(token);buckets[name]=objects}await writeJsonAtomic(this.filePath,{schemaVersion:1,syncedAt:new Date().toISOString(),buckets} satisfies R2ObjectIndexState)}
  async search(bucket:string,query:string,token?:string|null):Promise<R2SearchResult>{const state=await this.read(),all=state.buckets[bucket]??[],q=query.trim().normalize('NFKC').toLocaleLowerCase();if(!q)return {objects:[],nextToken:null,scanned:all.length};const matches=all.filter(o=>o.key.normalize('NFKC').toLocaleLowerCase().includes(q)),offset=token?.startsWith('local:')?Math.max(0,Number(token.slice(6))||0):0,objects=matches.slice(offset,offset+PAGE_SIZE),next=offset+objects.length;return {objects,nextToken:next<matches.length?`local:${next}`:null,scanned:all.length}}
  async resolveModelKey(bucket:string,relativePath:string,prefix=''):Promise<string|null>{
    const state=await this.read(),objects=state.buckets[bucket]??[],normalizedPrefix=clean(prefix),wanted=clean(relativePath);
    if(!wanted)return null;
    const exact=`${normalizedPrefix?`${normalizedPrefix}/`:''}${wanted}`;
    if(objects.some(o=>o.key===exact))return exact;
    const parts=wanted.split('/'),category=parts.length>1?parts[0]:'',fileName=parts[parts.length-1];
    const inPrefix=(key:string)=>!normalizedPrefix||key===normalizedPrefix||key.startsWith(`${normalizedPrefix}/`);
    const candidates=objects.filter(o=>{
      if(!inPrefix(o.key)||path.posix.basename(o.key)!==fileName)return false;
      if(!category)return true;
      const relative=normalizedPrefix&&o.key.startsWith(`${normalizedPrefix}/`)?o.key.slice(normalizedPrefix.length+1):o.key;
      return relative.split('/').slice(0,-1).includes(category);
    }).map(o=>o.key);
    if(candidates.length===1)return candidates[0];
    if(candidates.length>1)throw new Error(`R2_MODEL_OBJECT_AMBIGUOUS: ${fileName} matched multiple objects: ${candidates.join(', ')}`);
    return null;
  }
  async containsFile(bucket:string,fileName:string,prefix=''):Promise<boolean>{return Boolean(await this.resolveModelKey(bucket,fileName,prefix))}
  async containsKey(bucket:string,key:string):Promise<boolean>{const state=await this.read(),normalized=key.replace(/^\/+/, '');return (state.buckets[bucket]??[]).some(o=>o.key===normalized)}
}
