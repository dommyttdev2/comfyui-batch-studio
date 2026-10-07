import { type AgentPort, AgentUseCases } from './agent-use-cases.js';
import { type ConfirmationPort, ConfirmationUseCases } from './confirmation-use-cases.js';
import { type ExecutionPort, ExecutionUseCases } from './execution-use-cases.js';
import type { ImageCodec, ResourceStore, SecretStore } from './platform-ports.js';
import { PlatformUseCases } from './platform-use-cases.js';
import type { CatalogRepository, Clock, IdSource, ProjectRepository } from './project-ports.js';
import { ProjectUseCases } from './project-use-cases.js';
import { type Digest, type WorkflowTemplates, WorkflowUseCases } from './workflow-use-cases.js';
export interface CorePorts {
  projects: ProjectRepository;
  templates: WorkflowTemplates;
  digest: Digest;
  catalogs: CatalogRepository;
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
    workflows: new WorkflowUseCases(
      ports.projects,
      ports.catalogs,
      ports.templates,
      ports.digest,
      ports.clock,
    ),
    platform: new PlatformUseCases(ports.secrets, ports.resources, ports.images),
    projects: new ProjectUseCases(ports.projects, ports.catalogs, ports.clock, ports.ids),
    execution: new ExecutionUseCases(ports.execution),
    agents: new AgentUseCases(ports.agents),
    confirmations: new ConfirmationUseCases(ports.confirmations, ports.clock, ports.ids),
  };
}
