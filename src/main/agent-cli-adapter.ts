import type {
  AgentAvailability,
  AgentCapabilities,
  AgentEvent,
  AgentModelSettings,
  AgentProvider,
  AgentTaskRequest,
  AgentTurn,
} from '../shared/types.js';

export type AgentEventSink = (event: AgentEvent) => void;

export interface AgentCliAdapter {
  readonly provider: AgentProvider;
  readonly capabilities: AgentCapabilities;

  checkAvailability(): Promise<AgentAvailability>;
  getModels?(): Promise<AgentModelSettings>;

  startTask(task: AgentTaskRequest, onEvent: AgentEventSink): Promise<AgentTurn>;
  resumeTask(
    sessionId: string,
    task: AgentTaskRequest,
    onEvent: AgentEventSink,
  ): Promise<AgentTurn>;

  waitForCompletion(turnId: string): Promise<void>;
  stop(turnId: string): Promise<void>;
}
