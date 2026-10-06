import {
  authorize,
  BusinessError,
  requireId,
  type ActorContext,
  type Command,
} from '../domain/contracts.js';
import {
  assertConfirmation,
  type Confirmation,
  type ConfirmedOperation,
} from '../domain/confirmation-policy.js';
import type { Clock, IdSource } from './project-ports.js';
export interface ConfirmedJob {
  id: string;
  status: 'reserved' | 'running' | 'unknown';
}
export interface ConfirmationPort {
  inspect(
    projectId: string,
    operation: ConfirmedOperation,
    targetId: string,
  ): Promise<{ fingerprint: string; revision: number }>;
  save(value: Confirmation): Promise<void>;
  // Atomically consume token, re-inspect, and reserve operation before effects.
  execute(
    id: string,
    check: (value: Confirmation, current: { fingerprint: string; revision: number }) => void,
  ): Promise<ConfirmedJob>;
}
const operations: readonly ConfirmedOperation[] = [
  'rent-instance',
  'delete-instance',
  'trust-ssh',
  'discard-run',
  'restore-backup',
  'reset-editor',
  'rerun-plan',
];
export class ConfirmationUseCases {
  constructor(
    private readonly port: ConfirmationPort,
    private readonly clock: Clock,
    private readonly ids: IdSource,
  ) {}
  private validate(
    actor: ActorContext,
    command: Command & { operation: ConfirmedOperation; targetId: string },
  ) {
    authorize(actor, command.projectId, 'admin');
    requireId(command.targetId, 'Target');
    if (!operations.includes(command.operation))
      throw new BusinessError('INVALID_INPUT', 'Unknown confirmation operation.');
  }
  async prepare(
    actor: ActorContext,
    command: Command & { operation: ConfirmedOperation; targetId: string },
  ): Promise<Confirmation> {
    this.validate(actor, command);
    const current = await this.port.inspect(command.projectId, command.operation, command.targetId);
    const value: Confirmation = {
      fingerprint: current.fingerprint,
      revision: current.revision,
      projectId: command.projectId,
      operation: command.operation,
      targetId: command.targetId,
      id: this.ids.next(),
      userId: actor.userId,
      sessionId: actor.sessionId,
      expiresAt: this.clock.now() + 60_000,
    };
    await this.port.save(value);
    return value;
  }
  async confirm(
    actor: ActorContext,
    command: Command & { operation: ConfirmedOperation; targetId: string; confirmationId: string },
  ): Promise<ConfirmedJob> {
    this.validate(actor, command);
    requireId(command.confirmationId, 'Confirmation');
    return this.port.execute(command.confirmationId, (value, current) =>
      assertConfirmation(value, {
        fingerprint: current.fingerprint,
        revision: current.revision,
        projectId: command.projectId,
        operation: command.operation,
        targetId: command.targetId,
        userId: actor.userId,
        sessionId: actor.sessionId,
        now: this.clock.now(),
      }),
    );
  }
}
