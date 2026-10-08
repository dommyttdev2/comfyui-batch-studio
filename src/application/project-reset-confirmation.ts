import { assertConfirmation, type Confirmation } from '../domain/confirmation-policy.js';
import type { ActorContext, MutationCommand, ArtifactKey } from '../domain/contracts.js';
import { authorize } from '../domain/contracts.js';
import type { ModelResetScope } from '../domain/model-reset-policy.js';
import type { ProjectState, Clock } from './project-ports.js';
import { assertMutation } from './project-access.js';
import type { ProjectUseCases } from './project-use-cases.js';
export interface ProjectConfirmationPort {
  take(id: string): Confirmation;
  fingerprint(project: ProjectState): string;
}
export async function confirmedProjectReset(
  actor: ActorContext,
  command: MutationCommand & { confirmationId: string },
  target: ArtifactKey | ModelResetScope,
  stage: boolean,
  project: ProjectState,
  clock: Clock,
  port: ProjectConfirmationPort,
  projects: ProjectUseCases,
) {
  authorize(actor, command.projectId, 'edit');
  assertMutation(actor, command, project, clock);
  const value = port.take(command.confirmationId);
  assertConfirmation(value, {
    userId: actor.userId,
    sessionId: actor.sessionId,
    projectId: command.projectId,
    operation: stage ? 'stage-reset' : 'artifact-reset',
    targetId: target,
    fingerprint: port.fingerprint(project),
    revision: project.revision,
    now: clock.now(),
  });
  return stage
    ? projects.resetStage(actor, { ...command, scope: target as ModelResetScope })
    : projects.reset(actor, { ...command, key: target as ArtifactKey });
}
