import {
  type LifecycleClient,
  type LifecycleOptions,
  RemoteInstanceLifecycleService as LifecyclePolicy,
} from '../application/remote-instance-lifecycle.js';
import { getExecutionRun, mutateExecutionRun } from './execution-run.js';
export class RemoteInstanceLifecycleService extends LifecyclePolicy {
  constructor(client: LifecycleClient, options: LifecycleOptions = {}) {
    super(
      client,
      {
        load: getExecutionRun,
        mutate: mutateExecutionRun,
        now: () => ({ iso: new Date().toISOString(), ticks: Date.now() }),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      },
      options,
    );
  }
}
