import type {
  ActorContext,
  ArtifactKey,
  DomainEvent,
  Revision,
  Validation,
} from '../domain/contracts.js';
import type { Artifact } from '../domain/artifact-policy.js';
import type { RunState } from '../domain/execution-policy.js';
export interface EditLease {
  id: string;
  userId: string;
  sessionId: string;
  expiresAt: number;
}
export interface ProjectState {
  schema: 'web-project/1';
  id: string;
  revision: Revision;
  lease: EditLease | null;
  artifacts: Partial<Record<ArtifactKey, Artifact>>;
  drafts: Partial<Record<ArtifactKey, Artifact>>;
  runs: RunState[];
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
export interface ArtifactValidator {
  validate(key: ArtifactKey, content: string, project: ProjectState): Promise<Validation>;
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
