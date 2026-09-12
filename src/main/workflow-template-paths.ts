import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelFamily, ProjectSettings } from '../shared/types.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const builtinTemplatesDir = path.resolve(moduleDir, '../templates');

function builtinPaths(modelFamily: ModelFamily) {
  const directory = modelFamily === 'anima' ? 'anima-scene-batch' : 'illustrious-scene-batch';
  const builtinTemplateDir = path.join(builtinTemplatesDir, directory);
  return {
    templatePath: path.join(builtinTemplateDir, 'template.json'),
    manifestPath: path.join(builtinTemplateDir, 'manifest.json'),
  };
}

export function resolveWorkflowTemplatePaths(
  settings?: Pick<ProjectSettings, 'templatePath' | 'manifestPath'> | null,
  modelFamily: ModelFamily = 'illustrious',
) {
  const builtin = builtinPaths(modelFamily);
  return {
    templatePath:
      (process.env.BATCH_STUDIO_TEMPLATE_PATH ?? '').trim() ||
      settings?.templatePath?.trim() ||
      builtin.templatePath,
    manifestPath:
      (process.env.BATCH_STUDIO_MANIFEST_PATH ?? '').trim() ||
      settings?.manifestPath?.trim() ||
      builtin.manifestPath,
  };
}
