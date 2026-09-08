import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ArtifactKey, ArtifactReadResult, ImportResult, MissingRequirement, PromptPlanArtifact, ProjectBriefInput, ValidationResult } from '../shared/types.js';
import { backupIfExists, exists, readJson, readText, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';
import { parseModels, parsePromptPlan, validateModels, validateProjectBrief, validatePromptPlan } from './validation.js';
import { validateModelsAgainstCatalog } from './model-catalog.js';

const FILES: Partial<Record<ArtifactKey,string>> = { projectBrief:'project_brief.json', story:'story.md', models:'models.json', promptPlan:'prompt_plan.json' };
const DRAFTS: Partial<Record<ArtifactKey,string>> = { story:'story.md', models:'models.json', promptPlan:'prompt_plan.json' };

export function internalDir(root:string){ return path.join(root,'._batch_studio'); }
export function draftPath(root:string,key:ArtifactKey){ const name=DRAFTS[key]; if(!name) throw new Error(`No draft mapping for ${key}`); return path.join(internalDir(root),'drafts',name); }
export function confirmedPath(root:string,key:ArtifactKey){ const name=FILES[key]; if(!name) throw new Error(`No artifact mapping for ${key}`); return path.join(root,name); }

function extractFence(raw:string, language?:string):string|null {
  const lang=language?language.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'):'[a-zA-Z0-9_-]*';
  const re=new RegExp('```'+lang+'\\s*\\n([\\s\\S]*?)```','i'); const m=raw.match(re); return m?.[1]?.trim() ?? null;
}
function extractJson(raw:string):string { const fenced=extractFence(raw,'json'); if(fenced) return fenced; const first=raw.indexOf('{'); const last=raw.lastIndexOf('}'); return first>=0&&last>first?raw.slice(first,last+1).trim():raw.trim(); }
function extractStory(raw:string):string { return extractFence(raw,'markdown') ?? extractFence(raw,'md') ?? extractFence(raw) ?? raw.trim(); }

async function validateContent(root:string,key:ArtifactKey,content:string):Promise<ValidationResult>{
  if(key==='story') return {valid:content.trim().length>0,issues:content.trim()?[]:[{severity:'error',code:'STORY_EMPTY',message:'ストーリーが空です。'}]};
  if(key==='models') { const parsed=parseModels(content); if(!parsed)return {valid:false,issues:[{severity:'error',code:'MODELS_PARSE',message:'models.jsonをJSONとして解析できません。'}]}; const base=validateModels(parsed); if(!base.valid)return base; return validateModelsAgainstCatalog(root,parsed,base); }
  if(key==='promptPlan') { const parsed=parsePromptPlan(content); if(!parsed)return {valid:false,issues:[{severity:'error',code:'PLAN_PARSE',message:'prompt_plan.jsonをJSONとして解析できません。'}]}; const modelsText=await readText(path.join(root,'models.json')); const models=modelsText?parseModels(modelsText):null; return validatePromptPlan(parsed,models); }
  if(key==='projectBrief') { try{return validateProjectBrief(JSON.parse(content) as ProjectBriefInput);}catch{return {valid:false,issues:[{severity:'error',code:'BRIEF_PARSE',message:'project_brief.jsonを解析できません。'}]};} }
  return {valid:true,issues:[]};
}

export async function readArtifact(root:string,key:ArtifactKey,source:'confirmed'|'draft'):Promise<ArtifactReadResult>{
  const file=source==='confirmed'?confirmedPath(root,key):draftPath(root,key); const content=await readText(file); const validation=content==null?{valid:false,issues:[{severity:'error' as const,code:'MISSING',message:'ファイルがありません。'}]}:await validateContent(root,key,content); return {key,source,content,exists:content!=null,validation};
}
export async function saveDraft(root:string,key:ArtifactKey,content:string):Promise<ArtifactReadResult>{
  if(!DRAFTS[key])throw new Error(`${key} does not support drafts.`); await writeTextAtomic(draftPath(root,key),content.endsWith('\n')?content:`${content}\n`); return readArtifact(root,key,'draft');
}

function extractMissingRequirements(parsed:unknown):MissingRequirement[]{ if(!parsed||typeof parsed!=='object')return[]; const arr=(parsed as {missingRequirements?:unknown}).missingRequirements; if(!Array.isArray(arr))return[]; return arr.filter((x):x is MissingRequirement=>!!x&&typeof x==='object'&&typeof (x as MissingRequirement).role==='string'&&typeof (x as MissingRequirement).requirement==='string'&&typeof (x as MissingRequirement).reason==='string'); }
export async function importGrok(root:string,key:'story'|'models'|'promptPlan',raw:string):Promise<ImportResult>{
  let extracted=key==='story'?extractStory(raw):extractJson(raw); let missingRequirements:MissingRequirement[]=[];
  if(key==='models') { try { const parsed=JSON.parse(extracted) as Record<string,unknown>; missingRequirements=extractMissingRequirements(parsed); if('missingRequirements' in parsed){ const {missingRequirements:_omit,...confirmed}=parsed; extracted=JSON.stringify(confirmed,null,2); } } catch { /* validation below */ } }
  const saved=await saveDraft(root,key,extracted); const issues=[...saved.validation.issues]; if(key==='models'&&missingRequirements.length) issues.push({severity:'error',code:'MISSING_REQUIREMENTS',message:`未解決の不足モデルが${missingRequirements.length}件あります。`});
  const validation={valid:!issues.some(i=>i.severity==='error'),issues};
  const summary:Record<string,string|number|boolean|null>={};
  if(key==='promptPlan'){const plan=parsePromptPlan(extracted); if(plan){ summary.branches=plan.branches.length; summary.items=plan.branches.reduce((n,b)=>n+b.leaves.length,0); summary.images=summary.items; }}
  return {extracted,validation,summary,missingRequirements};
}
export async function confirmArtifact(root:string,key:'story'|'models'|'promptPlan'):Promise<void>{
  const draft=await readArtifact(root,key,'draft'); if(!draft.exists||!draft.content)throw new Error('確定する下書きがありません。'); if(!draft.validation.valid)throw new Error('検証エラーがあるため確定できません。'); const target=confirmedPath(root,key); await backupIfExists(target,path.join(internalDir(root),'history',key)); await writeTextAtomic(target,draft.content);
}
export async function createProject(parent:string,brief:ProjectBriefInput):Promise<string>{
  const v=validateProjectBrief(brief); if(!v.valid)throw new Error(v.issues.map(i=>i.message).join('\n')); const root=path.join(parent,brief.project.id); if(await exists(root)){ const entries=await readdir(root); if(entries.length)throw new Error('同名のプロジェクトフォルダーが既に存在します。'); } await mkdir(root,{recursive:true}); await mkdir(path.join(internalDir(root),'drafts'),{recursive:true}); await mkdir(path.join(internalDir(root),'history'),{recursive:true}); await writeJsonAtomic(path.join(root,'project_brief.json'),{schemaVersion:1,...brief}); await writeJsonAtomic(path.join(root,'project_meta.json'),{schemaVersion:1,createdAt:new Date().toISOString(),settings:{}}); return root;
}
export async function savePromptPlan(root:string,plan:PromptPlanArtifact):Promise<ArtifactReadResult>{ return saveDraft(root,'promptPlan',`${JSON.stringify(plan,null,2)}\n`); }
