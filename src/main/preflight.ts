import path from 'node:path';
import { assessResourcePreflight } from '../application/resource-preflight.js';
import type { RemoteTargetFacts } from '../domain/remote-target-policy.js';
import type { PreflightResult } from '../shared/types.js';
import { checkAvailability } from './availability.js';
import { exists, readJson } from './fs-utils.js';
import { loadCatalog } from './model-catalog.js';
import { scanProject } from './project-scan.js';
import { hashCanonicalJson } from './workflow-api.js';
export async function runPreflight(
  root: string,
  r2Lookup?: ((fileName: string) => Promise<boolean>) | null,
  localModelsRoot?: string | null,
  remoteTarget?: () => Promise<RemoteTargetFacts>,
): Promise<PreflightResult> {
  return assessResourcePreflight({
    project: () => scanProject(root),
    exists: (resource) => exists(path.join(root, resource)),
    json: (resource) => readJson(path.join(root, resource)),
    catalog: () => loadCatalog(root),
    availability: async () => {
      const value = await checkAvailability(root, r2Lookup, localModelsRoot);
      return {
        rows: value.rows,
        executionTarget: value.executionTarget,
        localModelsRoot: value.localModelsRoot ?? '',
        localRootExists: !!value.localModelsRoot && (await exists(value.localModelsRoot)),
      };
    },
    remoteTarget,
    hash: hashCanonicalJson,
  });
}
