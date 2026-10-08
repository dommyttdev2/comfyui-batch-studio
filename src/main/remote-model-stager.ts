import path from 'node:path';
import { RemoteModelStager as CoreStager } from '../application/remote-model-stager.js';
import { readJson } from './fs-utils.js';
import { hashCanonicalJson } from './workflow-api.js';
import { getExecutionRun, mutateExecutionRun, recordExecutionEvidence } from './execution-run.js';
import { readProjectMeta } from './project-meta.js';
import type { R2Manager } from './r2-manager.js';
import type { RemoteControlPlane } from './remote-control-plane.js';
import type { ModelsArtifact } from '../domain/artifact-types.js';
export class RemoteModelStager extends CoreStager {
  constructor(r2: R2Manager, remote: RemoteControlPlane) {
    super(r2, remote, {
      load: getExecutionRun,
      mutate: mutateExecutionRun,
      record: recordExecutionEvidence,
      hash: hashCanonicalJson,
      models: (root) => readJson<ModelsArtifact>(path.join(root, 'models.json')),
      location: async (root) => {
        const meta = await readProjectMeta(root);
        return {
          bucket: meta?.settings.r2Bucket ?? '',
          prefix: meta?.settings.r2ModelPrefix ?? '',
        };
      },
    });
  }
}
