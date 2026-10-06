import { PlatformUseCases } from './platform-use-cases.js';
import type { SecretStore, ResourceStore, ImageCodec } from './platform-ports.js';
import { ProjectUseCases } from './project-use-cases.js';
import { ExecutionUseCases, type ExecutionPort } from './execution-use-cases.js';
import { AgentUseCases, type AgentPort } from './agent-use-cases.js';
import { ConfirmationUseCases, type ConfirmationPort } from './confirmation-use-cases.js';
import type { ArtifactValidator, Clock, IdSource, ProjectRepository } from './project-ports.js';
export interface CorePorts {
  projects: ProjectRepository;
  validator: ArtifactValidator;
  clock: Clock;
  ids: IdSource;
  execution: ExecutionPort;
  agents: AgentPort;
  confirmations: ConfirmationPort;
  secrets: SecretStore;
  resources: ResourceStore;
  images: ImageCodec;
}
// Composition boundary. P2 supplies server infrastructure and authenticated controllers.
export function createBusinessCore(ports: CorePorts) {
  return {
    platform: new PlatformUseCases(ports.secrets, ports.resources, ports.images),
    projects: new ProjectUseCases(ports.projects, ports.validator, ports.clock, ports.ids),
    execution: new ExecutionUseCases(ports.execution),
    agents: new AgentUseCases(ports.agents),
    confirmations: new ConfirmationUseCases(ports.confirmations, ports.clock, ports.ids),
  };
}
