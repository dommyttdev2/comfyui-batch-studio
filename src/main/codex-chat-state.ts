import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type { GrokContextStage } from '../shared/types.js';

export interface CodexStageChats {
  activeThreadId: string | null;
  threadIds: string[];
}
interface CodexChatState {
  schemaVersion: 1;
  projects: Record<string, Partial<Record<GrokContextStage, CodexStageChats>>>;
}
const empty = (): CodexChatState => ({ schemaVersion: 1, projects: {} });
function rootKey(projectPath: string) {
  const root = path.resolve(projectPath);
  return process.platform === 'win32' ? root.toLowerCase() : root;
}
function copyChats(value: CodexStageChats | undefined): CodexStageChats {
  if (!value) return { activeThreadId: null, threadIds: [] };
  const threadIds = Array.isArray(value.threadIds)
    ? [...new Set(value.threadIds.filter((id) => typeof id === 'string' && id.length > 0))]
    : [];
  const activeThreadId =
    typeof value.activeThreadId === 'string' && threadIds.includes(value.activeThreadId)
      ? value.activeThreadId
      : null;
  return { activeThreadId, threadIds };
}

export class CodexChatStateStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'codex-chat-state.json');
  }

  private async read(): Promise<CodexChatState> {
    const value = await readJson<CodexChatState>(this.filePath);
    return value?.schemaVersion === 1 && value.projects && typeof value.projects === 'object'
      ? value
      : empty();
  }

  async get(projectPath: string, stage: GrokContextStage): Promise<CodexStageChats> {
    await this.writeQueue;
    const state = await this.read();
    return copyChats(state.projects[rootKey(projectPath)]?.[stage]);
  }

  async remember(projectPath: string, stage: GrokContextStage, threadId: string): Promise<void> {
    if (!threadId.trim()) throw new Error('Invalid Codex thread ID');
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = rootKey(projectPath);
        const chats = copyChats(state.projects[key]?.[stage]);
        chats.threadIds = [threadId, ...chats.threadIds.filter((id) => id !== threadId)];
        chats.activeThreadId = threadId;
        state.projects[key] = { ...(state.projects[key] ?? {}), [stage]: chats };
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writeQueue;
  }

  async clearActive(projectPath: string, stage: GrokContextStage): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = rootKey(projectPath);
        const chats = copyChats(state.projects[key]?.[stage]);
        chats.activeThreadId = null;
        state.projects[key] = { ...(state.projects[key] ?? {}), [stage]: chats };
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writeQueue;
  }
}
