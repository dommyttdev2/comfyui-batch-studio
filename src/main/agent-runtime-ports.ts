import path from 'node:path';
import { readFile } from 'node:fs/promises';
import type { AgentRuntimePorts } from '../application/agent-runtime-ports.js';
import {
  prepareAgentConversationWorkspace,
  prepareAgentWorkspace,
  removeAgentConversationWorkspace,
  removeAgentWorkspace,
  rememberAgentWorkspace,
  readAgentWorkspaceOutput,
  agentWorkspaceOutputInstruction,
} from './agent-workspace.js';
import { buildGrokTask } from './grok-context.js';
import { importAutoArtifact } from './agent-artifact-import.js';
import { promptPlanPatchBase } from './prompt-plan-patch.js';
import { AgentTurnCancelledError } from './codex-cli-adapter.js';
import { GrokTurnCancelledError } from './grok-cli-adapter.js';
export const agentRuntimePorts: AgentRuntimePorts = {
  path,
  readFile,
  caseInsensitivePaths: process.platform === 'win32',
  now: Date.now,
  prepareAgentConversationWorkspace,
  prepareAgentWorkspace,
  removeAgentConversationWorkspace,
  removeAgentWorkspace,
  rememberAgentWorkspace,
  readAgentWorkspaceOutput,
  agentWorkspaceOutputInstruction,
  buildGrokTask,
  importAutoArtifact,
  promptPlanPatchBase,
  isCancelled: (error) =>
    error instanceof AgentTurnCancelledError || error instanceof GrokTurnCancelledError,
};
