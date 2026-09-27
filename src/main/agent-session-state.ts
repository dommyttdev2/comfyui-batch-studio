import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import type { AgentProvider, GrokContextStage } from '../shared/types.js';

export interface AgentStageSessions {
  activeSessionId: string | null;
  sessionIds: string[];
}

interface AgentSessionState {
  schemaVersion: 1;
  projects: Record<
    string,
    Partial<Record<GrokContextStage, Partial<Record<AgentProvider, AgentStageSessions>>>>
  >;
}

const emptyState = (): AgentSessionState => ({ schemaVersion: 1, projects: {} });

function projectKey(projectPath: string) {
  const resolved = path.resolve(projectPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function copySessions(value: AgentStageSessions | undefined): AgentStageSessions {
  if (!value) return { activeSessionId: null, sessionIds: [] };
  const sessionIds = Array.isArray(value.sessionIds)
    ? [...new Set(value.sessionIds.filter((id) => typeof id === 'string' && id.trim().length > 0))]
    : [];
  const activeSessionId =
    typeof value.activeSessionId === 'string' && sessionIds.includes(value.activeSessionId)
      ? value.activeSessionId
      : null;
  return { activeSessionId, sessionIds };
}

function validSessionId(sessionId: string) {
  if (!sessionId.trim() || sessionId.length > 4096) throw new Error('Invalid agent session ID');
}

export class AgentSessionStateStore {
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, 'agent-session-state.json');
  }

  private async read(): Promise<AgentSessionState> {
    const value = await readJson<AgentSessionState>(this.filePath);
    return value?.schemaVersion === 1 && value.projects && typeof value.projects === 'object'
      ? value
      : emptyState();
  }

  async get(
    projectPath: string,
    stage: GrokContextStage,
    provider: AgentProvider,
  ): Promise<AgentStageSessions> {
    await this.writeQueue;
    const state = await this.read();
    return copySessions(state.projects[projectKey(projectPath)]?.[stage]?.[provider]);
  }

  async remember(
    projectPath: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    sessionId: string,
  ): Promise<void> {
    validSessionId(sessionId);
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = projectKey(projectPath);
        const sessions = copySessions(state.projects[key]?.[stage]?.[provider]);
        sessions.sessionIds = [
          sessionId,
          ...sessions.sessionIds.filter((existing) => existing !== sessionId),
        ].slice(0, 100);
        sessions.activeSessionId = sessionId;
        const stageState = { ...(state.projects[key]?.[stage] ?? {}), [provider]: sessions };
        state.projects[key] = { ...(state.projects[key] ?? {}), [stage]: stageState };
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writeQueue;
  }

  async activate(
    projectPath: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    sessionId: string,
  ): Promise<void> {
    validSessionId(sessionId);
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = projectKey(projectPath);
        const sessions = copySessions(state.projects[key]?.[stage]?.[provider]);
        if (!sessions.sessionIds.includes(sessionId))
          throw new Error('Agent session is not part of this stage.');
        sessions.activeSessionId = sessionId;
        const stageState = { ...(state.projects[key]?.[stage] ?? {}), [provider]: sessions };
        state.projects[key] = { ...(state.projects[key] ?? {}), [stage]: stageState };
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writeQueue;
  }

  async clearActive(
    projectPath: string,
    stage: GrokContextStage,
    provider: AgentProvider,
  ): Promise<void> {
    this.writeQueue = this.writeQueue
      .catch(() => {})
      .then(async () => {
        const state = await this.read();
        const key = projectKey(projectPath);
        const sessions = copySessions(state.projects[key]?.[stage]?.[provider]);
        sessions.activeSessionId = null;
        const stageState = { ...(state.projects[key]?.[stage] ?? {}), [provider]: sessions };
        state.projects[key] = { ...(state.projects[key] ?? {}), [stage]: stageState };
        await writeJsonAtomic(this.filePath, state);
      });
    await this.writeQueue;
  }
}
