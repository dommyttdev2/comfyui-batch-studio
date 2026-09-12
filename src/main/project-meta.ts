import path from 'node:path';
import type { ProjectMeta, ProjectSettings } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
export async function readProjectMeta(root: string): Promise<ProjectMeta | null> {
  return readJson<ProjectMeta>(path.join(root, 'project_meta.json'));
}
export async function ensureProjectMeta(root: string): Promise<ProjectMeta> {
  const existing = await readProjectMeta(root);
  if (existing) return existing;
  const meta: ProjectMeta = { schemaVersion: 1, createdAt: new Date().toISOString(), settings: {} };
  await writeJsonAtomic(path.join(root, 'project_meta.json'), meta);
  return meta;
}
export async function saveProjectSettings(
  root: string,
  settings: ProjectSettings,
): Promise<ProjectMeta> {
  const meta = await ensureProjectMeta(root);
  const next: ProjectMeta = {
    ...meta,
    updatedAt: new Date().toISOString(),
    settings: { ...meta.settings, ...settings },
  };
  await writeJsonAtomic(path.join(root, 'project_meta.json'), next);
  return next;
}
export async function saveWorkflowBuild(root: string, build: Record<string, unknown>) {
  const meta = await ensureProjectMeta(root);
  const next = { ...meta, updatedAt: new Date().toISOString(), workflowBuild: build };
  await writeJsonAtomic(path.join(root, 'project_meta.json'), next);
}
