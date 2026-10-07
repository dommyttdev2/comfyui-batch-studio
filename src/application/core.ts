import { AgentPreferencesUseCases } from './agent-preferences-use-cases.js';
import { AgentTaskUseCases } from './agent-task-use-cases.js';
import { type AgentPort, AgentUseCases } from './agent-use-cases.js';
import { type ConfirmationPort, ConfirmationUseCases } from './confirmation-use-cases.js';
import { type ExecutionPort, ExecutionUseCases } from './execution-use-cases.js';
import { type OutputFactsPort, OutputUseCases } from './output-use-cases.js';
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
  outputFacts: OutputFactsPort;
}
// Composition boundary. P2 supplies server infrastructure and authenticated controllers.
export function createBusinessCore(ports: CorePorts) {
  const preferences = new AgentPreferencesUseCases(ports.projects, ports.clock);
  return {
    preferences,
    tasks: new AgentTaskUseCases(ports.projects, ports.catalogs, ports.agents, ports.digest),
    outputs: new OutputUseCases(ports.projects, ports.outputFacts, ports.digest, ports.clock),
    workflows: new WorkflowUseCases(
      ports.projects,
      ports.catalogs,
      ports.templates,
      ports.digest,
      ports.clock,
    ),
    platform: new PlatformUseCases(ports.secrets, ports.resources, ports.images),
    projects: new ProjectUseCases(
      ports.projects,
      ports.catalogs,
      ports.clock,
      ports.ids,
      ports.digest,
    ),
    execution: new ExecutionUseCases(ports.execution),
    agents: new AgentUseCases(ports.agents, (actor, scope, id) =>
      preferences.prepareLaunch(actor, scope, id),
    ),
    confirmations: new ConfirmationUseCases(ports.confirmations, ports.clock, ports.ids),
  };
}
