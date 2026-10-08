import type {
  AgentProvider,
  GrokContextStage,
  GrokTask,
  AgentConversationMessage,
  AgentWorkspace,
  AgentConversationWorkspace,
} from '../domain/agent-runtime-types.js';
import type { AgentStageSessions } from '../domain/agent-state-policy.js';
import type { AutoArtifactEvent } from '../domain/auto-artifact-types.js';
import type { promptPatchBase } from './prompt-plan-patch.js';
export interface AgentSessionStatePort {
  get(root: string, stage: GrokContextStage, provider: AgentProvider): Promise<AgentStageSessions>;
  remember(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    sessionId: string,
  ): Promise<void>;
}
export interface AgentConversationPort {
  upsert(
    root: string,
    stage: GrokContextStage,
    provider: AgentProvider,
    sessionId: string,
    message: AgentConversationMessage,
  ): Promise<void>;
}
export interface AgentRuntimePorts {
  path: { resolve(file: string): string; basename(file: string): string };
  caseInsensitivePaths: boolean;
  now(): number;
  readFile(file: string, encoding: 'utf8'): Promise<string>;
  prepareAgentConversationWorkspace(
    userData: string,
    provider: AgentProvider,
    references: { name: string; content: string }[],
  ): Promise<AgentConversationWorkspace>;
  prepareAgentWorkspace(
    userData: string,
    provider: AgentProvider,
    stage: GrokTask['stage'],
    references: { name: string; content: string }[],
  ): Promise<AgentWorkspace>;
  removeAgentConversationWorkspace(
    userData: string,
    workspace: AgentConversationWorkspace,
  ): Promise<void>;
  removeAgentWorkspace(userData: string, workspace: AgentWorkspace): Promise<void>;
  rememberAgentWorkspace(
    root: string,
    workspace: AgentWorkspace,
    sessionId: string,
    turnId: string,
  ): Promise<void>;
  readAgentWorkspaceOutput(workspace: AgentWorkspace): Promise<string>;
  agentWorkspaceOutputInstruction(workspace: AgentWorkspace): string;
  buildGrokTask(root: string, stage: GrokTask['stage'], extra: string): Promise<GrokTask>;
  importAutoArtifact(
    root: string,
    provider: AgentProvider,
    stage: GrokTask['stage'],
    sourceId: string,
    raw: string,
    notify?: (event: AutoArtifactEvent) => void,
  ): Promise<unknown>;
  promptPlanPatchBase(root: string): ReturnType<typeof promptPatchBase>;
  isCancelled(error: unknown): boolean;
}
