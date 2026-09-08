import path from 'node:path';
import type { ProjectSettings } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
export async function readProjectSettings(root:string):Promise<ProjectSettings>{const meta=await readJson<{settings?:ProjectSettings}>(path.join(root,'project_meta.json'));return meta?.settings??{};}
export async function writeProjectSettings(root:string,settings:ProjectSettings):Promise<void>{const p=path.join(root,'project_meta.json');const meta=(await readJson<Record<string,unknown>>(p))??{schemaVersion:1};await writeJsonAtomic(p,{...meta,settings});}
