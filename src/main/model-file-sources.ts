import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ModelFileCandidate, ModelFileRole, ModelFileSourceResult, R2ListResult } from '../shared/types.js';
import { readProjectMeta } from './project-meta.js';

export type R2ListFn=(bucket:string,prefix:string,token?:string|null)=>Promise<R2ListResult>;
const ROLE_DIR:Record<ModelFileRole,'text_encoders'|'clip'>={text_encoder:'text_encoders',clip:'clip'};
const posix=(value:string)=>value.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
const relativeKey=(value:string)=>value.replace(/\\/g,'/').replace(/^\/+/, '');
const joinPrefix=(...parts:string[])=>parts.map(posix).filter(Boolean).join('/');
const mergeKey=(value:string)=>relativeKey(value).normalize('NFKC').toLocaleLowerCase();

export function modelFileDirectory(role:ModelFileRole){return ROLE_DIR[role];}

async function walkLocal(root:string):Promise<Array<{fileName:string;path:string;size:number}>>{
  const out:Array<{fileName:string;path:string;size:number}>=[],stack:[string,string][]=[[root,'']];
  while(stack.length){const [dir,rel]=stack.pop()!;let entries;try{entries=await readdir(dir,{withFileTypes:true})}catch{continue}for(const entry of entries){const absolute=path.join(dir,entry.name),relative=relativeKey(rel?`${rel}/${entry.name}`:entry.name);if(entry.isDirectory())stack.push([absolute,relative]);else if(entry.isFile()){let size=0;try{size=(await stat(absolute)).size}catch{}out.push({fileName:relative,path:absolute,size})}}}
  return out.sort((a,b)=>a.fileName.localeCompare(b.fileName,'ja'));
}

async function walkR2(bucket:string,rootPrefix:string,list:R2ListFn):Promise<Array<{fileName:string;key:string;size:number}>>{
  const out:Array<{fileName:string;key:string;size:number}>=[],queue=[rootPrefix],seen=new Set<string>();
  while(queue.length){const prefix=queue.shift()!;if(seen.has(prefix))continue;seen.add(prefix);let token:string|null=null;do{const page=await list(bucket,prefix,token);for(const folder of page.folders)if(folder.prefix.startsWith(rootPrefix))queue.push(folder.prefix);for(const object of page.objects){if(!object.key.startsWith(rootPrefix))continue;const fileName=relativeKey(object.key.slice(rootPrefix.length));if(fileName)out.push({fileName,key:object.key,size:object.size})}token=page.nextToken}while(token)}
  return out.sort((a,b)=>a.fileName.localeCompare(b.fileName,'ja'));
}

export function mergeModelFileCandidates(local:Array<{fileName:string;path:string;size:number}>,remote:Array<{fileName:string;key:string;size:number}>):ModelFileCandidate[]{
  const merged=new Map<string,ModelFileCandidate>();
  for(const file of local){const key=mergeKey(file.fileName),row=merged.get(key)??{fileName:file.fileName,local:false,r2:false};row.local=true;row.localPath=file.path;row.localSize=file.size;merged.set(key,row)}
  for(const file of remote){const key=mergeKey(file.fileName),row=merged.get(key)??{fileName:file.fileName,local:false,r2:false};row.r2=true;row.r2Key=file.key;row.r2Size=file.size;merged.set(key,row)}
  return [...merged.values()].sort((a,b)=>a.fileName.localeCompare(b.fileName,'ja'));
}

export async function discoverModelFiles(root:string,role:ModelFileRole,localModelsRoot:string|null,r2List:R2ListFn|null):Promise<ModelFileSourceResult>{
  const directory=ROLE_DIR[role],localDir=localModelsRoot?path.join(localModelsRoot,directory):null;
  let localExists=false,local:Array<{fileName:string;path:string;size:number}>=[];
  if(localDir){try{localExists=(await stat(localDir)).isDirectory()}catch{}if(localExists)local=await walkLocal(localDir)}
  const meta=await readProjectMeta(root),bucket=meta?.settings.r2Bucket?.trim()||'',modelPrefix=meta?.settings.r2ModelPrefix?.trim()||'',rootPrefix=`${joinPrefix(modelPrefix,directory)}/`,linked=Boolean(bucket),configured=linked&&Boolean(r2List);
  let remote:Array<{fileName:string;key:string;size:number}>=[],r2Error:string|undefined;
  if(configured&&r2List){try{remote=await walkR2(bucket,rootPrefix,r2List)}catch(error){r2Error=error instanceof Error?error.message:String(error)}}
  return {role,directory,files:mergeModelFileCandidates(local,remote),local:{configured:Boolean(localModelsRoot),path:localDir,exists:localExists},r2:{linked,configured,bucket:bucket||null,prefix:linked?rootPrefix:null,...(r2Error?{error:r2Error}:{})}};
}
