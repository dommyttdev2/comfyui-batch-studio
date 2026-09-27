import type {
  AgentConversationMessage,
  AgentEvent,
  AgentModelSelection,
  AgentProvider,
  AgentTaskRequest,
  AgentTurn,
  GrokContextStage,
  GrokTask,
} from '../shared/types.js';
import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { AgentConversationStore } from './agent-conversation-store.js';
import { AgentSessionStateStore } from './agent-session-state.js';
import {
  prepareAgentConversationWorkspace,
  removeAgentConversationWorkspace,
  type AgentConversationWorkspace,
} from './agent-workspace.js';

type AdapterResolver = (provider: AgentProvider) => AgentCliAdapter;
type ModelResolver = (
  root: string,
  stage: GrokContextStage,
  provider: AgentProvider,
) => Promise<AgentModelSelection | undefined>;
type EventSink = (
  provider: AgentProvider,
  context: { root: string; stage: GrokContextStage },
  taskStage: GrokTask['stage'],
  event: AgentEvent,
) => void;

type ActiveConversation = {
  turn: AgentTurn;
  workspace: AgentConversationWorkspace | null;
};

function key(root: string, stage: GrokContextStage, provider: AgentProvider) {
  const resolved = process.platform === 'win32' ? root.toLowerCase() : root;
  return `${resolved}\0${stage}\0${provider}`;
}

function defaultTaskStage(stage: GrokContextStage): GrokTask['stage'] {
  if (stage === 'story') return 'story-initial';
  if (stage === 'models') return 'models';
  if (stage === 'prompt-plan') return 'prompt-plan';
  return 'caption';
}

function cancelled(error: unknown) {
  return error instanceof Error && /cancel/i.test(error.name + ' ' + error.message);
}

export interface AgentConversationRunnerOptions {
  userDataPath: string;
  sessions: AgentSessionStateStore;
  conversations: AgentConversationStore;
  adapter: AdapterResolver;
  model: ModelResolver;
  onEvent: EventSink;
}

export class AgentConversationRunner {
  private readonly userDataPath: string;
  private readonly sessions: AgentSessionStateStore;
  private readonly conversations: AgentConversationStore;
  private readonly adapterFor: AdapterResolver;
  private readonly modelFor: ModelResolver;
  private readonly onEvent: EventSink;
  private readonly active = new Map<string, ActiveConversation>();

  constructor(options: AgentConversationRunnerOptions) {
    this.userDataPath = options.userDataPath;
    this.sessions = options.sessions;
    this.conversations = options.conversations;
    this.adapterFor = options.adapter;
    this.modelFor = options.model;
    this.onEvent = options.onEvent;
  }

  isBusy(root: string, stage: GrokContextStage, provider: AgentProvider) {
    return this.active.has(key(root, stage, provider));
  }

  async send(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    text: string,
  ): Promise<AgentTurn> {
    const prompt = text.trim();
    if (!prompt || prompt.length > 750_000)
      throw new Error('AIへのメッセージが空、または長すぎます。');
    const activeKey = key(root, stage, provider);
    if (this.active.has(activeKey)) throw new Error('この会話は回答生成中です。');

    const adapter = this.adapterFor(provider);
    const availability = await adapter.checkAvailability();
    if (availability.state !== 'available')
      throw new Error(availability.message ?? `${provider} CLIを利用できません。`);

    const saved = await this.sessions.get(root, stage, provider);
    const model = await this.modelFor(root, stage, provider);
    const workspace =
      provider === 'grok'
        ? await prepareAgentConversationWorkspace(this.userDataPath, provider, [])
        : null;
    const taskStage = defaultTaskStage(stage);
    const request: AgentTaskRequest = {
      context: { root, stage },
      taskStage,
      prompt,
      extra: '',
      ...(workspace ? { workspace } : {}),
      ...(model ? { model } : {}),
    };

    const queued: AgentEvent[] = [];
    let ready = false;
    let turn: AgentTurn | null = null;
    const forward = (event: AgentEvent) => {
      if (!ready || !turn) {
        queued.push(event);
        return;
      }
      this.projectEvent(root, stage, provider, taskStage, turn, event);
    };

    try {
      turn = saved.activeSessionId
        ? await adapter.resumeTask(saved.activeSessionId, request, forward)
        : await adapter.startTask(request, forward);
      await this.sessions.remember(root, stage, provider, turn.sessionId);
      await this.conversations.upsert(root, stage, provider, turn.sessionId, {
        id: `${turn.turnId}:user`,
        role: 'user',
        text: prompt,
        at: Date.now(),
      });
    } catch (error) {
      if (turn) await adapter.stop(turn.turnId).catch(() => {});
      if (workspace)
        await removeAgentConversationWorkspace(this.userDataPath, workspace).catch(() => {});
      throw error;
    }
    if (!turn) throw new Error('AI conversation turnを開始できませんでした。');

    this.active.set(activeKey, { turn, workspace });
    ready = true;
    for (const event of queued.splice(0))
      this.projectEvent(root, stage, provider, taskStage, turn, event);

    void this.finish(activeKey, root, stage, provider, turn, workspace, adapter);
    return turn;
  }

  async stop(root: string, stage: GrokContextStage, provider: AgentProvider): Promise<void> {
    const active = this.active.get(key(root, stage, provider));
    if (!active) return;
    await this.adapterFor(provider).stop(active.turn.turnId);
  }

  async shutdown(): Promise<void> {
    const turns = [...this.active.entries()];
    await Promise.allSettled(
      turns.map(([activeKey, active]) => {
        const provider = active.turn.provider;
        this.active.delete(activeKey);
        return this.adapterFor(provider).stop(active.turn.turnId);
      }),
    );
  }

  private projectEvent(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    taskStage: GrokTask['stage'],
    turn: AgentTurn,
    event: AgentEvent,
  ) {
    this.onEvent(provider, { root, stage }, taskStage, event);
    if (event.type === 'message.completed') {
      const message: AgentConversationMessage = {
        id: `${turn.turnId}:assistant`,
        role: 'assistant',
        text: event.text,
        at: event.at,
      };
      void this.conversations
        .upsert(root, stage, provider, turn.sessionId, message)
        .catch(() => {});
    }
  }

  private async finish(
    activeKey: string,
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    turn: AgentTurn,
    workspace: AgentConversationWorkspace | null,
    adapter: AgentCliAdapter,
  ) {
    try {
      await adapter.waitForCompletion(turn.turnId);
    } catch (error) {
      if (!cancelled(error)) {
        // Provider adapters already emitted turn.failed. Keep the event path authoritative.
      }
    } finally {
      if (workspace)
        await removeAgentConversationWorkspace(this.userDataPath, workspace).catch(() => {});
      const current = this.active.get(activeKey);
      if (current?.turn.turnId === turn.turnId) this.active.delete(activeKey);
    }
  }
}
