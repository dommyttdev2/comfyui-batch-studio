export interface GrokTask {
  stage:
    | 'story-initial'
    | 'story-finalize'
    | 'story-fix'
    | 'models'
    | 'models-fix'
    | 'prompt-plan'
    | 'prompt-plan-fix'
    | 'prompt-plan-patch'
    | 'caption';
  title: string;
  prompt: string;
  attachments: Array<{ name: string; path: string; purpose: string; exists: boolean }>;
}
export type GrokContextStage = 'story' | 'models' | 'prompt-plan' | 'caption';
export type AgentProvider = 'grok' | 'codex';
export type AssistantPaneProvider = AgentProvider;
export type AutoArtifactProvider = AgentProvider;

export interface AgentContext {
  root: string;
  stage: GrokContextStage;
}

export interface AgentCapabilities {
  structuredEvents: boolean;
  sessionResume: boolean;
  fileWorkspace: boolean;
  modelSelection: boolean;
  reasoningEffort: boolean;
}

export interface AgentAvailability {
  provider: AgentProvider;
  state: 'available' | 'missing' | 'unauthenticated' | 'unsupported' | 'error';
  version: string | null;
  message: string | null;
}

export interface AgentModelOption {
  id: string;
  displayName: string;
  supportedReasoningEfforts?: string[];
}

export interface AgentModelSelection {
  model: string | null;
  reasoningEffort?: string | null;
}

export interface AgentModelSettings {
  models: AgentModelOption[];
  selection: AgentModelSelection;
}

export interface AgentWorkspaceDescriptor {
  workspaceId: string;
  directory: string;
  inputDirectory: string;
  outputDirectory: string;
  outputPath: string;
  fileName: string;
}

export interface AgentConversationWorkspaceDescriptor {
  workspaceId: string;
  directory: string;
  inputDirectory: string;
}

export type AgentTaskWorkspaceDescriptor =
  | AgentWorkspaceDescriptor
  | AgentConversationWorkspaceDescriptor;

export interface AgentTaskRequest {
  context: AgentContext;
  taskStage: GrokTask['stage'];
  prompt: string;
  extra: string;
  workspace?: AgentTaskWorkspaceDescriptor;
  model?: AgentModelSelection;
}

export interface AgentTurn {
  provider: AgentProvider;
  sessionId: string;
  turnId: string;
}

export type AgentEvent =
  | { type: 'session.started'; at: number; sessionId: string }
  | { type: 'turn.started'; at: number; turnId: string }
  | { type: 'message.delta'; at: number; text: string }
  | { type: 'message.completed'; at: number; text: string }
  | { type: 'activity'; at: number; label: string; detail?: string }
  | { type: 'tool.started'; at: number; name: string }
  | { type: 'tool.completed'; at: number; name: string; success: boolean }
  | { type: 'file.changed'; at: number; path: string }
  | { type: 'artifact.ready'; at: number; fileName: string; path: string }
  | { type: 'turn.completed'; at: number; turnId: string }
  | { type: 'turn.failed'; at: number; error: string }
  | { type: 'turn.cancelled'; at: number; turnId: string };

export interface AgentEventEnvelope {
  provider: AgentProvider;
  root: string;
  stage: GrokContextStage;
  taskStage: GrokTask['stage'];
  event: AgentEvent;
}

export interface AgentConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

export interface AgentWorkspace {
  workspaceId: string;
  provider: AgentProvider;
  directory: string;
  inputDirectory: string;
  outputDirectory: string;
  outputPath: string;
  fileName: string;
  stage: GrokTask['stage'];
}

export interface AgentConversationWorkspace {
  workspaceId: string;
  provider: AgentProvider;
  directory: string;
  inputDirectory: string;
}
