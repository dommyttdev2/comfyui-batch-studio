import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { AvailabilityResult, ExecutionTarget, LoraFileAvailability, ModelAvailabilityRow, ModelsArtifact, ValidationIssue } from '../shared/types.js';
import { exists, readJson } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
import { effectiveModelFamily, requiredModelSelections, remoteModelRelativePath } from './model-placement-paths.js';

async function findRecursive(root:string,target:string):Promise<string|null>{if(!(await exists(root)))return null;const stack=[root];while(stack.length){const dir=stack.pop()!;let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{continue;}for(const e of entries){const p=path.join(dir,e.name);if(e.isDirectory())stack.push(p);else if(e.name===target)return p;}}return null;}
async function indexedR2Names(r2Index:string){const names=new Set<string>();if(!r2Index)return names;const raw=await readJson<any>(r2Index);const arr=Array.isArray(raw)?raw:Array.isArray(raw?.files)?raw.files:[];for(const x of arr){const name=typeof x==='string'?path.basename(x):typeof x?.name==='string'?path.basename(x.name):typeof x?.key==='string'?path.basename(x.key):'';if(name)names.add(name);}return names;}

export async function checkLoraFileAvailability(root:string,fileNames:string[],r2Lookup?:((fileName:string)=>Promise<boolean>)|null,localModelsRoot?:string|null):Promise<LoraFileAvailability[]>{
  const meta=await readProjectMeta(root),legacyLocalRoot=meta?.settings.comfyModelsRoot?.trim()||'',localRoot=(localModelsRoot===undefined?legacyLocalRoot:(localModelsRoot??'')).trim();
  const r2Index=(process.env.BATCH_STUDIO_R2_INDEX_PATH??'').trim()||meta?.settings.r2IndexPath?.trim()||'',r2Names=r2Lookup?new Set<string>():await indexedR2Names(r2Index),localRootExists=Boolean(localRoot&&await exists(localRoot));
  const unique=[...new Set(fileNames.map(x=>path.basename(x.trim())).filter(Boolean))],rows:LoraFileAvailability[]=[];
  for(const fileName of unique){const local=localRootExists?!!(await findRecursive(localRoot,fileName)):false,r2Found=r2Lookup?await r2Lookup(fileName):r2Names.has(fileName);rows.push({fileName,local,r2:r2Found});}
  return rows;
}

export async function checkAvailability(root:string,r2Lookup?:((fileName:string)=>Promise<boolean>)|null,localModelsRoot?:string|null):Promise<AvailabilityResult>{
  const meta=await readProjectMeta(root),executionTarget:ExecutionTarget=meta?.settings.executionTarget==='remote'?'remote':'local';
  const legacyLocalRoot=meta?.settings.comfyModelsRoot?.trim()||'';
  const localRoot=(localModelsRoot===undefined?legacyLocalRoot:(localModelsRoot??'')).trim();
  const draftModels=await readJson<ModelsArtifact>(path.join(root,'._batch_studio','drafts','models.json'));
  const models=draftModels??await readJson<ModelsArtifact>(path.join(root,'models.json'));
  if(!models)return {rows:[],executionTarget,localModelsRoot:localRoot||null,validation:{valid:false,issues:[{severity:'error',code:'MODELS_MISSING',message:'models.jsonがありません。'}]}};
  const r2Index=(process.env.BATCH_STUDIO_R2_INDEX_PATH??'').trim()||meta?.settings.r2IndexPath?.trim()||'',r2Names=r2Lookup?new Set<string>():await indexedR2Names(r2Index);
  const localRootExists=Boolean(localRoot&&await exists(localRoot));
  const family=effectiveModelFamily(models),selections=requiredModelSelections(models),rows:ModelAvailabilityRow[]=[];
  for(const s of selections){const relative=remoteModelRelativePath(family,s.kind,s.fileName),exactLocal=localRootExists?path.join(localRoot,...relative.split('/')):null,localPath=exactLocal?(await exists(exactLocal)?exactLocal:null):(localRootExists?await findRecursive(localRoot,s.fileName):null),local=!!localPath,r2Found=r2Lookup?await r2Lookup(relative):r2Names.has(path.basename(s.fileName));const requiredAvailable=executionTarget==='local'?local:r2Found,alternateAvailable=executionTarget==='local'?r2Found:local;rows.push({ref:s.ref,fileName:s.fileName,kind:s.kind,local,r2:r2Found,state:requiredAvailable?'available':alternateAvailable?'transfer-required':'missing',localPath:localPath??undefined});}
  const issues:ValidationIssue[]=[];
  if(executionTarget==='local'&&!localRoot)issues.push({severity:'error',code:'COMFYUI_INSTALL_PATH_REQUIRED',message:'ローカル実行にはComfyUIのインストール先設定が必要です。環境設定でComfyUIのインストール先ディレクトリを指定してください。'});
  else if(executionTarget==='local'&&!localRootExists)issues.push({severity:'error',code:'COMFYUI_MODELS_ROOT_MISSING',message:`ローカル実行のモデル確認先 ${localRoot} が見つかりません。環境設定のComfyUIインストール先を確認してください。`});
  if(executionTarget==='local'&&localRootExists){for(const row of rows.filter(x=>!x.local))issues.push({severity:'error',code:row.r2?'MODEL_LOCAL_PLACEMENT_REQUIRED':'MODEL_LOCAL_FILE_MISSING',message:row.r2?`${row.fileName} はR2にありますが、ローカル実行には ${localRoot} 配下への配置が必須です。`:`${row.fileName} が ${localRoot} 配下に見つかりません。ローカル実行にはローカル配置が必須です。`,path:row.ref});}
  if(executionTarget==='remote'){for(const row of rows.filter(x=>!x.r2))issues.push({severity:'error',code:row.local?'MODEL_R2_PLACEMENT_REQUIRED':'MODEL_R2_FILE_MISSING',message:row.local?`${row.fileName} はローカルにありますが、リモート実行にはR2への配置が必須です。`:`${row.fileName} がR2に見つかりません。リモート実行にはR2への配置が必須です。`,path:row.ref});}
  return {rows,executionTarget,localModelsRoot:localRoot||null,validation:{valid:!issues.some(i=>i.severity==='error'),issues}};
}
