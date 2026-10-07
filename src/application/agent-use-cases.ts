import type { AgentModelSelection } from '../domain/agent-state-policy.js';
import { requireMessage } from '../domain/artifact-policy.js';
import {
  type ActorContext,
  authorize,
  BusinessError,
  type Command,
  requireId,
} from '../domain/contracts.js';
export type AgentStage = 'story' | 'models' | 'promptPlan' | 'caption';
export type AgentProvider = 'codex' | 'grok';
export interface AgentScope {
  projectId: string;
  stage: AgentStage;
  provider: AgentProvider;
}
export interface AgentJob {
  id: string;
  status: 'reserved' | 'running' | 'completed' | 'failed' | 'cancelled' | 'unknown';
}
export interface AgentPort {
  // Durable and atomic across chat/task, BEFORE availability/model/workspace awaits.
  reserve(
    scope: AgentScope,
    requestId: string,
    input: {
      kind: 'chat' | 'task';
      text: string;
      sessionId: string | null;
      model?: AgentModelSelection;
      projectRevision?: number;
      attachments?: {
        name: string;
        resourceId: string;
        purpose: string;
        exists: boolean;
        content?: string;
        sha256?: string;
      }[];
    },
  ): Promise<{ job: AgentJob; acquired: boolean }>;
  available(scope: AgentScope): Promise<boolean>;
  launch(
    scope: AgentScope,
    jobId: string,
    input: {
      kind: 'chat' | 'task';
      text: string;
      sessionId: string | null;
      model?: AgentModelSelection;
      projectRevision?: number;
      attachments?: {
        name: string;
        resourceId: string;
        purpose: string;
        exists: boolean;
        content?: string;
        sha256?: string;
      }[];
    },
  ): Promise<AgentJob>;
  fail(scope: AgentScope, jobId: string): Promise<void>;
  markUnknown(scope: AgentScope, jobId: string): Promise<void>;
  stop(scope: AgentScope, jobId: string): Promise<AgentJob>;
  history(
    scope: AgentScope,
  ): Promise<readonly { id: string; role: 'user' | 'assistant'; text: string }[]>;
}
export class AgentUseCases {
  constructor(
    private readonly runtime: AgentPort,
    private readonly prepareLaunch?: (
      actor: ActorContext,
      scope: AgentScope,
      id: string | null,
    ) => Promise<AgentModelSelection | undefined>,
  ) {}
  private scope(
    actor: ActorContext,
    command: Command & { stage: AgentStage; provider: AgentProvider },
    permission: 'read' | 'execute',
  ): AgentScope {
    authorize(actor, command.projectId, permission);
    if (
      !['story', 'models', 'promptPlan', 'caption'].includes(command.stage) ||
      !['codex', 'grok'].includes(command.provider)
    )
      throw new BusinessError('INVALID_INPUT', 'Unknown agent scope.');
    return { projectId: command.projectId, stage: command.stage, provider: command.provider };
  }
  async start(
    actor: ActorContext,
    command: Command & {
      stage: AgentStage;
      provider: AgentProvider;
      kind: 'chat' | 'task';
      text: string;
      sessionId: string | null;
    },
  ) {
    const scope = this.scope(actor, command, 'execute');
    const text = requireMessage(command.text);
    if (
      !['chat', 'task'].includes(command.kind) ||
      (command.sessionId !== null &&
        (typeof command.sessionId !== 'string' || !command.sessionId.trim()))
    )
      throw new BusinessError('INVALID_INPUT', 'Invalid agent request.');
    const { job, acquired } = await this.runtime.reserve(scope, actor.requestId, {
      kind: command.kind,
      text,
      sessionId: command.sessionId,
    });
    // An idempotent retry must return its existing job without relaunching it.
    if (!acquired) return job;
    let model: AgentModelSelection | undefined;
    try {
      if (this.prepareLaunch) model = await this.prepareLaunch(actor, scope, command.sessionId);
      else if (command.sessionId !== null)
        throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Session ownership reader required.');
      if (!(await this.runtime.available(scope)))
        throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Configured agent is unavailable.');
    } catch (error) {
      await this.runtime.fail(scope, job.id);
      throw error;
    }
    try {
      return await this.runtime.launch(scope, job.id, {
        model,
        kind: command.kind,
        text,
        sessionId: command.sessionId,
      });
    } catch {
      // Launch may have been accepted. Keep ownership until explicit reconciliation.
      await this.runtime.markUnknown(scope, job.id);
      throw new BusinessError(
        'RUNTIME_UNCERTAIN',
        'Agent launch outcome is unknown; do not resubmit.',
      );
    }
  }
  async stop(
    actor: ActorContext,
    command: Command & { stage: AgentStage; provider: AgentProvider; jobId: string },
  ) {
    const scope = this.scope(actor, command, 'execute');
    requireId(command.jobId, 'Job');
    return this.runtime.stop(scope, command.jobId);
  }
  async history(
    actor: ActorContext,
    command: Command & { stage: AgentStage; provider: AgentProvider },
  ) {
    return this.runtime.history(this.scope(actor, command, 'read'));
  }
}
