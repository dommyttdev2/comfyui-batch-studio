import { BusinessError } from './contracts.js';
export type ConfirmedOperation =
  | 'rent-instance'
  | 'delete-instance'
  | 'trust-ssh'
  | 'discard-run'
  | 'restore-backup'
  | 'reset-editor'
  | 'rerun-plan'
  | 'artifact-reset'
  | 'stage-reset';
export interface Confirmation {
  id: string;
  userId: string;
  sessionId: string;
  projectId: string;
  operation: ConfirmedOperation;
  targetId: string;
  fingerprint: string;
  revision: number;
  expiresAt: number;
}
export function assertConfirmation(
  value: Confirmation,
  current: {
    userId: string;
    sessionId: string;
    projectId: string;
    operation: ConfirmedOperation;
    targetId: string;
    fingerprint: string;
    revision: number;
    now: number;
  },
): void {
  if (
    value.userId !== current.userId ||
    value.sessionId !== current.sessionId ||
    value.projectId !== current.projectId ||
    value.operation !== current.operation ||
    value.targetId !== current.targetId
  )
    throw new BusinessError('FORBIDDEN', 'Confirmation belongs to a different actor or target.');
  if (current.now >= value.expiresAt)
    throw new BusinessError('CONFIRMATION_EXPIRED', 'Confirmation expired.');
  if (value.revision !== current.revision || value.fingerprint !== current.fingerprint)
    throw new BusinessError('TARGET_CHANGED', 'Confirmation target changed.');
}
