import {
  validConversationSessionId,
  sanitizeMessage,
  validConversationMessages,
  upsertConversationMessage,
} from '../domain/agent-conversation-policy.js';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type { AgentConversationMessage, AgentProvider, GrokContextStage } from '../shared/types.js';

interface ConversationRecord {
  updatedAt: number;
  messages: AgentConversationMessage[];
}

interface ConversationState {
  schemaVersion: 1;
  projects: Record<
    string,
    Partial<
      Record<GrokContextStage, Partial<Record<AgentProvider, Record<string, ConversationRecord>>>>
    >
  >;
}

const emptyState = (): ConversationState => ({ schemaVersion: 1, projects: {} });

function projectKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

export class AgentConversationStore {
  private readonly filePath: string;
  private writes: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'agent-conversations.json');
  }

  private async read(): Promise<ConversationState> {
    const state = await readJson<ConversationState>(this.filePath);
    return state?.schemaVersion === 1 && state.projects && typeof state.projects === 'object'
      ? state
      : emptyState();
  }

  async messages(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    sessionId: string | null,
  ): Promise<AgentConversationMessage[]> {
    if (!sessionId) return [];
    validConversationSessionId(sessionId);
    await this.writes;
    const record = (await this.read()).projects[projectKey(root)]?.[stage]?.[provider]?.[sessionId];
    if (!record || !Array.isArray(record.messages)) return [];
    return validConversationMessages(record.messages);
  }

  async upsert(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    sessionId: string,
    message: AgentConversationMessage,
  ): Promise<void> {
    validConversationSessionId(sessionId);
    const next = sanitizeMessage(message);
    this.writes = this.writes
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = projectKey(root);
        const project = { ...(state.projects[key] ?? {}) };
        const stageState = { ...(project[stage] ?? {}) };
        const providerState = { ...(stageState[provider] ?? {}) };
        const current = providerState[sessionId];
        const messages = upsertConversationMessage(current?.messages, next);
        providerState[sessionId] = {
          updatedAt: Date.now(),
          messages,
        };
        stageState[provider] = providerState;
        project[stage] = stageState;
        state.projects[key] = project;
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writes;
  }
}
