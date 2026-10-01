import type { IpcRegistrationDependencies } from './main.js';
import { registerAssistantIpc } from './ipc-registration/assistant.js';
import { registerExecutionIpc } from './ipc-registration/execution.js';
import { registerImageIpc } from './ipc-registration/image.js';
import { registerIntegrationIpc } from './ipc-registration/integration.js';
import { registerProjectIpc } from './ipc-registration/project.js';
import { registerStorageIpc } from './ipc-registration/storage.js';

export type { IpcRegistrationDependencies };

export function registerIpc(dependencies: IpcRegistrationDependencies) {
  registerProjectIpc(dependencies);
  registerIntegrationIpc(dependencies);
  registerExecutionIpc(dependencies);
  registerImageIpc(dependencies);
  registerStorageIpc(dependencies);
  registerAssistantIpc(dependencies);
}
