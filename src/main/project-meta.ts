import path from 'node:path';
import type { ProjectMeta, ProjectSettings } from '../shared/types.js';
import { exists, readJson, writeJsonAtomic } from './fs-utils.js';

// Serialize every read-modify-write for one project across windows and stages.
const metaLocks = new Map<string, Promise<void>>();

function projectMetaPath(root: string) {
  return path.join(root, 'project_meta.json');
}

function projectLockKey(root: string) {
  const resolved = path.normalize(path.resolve(root));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function withMetaLock<T>(root: string, action: () => Promise<T>): Promise<T> {
  const key = projectLockKey(root);
  const previous = metaLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  metaLocks.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (metaLocks.get(key) === tail) metaLocks.delete(key);
  }
}

function defaultMeta(settings: ProjectSettings = {}): ProjectMeta {
  return { schemaVersion: 1, createdAt: new Date().toISOString(), settings };
}

async function loadMetaForUpdate(root: string) {
  const existing = await readProjectMeta(root);
  if (existing) return existing;
  // readJson returns null for both missing and malformed content; never overwrite
  // a damaged project_meta.json by interpreting it as a new project.
  if (await exists(projectMetaPath(root)))
    throw new Error('project_meta.json is unreadable or invalid; restore it before saving.');
  return defaultMeta();
}

export async function readProjectMeta(root: string): Promise<ProjectMeta | null> {
  return readJson<ProjectMeta>(projectMetaPath(root));
}

export async function ensureProjectMeta(root: string): Promise<ProjectMeta> {
  return withMetaLock(root, async () => {
    const existing = await readProjectMeta(root);
    if (existing) return existing;
    const meta = await loadMetaForUpdate(root);
    await writeJsonAtomic(projectMetaPath(root), meta);
    return meta;
  });
}

// A new project's initial settings must participate in the same lock as later edits.
export async function initializeProjectMeta(
  root: string,
  settings: ProjectSettings = {},
): Promise<ProjectMeta> {
  return withMetaLock(root, async () => {
    if (await exists(projectMetaPath(root)))
      throw new Error('project_meta.json already exists; refusing to replace existing settings.');
    const meta = defaultMeta(settings);
    await writeJsonAtomic(projectMetaPath(root), meta);
    return meta;
  });
}

export async function updateProjectMeta(
  root: string,
  update: (meta: ProjectMeta) => ProjectMeta,
): Promise<ProjectMeta> {
  return withMetaLock(root, async () => {
    const current = await loadMetaForUpdate(root);
    const next = update(structuredClone(current));
    if (next.schemaVersion !== 1 || !next.settings)
      throw new Error('Invalid project_meta.json update.');
    next.updatedAt = new Date().toISOString();
    await writeJsonAtomic(projectMetaPath(root), next);
    return next;
  });
}

export async function saveProjectSettings(
  root: string,
  settings: ProjectSettings,
): Promise<ProjectMeta> {
  return updateProjectMeta(root, (meta) => ({
    ...meta,
    settings: { ...meta.settings, ...settings },
  }));
}

export async function saveWorkflowBuild(root: string, build: Record<string, unknown>) {
  await updateProjectMeta(root, (meta) => ({ ...meta, workflowBuild: build }));
}
