import { mkdir, rename } from 'node:fs/promises';
import path from 'node:path';
import type { ModelsArtifact } from '../shared/types.js';
import { exists, readJson, writeJsonAtomic } from './fs-utils.js';

type PromptFallbackLike={requirement?:unknown;positive?:unknown;negative?:unknown;reason?:unknown};

function selectionImpact(value:any){
 if(!value)return null;
 if(Number.isInteger(value.modelId))return {
  ref:value.ref,
  modelId:value.modelId,
  versionId:value.versionId,
  fileId:value.fileId,
  fileName:value.fileName,
  trainedWords:Array.isArray(value.trainedWords)?value.trainedWords:[],
  strengthBaseline:value.strengthBaseline?.value??null,
 };
 return {ref:value.ref,fileName:value.fileName};
}

function fallbackImpact(value:PromptFallbackLike){return {
 requirement:typeof value.requirement==='string'?value.requirement:'',
 positive:typeof value.positive==='string'?value.positive:'',
 negative:typeof value.negative==='string'?value.negative:'',
};}

export function modelGenerationInputs(models:ModelsArtifact,fallbacks:PromptFallbackLike[]=[]){return JSON.stringify({
 schemaVersion:models.schemaVersion,
 modelFamily:models.modelFamily??null,
 checkpoint:selectionImpact(models.checkpoint),
 textEncoder:selectionImpact(models.textEncoder),
 clip:selectionImpact(models.clip),
 vae:selectionImpact(models.vae),
 loras:(models.loras??[]).map(selectionImpact),
 promptFallbacks:fallbacks.map(fallbackImpact),
});}

export function modelGenerationInputsChanged(previous:ModelsArtifact,previousFallbacks:PromptFallbackLike[],next:ModelsArtifact,nextFallbacks:PromptFallbackLike[]){return modelGenerationInputs(previous,previousFallbacks)!==modelGenerationInputs(next,nextFallbacks);}

async function archiveIfExists(source:string,destination:string){if(!(await exists(source)))return false;await mkdir(path.dirname(destination),{recursive:true});await rename(source,destination);return true;}

export async function resetModelDownstream(root:string,{clearModelFixHistory=true}:{clearModelFixHistory?:boolean}={}){
 const stamp=new Date().toISOString().replace(/[:.]/g,'-');
 const internal=path.join(root,'._batch_studio');
 const archiveRoot=path.join(internal,'history','downstream-reset',stamp);
 await archiveIfExists(path.join(root,'prompt_plan.json'),path.join(archiveRoot,'prompt_plan.json'));
 await archiveIfExists(path.join(internal,'drafts','prompt_plan.json'),path.join(archiveRoot,'drafts','prompt_plan.json'));
 await archiveIfExists(path.join(internal,'grok-responses','prompt-plan'),path.join(archiveRoot,'grok-responses','prompt-plan'));
 await archiveIfExists(path.join(internal,'grok-responses','prompt-plan-fix'),path.join(archiveRoot,'grok-responses','prompt-plan-fix'));
 if(clearModelFixHistory)await archiveIfExists(path.join(internal,'grok-responses','models-fix'),path.join(archiveRoot,'grok-responses','models-fix'));
 const metaPath=path.join(root,'project_meta.json');
 const meta=await readJson<any>(metaPath);
 const outputPath=typeof meta?.workflowBuild?.outputPath==='string'?meta.workflowBuild.outputPath:'';
 if(outputPath&&path.basename(outputPath)===outputPath)await archiveIfExists(path.join(root,outputPath),path.join(archiveRoot,'workflow',outputPath));
 if(meta&&Object.prototype.hasOwnProperty.call(meta,'workflowBuild')){delete meta.workflowBuild;meta.updatedAt=new Date().toISOString();await writeJsonAtomic(metaPath,meta);}
 return {archiveRoot,clearModelFixHistory};
}
