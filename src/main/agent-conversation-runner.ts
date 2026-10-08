import {
  createAgentConversationRunner,
  type AgentConversationRunnerOptions,
} from '../application/agent-conversation-runner.js';
import { agentRuntimePorts } from './agent-runtime-ports.js';
export type { AgentConversationRunnerOptions } from '../application/agent-conversation-runner.js';
export const AgentConversationRunner = createAgentConversationRunner(agentRuntimePorts);
export type AgentConversationRunner = InstanceType<typeof AgentConversationRunner>;
