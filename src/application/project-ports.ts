import type { AgentModelSelection, AgentStageSessions } from '../domain/agent-state-policy.js';
import type { Artifact } from '../domain/artifact-policy.js';
import type {
  CaptionBuildInfo,
  MarketplaceImageEditorState,
  ModelCatalog,
  ThumbnailEditorState,
} from '../domain/artifact-types.js';
import type { ActorContext, ArtifactKey, DomainEvent, Revision } from '../domain/contracts.js';
import type { RunState } from '../domain/execution-policy.js';
export interface EditLease {
  id: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
}

import type { ResourceBindings } from '../domain/resource-bindings.js';
export interface ProjectState {
  resourceBindings?: ResourceBindings;
  schema: 'web-project/1';
  id: string;
  revision: Revision;
  lease: EditLease | null;
  artifacts: Partial<Record<ArtifactKey, Artifact>>;
  drafts: Partial<Record<ArtifactKey, Artifact>>;
  runs: RunState[];
  agentPreferences?: Record<string, { sessions: AgentStageSessions; model?: AgentModelSelection }>;
  agentImports?: {
    key: string;
    provider: 'codex' | 'grok';
    stage: string;
    sourceId: string;
    raw: string;
  }[];
  modelSelectionHistory?: { initial?: unknown; fix?: unknown };
  targetImageCount?: number | null;
  captionOutput?: { text: string; build: CaptionBuildInfo };
  editors?: { thumbnail?: ThumbnailEditorState; marketplace?: MarketplaceImageEditorState };
}
export interface ProjectTransaction {
  load(): Promise<ProjectState>;
  // Persist new state and its event in one atomic commit. Implementations must
  // enforce CAS, exclusive Project access and durable outbox ownership.
  commit(expectedRevision: Revision, next: ProjectState, event: DomainEvent): Promise<void>;
}
export interface ProjectRepository {
  transaction<T>(
    projectId: string,
    work: (transaction: ProjectTransaction) => Promise<T>,
  ): Promise<T>;
}
export interface Clock {
  now(): number;
}
export interface IdSource {
  next(): string;
}
export interface CatalogRepository {
  read(projectId: string): Promise<ModelCatalog | null>;
}
export function event(
  actor: ActorContext,
  project: ProjectState,
  type: DomainEvent['type'],
  subjectId: string,
): DomainEvent {
  return {
    projectId: project.id,
    userId: actor.userId,
    sessionId: actor.sessionId,
    requestId: actor.requestId,
    type,
    subjectId,
    revision: project.revision,
  };
}
