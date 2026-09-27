import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type {
  AgentConversationMessage,
  AgentProvider,
  GrokContextStage,
} from '../shared/types.js';

interface ConversationRecord {
  updatedAt: number;
  messages: AgentConversationMessage[];
}

interface ConversationState {
  schemaVersion: 1;
  projects: Record<
    string,
    Partial<
      Record<
        GrokContextStage,
        Partial<Record<AgentProvider, Record<string, ConversationRecord>>>
      >
    >
  >;
}

const emptyState = (): ConversationState => ({ schemaVersion: 1, projects: {} });

function projectKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function validSessionId(id: string) {
  if (!id.trim() || id.length > 4096) throw new Error('Invalid agent session ID.');
}

function sanitizeMessage(value: AgentConversationMessage): AgentConversationMessage {
  if (!value.id.trim() || value.id.length > 4096) throw new Error('Invalid conversation message ID.');
  if (value.role !== 'user' && value.role !== 'assistant')
    throw new Error('Invalid conversation message role.');
  if (typeof value.text !== 'string' || value.text.length > 2_000_000)
    throw new Error('Invalid conversation message text.');
  return { ...value };
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
    validSessionId(sessionId);
    await this.writes;
    const record = (await this.read()).projects[projectKey(root)]?.[stage]?.[provider]?.[sessionId];
    if (!record || !Array.isArray(record.messages)) return [];
    return record.messages
      .filter(
        (message) =>
          message &&
          typeof message.id === 'string' &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.text === 'string' &&
          typeof message.at === 'number',
      )
      .map((message) => ({ ...message }));
  }

  async upsert(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    sessionId: string,
    message: AgentConversationMessage,
  ): Promise<void> {
    validSessionId(sessionId);
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
        const messages = Array.isArray(current?.messages) ? [...current.messages] : [];
        const index = messages.findIndex((item) => item.id === next.id);
        if (index >= 0) messages[index] = next;
        else messages.push(next);
        providerState[sessionId] = {
          updatedAt: Date.now(),
          messages: messages.slice(-500),
        };
        stageState[provider] = providerState;
        project[stage] = stageState;
        state.projects[key] = project;
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writes;
  }
}
