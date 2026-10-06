export type ProjectId = string;
export type Revision = number;
export type ArtifactKey =
  | 'brief'
  | 'story'
  | 'models'
  | 'promptPlan'
  | 'workflow'
  | 'thumbnail'
  | 'marketplace'
  | 'caption';
export type Permission = 'read' | 'edit' | 'execute' | 'admin';
// Constructed by the authenticated input boundary, never from a submitted role/root.
export interface ActorContext {
  userId: string;
  sessionId: string;
  requestId: string;
  projectIds: readonly ProjectId[];
  permissions: readonly Permission[];
}
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'LEASE_REQUIRED'
  | 'PROJECT_BUSY'
  | 'INVALID_ARTIFACT'
  | 'CONFIRMATION_REQUIRED'
  | 'CONFIRMATION_EXPIRED'
  | 'TARGET_CHANGED'
  | 'RUNTIME_UNCERTAIN'
  | 'RUNTIME_BUSY'
  | 'DEPENDENCY_UNAVAILABLE';
export class BusinessError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BusinessError';
  }
}
export interface Command {
  projectId: ProjectId;
}
export interface MutationCommand extends Command {
  expectedRevision: Revision;
  leaseId: string;
}
export function requireId(value: string, label: string): void {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0'))
    throw new BusinessError('INVALID_INPUT', label + ' is required.');
}
export function requireRevision(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new BusinessError('INVALID_INPUT', 'A current server revision is required.');
}
export function authorize(actor: ActorContext, projectId: ProjectId, permission: Permission): void {
  requireId(projectId, 'Project ID');
  requireId(actor.userId, 'User ID');
  requireId(actor.sessionId, 'Session ID');
  requireId(actor.requestId, 'Request ID');
  if (!actor.projectIds.includes(projectId) || !actor.permissions.includes(permission))
    throw new BusinessError('FORBIDDEN', 'Operation is not permitted.');
}
export interface Validation {
  valid: boolean;
  issues: readonly { code: string; message: string }[];
}
export interface DomainEvent {
  projectId: ProjectId;
  userId: string;
  sessionId: string;
  requestId: string;
  type: 'project.changed' | 'execution.changed' | 'agent.changed';
  subjectId: string;
  revision: Revision;
}
