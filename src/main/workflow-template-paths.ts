import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ProjectSettings } from '../shared/types.js';

const moduleDir=path.dirname(fileURLToPath(import.meta.url));
const builtinTemplateDir=path.resolve(moduleDir,'../templates/default-scene-batch');

export function resolveWorkflowTemplatePaths(settings?:Pick<ProjectSettings,'templatePath'|'manifestPath'>|null){
 return {
  templatePath:settings?.templatePath?.trim()||path.join(builtinTemplateDir,'template.json'),
  manifestPath:settings?.manifestPath?.trim()||path.join(builtinTemplateDir,'manifest.json')
 };
}
