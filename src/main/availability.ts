import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createModelAvailabilityObservation } from '../application/model-availability-observation.js';
import { exists, readJson } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
async function findRecursive(root: string, target: string): Promise<string | null> {
  if (!(await exists(root))) return null;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name === target) return p;
    }
  }
  return null;
}

export const { checkLoraFileAvailability, checkAvailability } = createModelAvailabilityObservation({
  path,
  exists,
  readJson,
  readProjectMeta,
  findRecursive,
  r2IndexPath: () => process.env.BATCH_STUDIO_R2_INDEX_PATH ?? '',
});
