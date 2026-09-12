import type { ModelFileCandidate, ModelFileRole } from './types.js';

const ROLE_DIR: Record<ModelFileRole, 'text_encoders' | 'vae'> = {
  text_encoder: 'text_encoders',
  vae: 'vae',
};
const relative = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '');
const key = (value: string) => relative(value).normalize('NFKC').toLocaleLowerCase();

export function modelFileDirectory(role: ModelFileRole) {
  return ROLE_DIR[role];
}
export function r2ModelDirectoryPrefix(modelPrefix: string, role: ModelFileRole) {
  const base = modelPrefix.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return `${base ? `${base}/` : ''}${ROLE_DIR[role]}/`;
}
export function mergeModelFileCandidates(
  local: Array<{ fileName: string; path: string; size: number }>,
  remote: Array<{ fileName: string; key: string; size: number }>,
): ModelFileCandidate[] {
  const merged = new Map<string, ModelFileCandidate>();
  for (const file of local) {
    const k = key(file.fileName),
      row = merged.get(k) ?? { fileName: relative(file.fileName), local: false, r2: false };
    row.local = true;
    row.localPath = file.path;
    row.localSize = file.size;
    merged.set(k, row);
  }
  for (const file of remote) {
    const k = key(file.fileName),
      row = merged.get(k) ?? { fileName: relative(file.fileName), local: false, r2: false };
    row.r2 = true;
    row.r2Key = file.key;
    row.r2Size = file.size;
    merged.set(k, row);
  }
  return [...merged.values()].sort((a, b) => a.fileName.localeCompare(b.fileName, 'ja'));
}
