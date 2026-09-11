import path from 'node:path';
import type { ModelAvailabilityRow, ModelFamily, ModelsArtifact } from '../shared/types.js';

export interface RequiredModelSelection {
  ref:string;
  fileName:string;
  kind:ModelAvailabilityRow['kind'];
}

function fileLeaf(fileName:string){
  const normalized=fileName.replace(/\\/g,'/').trim();
  const leaf=path.posix.basename(normalized);
  if(!leaf||leaf==='.'||leaf==='..')throw new Error(`Invalid model file name: ${fileName}`);
  return leaf;
}

export function effectiveModelFamily(models:ModelsArtifact):ModelFamily{
  return models.modelFamily??(models.schemaVersion===5&&models.diffusionModel?'anima':'illustrious');
}

export function requiredModelSelections(models:ModelsArtifact):RequiredModelSelection[]{
  const family=effectiveModelFamily(models);
  const base:RequiredModelSelection[]=family==='anima'
    ?(models.diffusionModel?[{kind:'diffusion_model',...models.diffusionModel}]:[])
    :(models.checkpoint?[{kind:'checkpoint',...models.checkpoint}]:[]);
  return [
    ...base,
    ...(models.textEncoder?[{kind:'text_encoder' as const,...models.textEncoder}]:[]),
    ...(models.clip?[{kind:'clip' as const,...models.clip}]:[]),
    ...(models.vae?[{kind:'vae' as const,...models.vae}]:[]),
    ...models.loras.map(model=>({kind:'lora' as const,...model}))
  ].map(({ref,fileName,kind})=>({ref,fileName,kind}));
}

export function remoteModelRelativePath(family:ModelFamily,kind:ModelAvailabilityRow['kind'],fileName:string){
  const leaf=fileLeaf(fileName);
  if(kind==='checkpoint'){
    if(family!=='illustrious')throw new Error('Anima model family cannot stage a checkpoint model.');
    return `checkpoints/${leaf}`;
  }
  if(kind==='diffusion_model'){
    if(family!=='anima')throw new Error('Illustrious model family cannot stage a diffusion model.');
    return `diffusion_models/${leaf}`;
  }
  if(kind==='text_encoder')return `text_encoders/${leaf}`;
  if(kind==='clip')return `clip/${leaf}`;
  if(kind==='vae')return `vae/${leaf}`;
  if(kind==='lora')return `loras/${leaf}`;
  const exhaustive:never=kind;
  throw new Error(`Unsupported model kind: ${String(exhaustive)}`);
}

export function requiredRemoteModels(models:ModelsArtifact){
  const family=effectiveModelFamily(models);
  return requiredModelSelections(models).map(model=>({...model,relativePath:remoteModelRelativePath(family,model.kind,model.fileName)}));
}

export function joinR2ModelKey(prefix:string,relativePath:string){
  const cleanPrefix=prefix.replace(/\\/g,'/').replace(/^\/+|\/+$/g,'');
  const cleanRelative=relativePath.replace(/\\/g,'/').replace(/^\/+/, '');
  return cleanPrefix?`${cleanPrefix}/${cleanRelative}`:cleanRelative;
}
