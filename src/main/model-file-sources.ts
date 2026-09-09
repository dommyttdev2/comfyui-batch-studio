import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ModelFileRole } from '../shared/types.js';
import { modelFileDirectory } from '../shared/model-file-selection.js';

const relative=(value:string)=>value.replace(/\\/g,'/').replace(/^\/+/, '');

export async function listLocalModelFiles(modelsRoot:string|null,role:ModelFileRole):Promise<{path:string|null;exists:boolean;files:Array<{fileName:string;path:string;size:number}>}>{
  const directory=modelsRoot?path.join(modelsRoot,modelFileDirectory(role)):null;
  if(!directory)return {path:null,exists:false,files:[]};
  let exists=false;try{exists=(await stat(directory)).isDirectory()}catch{}if(!exists)return {path:directory,exists:false,files:[]};
  const files:Array<{fileName:string;path:string;size:number}>=[],stack:[string,string][]=[[directory,'']];
  while(stack.length){const [dir,rel]=stack.pop()!;let entries;try{entries=await readdir(dir,{withFileTypes:true})}catch{continue}for(const entry of entries){const absolute=path.join(dir,entry.name),fileName=relative(rel?`${rel}/${entry.name}`:entry.name);if(entry.isDirectory())stack.push([absolute,fileName]);else if(entry.isFile()){let size=0;try{size=(await stat(absolute)).size}catch{}files.push({fileName,path:absolute,size})}}}
  files.sort((a,b)=>a.fileName.localeCompare(b.fileName,'ja'));
  return {path:directory,exists:true,files};
}
