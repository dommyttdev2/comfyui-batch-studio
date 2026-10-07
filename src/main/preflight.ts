import path from 'node:path';
import { assessPreflight } from '../application/preflight.js';
import type { PreflightResult, ValidationIssue } from '../shared/types.js';
import { checkAvailability } from './availability.js';
import { exists, readJson } from './fs-utils.js';
import { loadCatalog } from './model-catalog.js';
import { scanProject } from './project-scan.js';
import { hashCanonicalJson } from './workflow-api.js';
export async function runPreflight(
  root: string,
  r2Lookup?: ((fileName: string) => Promise<boolean>) | null,
  localModelsRoot?: string | null,
  remoteTargetCheck?: () => Promise<ValidationIssue[]>,
): Promise<PreflightResult> {
  return assessPreflight({
    project: () => scanProject(root),
    exists: (resource) => exists(path.join(root, resource)),
    json: (resource) => readJson(path.join(root, resource)),
    catalog: () => loadCatalog(root),
    availability: () => checkAvailability(root, r2Lookup, localModelsRoot),
    remoteTargetCheck,
    hash: hashCanonicalJson,
  });
}
