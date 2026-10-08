import { RemoteEnvironmentBootstrap as CoreBootstrap } from '../application/remote-environment-bootstrap.js';
import { getExecutionRun, mutateExecutionRun } from './execution-run.js';
import type { RemoteControlPlane } from './remote-control-plane.js';
export type { RemoteBootstrapConfig } from '../application/remote-environment-bootstrap.js';
export class RemoteEnvironmentBootstrap extends CoreBootstrap {
  constructor(remote: RemoteControlPlane) {
    super(remote, { load: getExecutionRun, mutate: mutateExecutionRun });
  }
}
