import { downstream } from '../domain/artifact-policy.js';
import {
  type ActorContext,
  authorize,
  BusinessError,
  type MutationCommand,
  requireRevision,
} from '../domain/contracts.js';
import { assertProjectWritable, assertRunState } from '../domain/execution-policy.js';
import { promptFallbacksValid } from '../domain/model-draft-policy.js';
import type { Clock, ProjectState } from './project-ports.js';
export function assertCurrentProject(project: ProjectState, projectId: string): void {
  if (
    !project ||
    project.schema !== 'web-project/1' ||
    project.id !== projectId ||
    !Number.isSafeInteger(project.revision) ||
    project.revision < 0
  )
    throw new BusinessError('INVALID_INPUT', 'Current Web Project schema is required.');
  if (
    !Array.isArray(project.runs) ||
    !project.artifacts ||
    typeof project.artifacts !== 'object' ||
    Array.isArray(project.artifacts) ||
    !project.drafts ||
    typeof project.drafts !== 'object' ||
    Array.isArray(project.drafts) ||
    !Object.hasOwn(project, 'lease')
  )
    throw new BusinessError('INVALID_INPUT', 'Current Project state is incomplete.');
  for (const run of project.runs) assertRunState(run);
  for (const [key, artifact] of [
    ...Object.entries(project.artifacts),
    ...Object.entries(project.drafts),
  ]) {
    if (
      !Object.hasOwn(downstream, key) ||
      !artifact ||
      artifact.key !== key ||
      typeof artifact.content !== 'string' ||
      !['draft', 'confirmed', 'stale'].includes(artifact.status) ||
      typeof artifact.validation?.valid !== 'boolean' ||
      !Array.isArray(artifact.validation.issues)
    )
      throw new BusinessError('INVALID_INPUT', 'Current Artifact state is required.');
  }
  for (const artifact of Object.values(project.artifacts))
    if (
      artifact?.modelPromptFallbacks !== undefined &&
      (artifact.key !== 'models' ||
        !promptFallbacksValid({ promptFallbacks: artifact.modelPromptFallbacks }))
    )
      throw new BusinessError('INVALID_INPUT', 'Invalid stored supplemental model tags.');
  if (
    project.lease !== null &&
    (!project.lease ||
      typeof project.lease.id !== 'string' ||
      typeof project.lease.userId !== 'string' ||
      typeof project.lease.sessionId !== 'string' ||
      !Number.isSafeInteger(project.lease.expiresAt))
  )
    throw new BusinessError('INVALID_INPUT', 'Current lease state is required.');
}
export function assertMutation(
  actor: ActorContext,
  command: MutationCommand,
  project: ProjectState,
  clock: Clock,
): void {
  authorize(actor, command.projectId, 'edit');
  requireRevision(command.expectedRevision);
  assertCurrentProject(project, command.projectId);
  if (project.revision !== command.expectedRevision)
    throw new BusinessError('REVISION_CONFLICT', 'Project revision changed.');
  const lease = project.lease;
  if (
    !lease ||
    lease.id !== command.leaseId ||
    lease.userId !== actor.userId ||
    lease.sessionId !== actor.sessionId ||
    lease.expiresAt <= clock.now()
  )
    throw new BusinessError('LEASE_REQUIRED', 'A current editing lease is required.');
  assertProjectWritable(project.runs);
}
export function nextRevision(project: ProjectState): number {
  const next = project.revision + 1;
  if (!Number.isSafeInteger(next))
    throw new BusinessError('REVISION_CONFLICT', 'Project revision exhausted.');
  return next;
}
