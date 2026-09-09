import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelFamily, ProjectSettings } from '../shared/types.js';

const moduleDir=path.dirname(fileURLToPath(import.meta.url));
const builtinTemplatesDir=path.resolve(moduleDir,'../templates');

export function resolveWorkflowTemplatePaths(settings?:Pick<ProjectSettings,'templatePath'|'manifestPath'>|null,modelFamily:ModelFamily='illustrious'){
 const explicitTemplate=(process.env.BATCH_STUDIO_TEMPLATE_PATH??'').trim()||settings?.templatePath?.trim()||'';
 const explicitManifest=(process.env.BATCH_STUDIO_MANIFEST_PATH??'').trim()||settings?.manifestPath?.trim()||'';
 if(explicitTemplate||explicitManifest){
  if(!explicitTemplate||!explicitManifest)throw new Error('Custom Workflow Template / Manifest は両方指定してください。');
  return {templatePath:explicitTemplate,manifestPath:explicitManifest};
 }
 const directory=modelFamily==='anima'?'anima-scene-batch':'illustrious-scene-batch';
 const builtinTemplateDir=path.join(builtinTemplatesDir,directory);
 return {templatePath:path.join(builtinTemplateDir,'template.json'),manifestPath:path.join(builtinTemplateDir,'manifest.json')};
}
