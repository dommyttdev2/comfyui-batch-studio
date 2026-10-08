import path from 'node:path';
import {
  activateAgentSession,
  copySessions,
  rememberAgentSession,
  validSessionId,
} from '../domain/agent-state-policy.js';
import type { AgentProvider, GrokContextStage } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';

export type { AgentStageSessions } from '../domain/agent-state-policy.js';

import type { AgentStageSessions } from '../domain/agent-state-policy.js';

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
        const sessions = rememberAgentSession(state.projects[key]?.[stage]?.[provider], sessionId);
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
        const sessions = activateAgentSession(state.projects[key]?.[stage]?.[provider], sessionId);
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
