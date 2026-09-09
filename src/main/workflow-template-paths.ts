import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectSettings } from '../shared/types.js';

const moduleDir=path.dirname(fileURLToPath(import.meta.url));
const builtinTemplateDir=path.resolve(moduleDir,'../templates/default-scene-batch');

export function resolveWorkflowTemplatePaths(settings?:Pick<ProjectSettings,'templatePath'|'manifestPath'>|null){
 return {
  templatePath:(process.env.BATCH_STUDIO_TEMPLATE_PATH??'').trim()||settings?.templatePath?.trim()||path.join(builtinTemplateDir,'template.json'),
  manifestPath:(process.env.BATCH_STUDIO_MANIFEST_PATH??'').trim()||settings?.manifestPath?.trim()||path.join(builtinTemplateDir,'manifest.json')
 };
}
