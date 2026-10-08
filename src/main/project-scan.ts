import { createHash } from 'node:crypto';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { scanProjectObservation } from '../application/project-observation.js';
import type {
  ProjectBriefInput,
  ModelsArtifact,
  WorkflowManifest,
} from '../domain/artifact-types.js';
import { readArtifact } from './artifact-service.js';
import { readJson, readText, exists } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
import { withProjectMutationLock } from './project-transaction.js';
import { hashWorkflowModelInputs } from './workflow-api.js';
import { hashWorkflowTemplate } from './workflow-template-integrity.js';
import { resolveWorkflowTemplatePaths } from './workflow-template-paths.js';
async function mtime(p: string) {
  try {
    return (await stat(p)).mtimeMs;
  } catch {
    return 0;
  }
}
function sha256(text: string) {
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
}
function historyTimestamp(name: string) {
  const match = name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-/);
  if (!match) return 0;
  const [, date, hour, minute, second, millis] = match;
  return Date.parse(`${date}T${hour}:${minute}:${second}.${millis}Z`);
}

export async function scanProject(root: string) {
  return withProjectMutationLock(root, () =>
    scanProjectObservation(
      {
        files: async (root) =>
          (await readdir(root, { withFileTypes: true }))
            .filter((e) => e.isFile())
            .map((e) => e.name),
        brief: (root) => readJson<ProjectBriefInput>(path.join(root, 'project_brief.json')),
        meta: readProjectMeta,
        models: (root) => readJson<ModelsArtifact>(path.join(root, 'models.json')),
        mtime: (root, id) => mtime(path.join(root, id)),
        basename: path.basename,
        artifact: readArtifact,
        briefHistory: async (root) => {
          const dir = path.join(root, '._batch_studio', 'history', 'projectBrief');
          let names: string[];
          try {
            names = await readdir(dir);
          } catch {
            return [];
          }
          return names
            .filter((name) => name.endsWith('-project_brief.json'))
            .map((name) => ({ file: path.join(dir, name), time: historyTimestamp(name) }));
        },
        historyBrief: (id) => readJson<ProjectBriefInput>(id),
        template: async (settings, family) => {
          const { templatePath, manifestPath } = resolveWorkflowTemplatePaths(settings, family);
          if (!(await exists(templatePath)) || !(await exists(manifestPath))) return null;
          const templateRaw = await readText(templatePath),
            manifest = await readJson<WorkflowManifest>(manifestPath);
          return templateRaw && manifest ? { templateRaw, manifest } : null;
        },
        modelHash: hashWorkflowModelInputs,
        templateHash: hashWorkflowTemplate,
        hashText: sha256,
      },
      root,
    ),
  );
}
