import {
  type AgentModelSelection,
  activateAgentSession,
  copySessions,
  rememberAgentSession,
  validateAgentModelSelection,
} from '../domain/agent-state-policy.js';
import {
  type ActorContext,
  authorize,
  BusinessError,
  type Command,
  type MutationCommand,
} from '../domain/contracts.js';
import type { AgentProvider, AgentScope, AgentStage } from './agent-use-cases.js';
import { assertCurrentProject, assertMutation, nextRevision } from './project-access.js';
import { type Clock, event, type ProjectRepository } from './project-ports.js';
export class AgentPreferencesUseCases {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly clock: Clock,
  ) {}
  private key(command: { stage: AgentStage; provider: AgentProvider }) {
    if (
      !['story', 'models', 'promptPlan', 'caption'].includes(command.stage) ||
      !['codex', 'grok'].includes(command.provider)
    )
      throw new BusinessError('INVALID_INPUT', 'Unknown agent scope.');
    return command.stage + ':' + command.provider;
  }
  async read(
    actor: ActorContext,
    command: Command & { stage: AgentStage; provider: AgentProvider },
  ) {
    authorize(actor, command.projectId, 'read');
    const key = this.key(command);
    return this.projects.transaction(command.projectId, async (tx) => {
      const p = await tx.load();
      assertCurrentProject(p, command.projectId);
      return p.agentPreferences?.[key] ?? { sessions: copySessions(undefined) };
    });
  }
  async prepareLaunch(actor: ActorContext, scope: AgentScope, sessionId: string | null) {
    authorize(actor, scope.projectId, 'execute');
    const key = this.key(scope);
    return this.projects.transaction(scope.projectId, async (tx) => {
      const p = await tx.load();
      assertCurrentProject(p, scope.projectId);
      const preference = p.agentPreferences?.[key];
      if (sessionId !== null) activateAgentSession(preference?.sessions, sessionId);
      return preference?.model ? validateAgentModelSelection(preference.model) : undefined;
    });
  }
  async update(
    actor: ActorContext,
    command: MutationCommand & {
      stage: AgentStage;
      provider: AgentProvider;
      change:
        | { kind: 'remember' | 'activate'; sessionId: string }
        | { kind: 'clear' }
        | { kind: 'model'; value: AgentModelSelection };
    },
  ) {
    authorize(actor, command.projectId, 'edit');
    const key = this.key(command);
    return this.projects.transaction(command.projectId, async (tx) => {
      const p = await tx.load();
      assertMutation(actor, command, p, this.clock);
      const previous = p.agentPreferences?.[key],
        next = { ...previous, sessions: copySessions(previous?.sessions) };
      if (command.change.kind === 'remember')
        next.sessions = rememberAgentSession(previous?.sessions, command.change.sessionId);
      else if (command.change.kind === 'activate')
        next.sessions = activateAgentSession(previous?.sessions, command.change.sessionId);
      else if (command.change.kind === 'clear') next.sessions.activeSessionId = null;
      else if (command.change.kind === 'model')
        next.model = validateAgentModelSelection(command.change.value);
      else throw new BusinessError('INVALID_INPUT', 'Unknown preference change.');
      p.agentPreferences = { ...p.agentPreferences, [key]: next };
      const before = p.revision;
      p.revision = nextRevision(p);
      await tx.commit(before, p, event(actor, p, 'project.changed', 'agent-preferences'));
      return p;
    });
  }
}
