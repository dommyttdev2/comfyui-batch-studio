import { access, mkdir, readFile, rename, stat, writeFile, copyFile, unlink } from 'node:fs/promises';
import path from 'node:path';
export async function exists(p:string){ try{ await access(p); return true;}catch{return false;} }
export async function readText(p:string){ try{return await readFile(p,'utf8');}catch{return null;} }
export async function readJson<T>(p:string):Promise<T|null>{ const t=await readText(p); if(t==null)return null; try{return JSON.parse(t) as T;}catch{return null;} }
export async function writeTextAtomic(p:string,content:string){ await mkdir(path.dirname(p),{recursive:true}); const tmp=path.join(path.dirname(p),`.${path.basename(p)}.${process.pid}.tmp`); await writeFile(tmp,content,'utf8'); for(let attempt=0;;attempt++){try{await rename(tmp,p);return;}catch(error:any){if(!['EPERM','EBUSY','EACCES'].includes(error?.code)||attempt>=20)throw error;await new Promise(resolve=>setTimeout(resolve,Math.min(100*(attempt+1),500)));}} }
export async function writeJsonAtomic(p:string,v:unknown){ await writeTextAtomic(p,JSON.stringify(v,null,2)+'\n'); }
export async function backupIfExists(source:string,historyDir:string){ if(!(await exists(source)))return null; await mkdir(historyDir,{recursive:true}); const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const dst=path.join(historyDir,`${stamp}-${path.basename(source)}`); await copyFile(source,dst); return dst; }
export async function fileSize(p:string){ try{return (await stat(p)).size;}catch{return null;} }

export async function removeIfExists(p:string){ try{await unlink(p)}catch(e:any){if(e?.code!=='ENOENT')throw e;} }
