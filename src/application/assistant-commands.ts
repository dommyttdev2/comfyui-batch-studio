import type { AgentProvider, GrokContextStage, GrokTask } from '../domain/agent-runtime-types.js';
import { validSessionId } from '../domain/agent-state-policy.js';
import { contextStageForTask } from '../domain/agent-stage-policy.js';
import type { AgentConversationRunnerContract } from './agent-conversation-runner.js';
import type { CodexCliTaskRunnerContract } from './codex-cli-task-runner.js';
export interface AssistantCommandContext {
  root: string;
  stage: GrokContextStage;
  provider: AgentProvider;
}
export interface AssistantCommandPorts {
  conversation: AgentConversationRunnerContract | null;
  tasks: Record<AgentProvider, CodexCliTaskRunnerContract | null>;
  sessions: {
    clearActive(root: string, stage: GrokContextStage, provider: AgentProvider): Promise<void>;
    activate(
      root: string,
      stage: GrokContextStage,
      provider: AgentProvider,
      id: string,
    ): Promise<void>;
  } | null;
  rootKey(root: string): string;
}
export class AssistantCommands {
  private readonly gates = new Map<string, Promise<void>>();
  constructor(private readonly ports: AssistantCommandPorts) {}
  private async exclusive<T>(context: AssistantCommandContext, work: () => Promise<T>): Promise<T> {
    const key = JSON.stringify([this.ports.rootKey(context.root), context.stage, context.provider]);
    const previous = this.gates.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => gate);
    this.gates.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.gates.get(key) === tail) this.gates.delete(key);
    }
  }
  private conversation() {
    if (!this.ports.conversation) throw new Error('共通AI runtimeが初期化されていません。');
    return this.ports.conversation;
  }
  private task(provider: AgentProvider) {
    const task = this.ports.tasks[provider];
    if (!task) throw new Error(`${provider} CLIが初期化されていません。`);
    return task;
  }
  private sessions() {
    if (!this.ports.sessions) throw new Error('共通AI session runtimeが初期化されていません。');
    return this.ports.sessions;
  }
  private requireIdle(context: AssistantCommandContext) {
    if (
      this.conversation().isBusy(context.root, context.stage, context.provider) ||
      this.task(context.provider).isBusy(context.root, context.stage)
    )
      throw new Error('回答生成中は別のAI操作を開始できません。');
  }
  send(context: AssistantCommandContext, message: string) {
    return this.exclusive(context, () => {
      this.requireIdle(context);
      return this.conversation().send(context.root, context.stage, context.provider, message);
    });
  }
  stopConversation(context: AssistantCommandContext) {
    return this.exclusive(context, () =>
      this.conversation().stop(context.root, context.stage, context.provider),
    );
  }
  newConversation(context: AssistantCommandContext) {
    return this.exclusive(context, () => {
      this.requireIdle(context);
      return this.sessions().clearActive(context.root, context.stage, context.provider);
    });
  }
  selectModel<T>(context: AssistantCommandContext, save: () => Promise<T>) {
    return this.exclusive(context, () => {
      this.requireIdle(context);
      return save();
    });
  }
  restoreConversation(context: AssistantCommandContext, id: string) {
    validSessionId(id);
    return this.exclusive(context, () => {
      this.requireIdle(context);
      return this.sessions().activate(context.root, context.stage, context.provider, id);
    });
  }
  startTask(root: string, provider: AgentProvider, stage: GrokTask['stage'], extra: string) {
    const context = { root, provider, stage: contextStageForTask(stage) };
    if (extra.length > 30_000) throw new Error('Invalid additional instructions.');
    return this.exclusive(context, () => {
      this.requireIdle(context);
      return this.task(provider).run(root, context.stage, stage, extra);
    });
  }
  stopTask(root: string, provider: AgentProvider, stage: GrokTask['stage']) {
    const context = { root, provider, stage: contextStageForTask(stage) };
    return this.exclusive(context, () => this.task(provider).stop(root, context.stage));
  }
}
