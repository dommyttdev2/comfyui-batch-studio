import type { VastAiInstance } from '../domain/artifact-types.js';

export type { VastAiInstance } from '../domain/artifact-types.js';

import type {
  CaptionBuildInfo,
  CaptionStatus,
  FinalArtifactStatus,
  MarketplaceCropRect,
  MarketplaceCustomState,
  MarketplaceEditorMode,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
  MarketplaceSourceType,
  MarketplaceTargetState,
  MissingRequirement,
  PromptFallback,
  ThumbnailDocument,
  ThumbnailEditorState,
  ThumbnailPattern,
  ThumbnailSlotKey,
  ThumbnailSlotState,
  ThumbnailTextState,
} from '../domain/artifact-types.js';

export type {
  CaptionBuildInfo,
  CaptionStatus,
  FinalArtifactStatus,
  MarketplaceCropRect,
  MarketplaceCustomState,
  MarketplaceEditorMode,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  MarketplaceOutputFormat,
  MarketplaceSourceType,
  MarketplaceTargetState,
  MissingRequirement,
  PromptFallback,
  ThumbnailDocument,
  ThumbnailEditorState,
  ThumbnailPattern,
  ThumbnailSlotKey,
  ThumbnailSlotState,
  ThumbnailTextState,
} from '../domain/artifact-types.js';

import type {
  ArtifactKey,
  ArtifactState,
  ArtifactSummary,
  AvailabilityResult,
  ProjectMeta,
  ProjectSettings,
  ProjectSummary,
} from '../domain/artifact-types.js';

export type {
  ArtifactKey,
  ArtifactState,
  ArtifactSummary,
  AvailabilityResult,
  ProjectMeta,
  ProjectSettings,
  ProjectSummary,
} from '../domain/artifact-types.js';

import type {
  CameraPromptGroups,
  CaptionContent,
  CatalogClipSelection,
  CatalogCollection,
  CatalogFile,
  CatalogItem,
  CatalogTextEncoderSelection,
  CatalogVersion,
  CheckpointSelection,
  CivitaiGenerationExample,
  ClipSelection,
  CloudInstanceProviderId,
  CloudInstanceStatus,
  DiffusionModelSelection,
  ExecutionBranchProgress,
  ExecutionError,
  ExecutionEvidence,
  ExecutionEvidenceKind,
  ExecutionGenerationTiming,
  ExecutionModelProgress,
  ExecutionPhase,
  ExecutionProgressCounter,
  ExecutionRemoteInstanceSnapshot,
  ExecutionRemoteLifecycleState,
  ExecutionRun,
  ExecutionRunLifecycle,
  ExecutionRunSnapshot,
  ExecutionTarget,
  LoraSelection,
  LoraUsage,
  ModelAvailabilityRow,
  ModelCatalog,
  ModelFamily,
  ModelFileCandidate,
  ModelFileRole,
  ModelFileSelectionBase,
  ModelSelectionBase,
  ModelSelectionRole,
  ModelsArtifact,
  NegativePromptGroups,
  PositivePromptGroups,
  PreflightResult,
  ProjectBriefInput,
  PromptBranchV1,
  PromptBranchV2,
  PromptLeafV1,
  PromptLeafV2,
  PromptPlanArtifact,
  PromptPlanArtifactV1,
  PromptPlanArtifactV2,
  PromptSubmissionIntent,
  Severity,
  StrengthBaseline,
  StructuredPrompt,
  TextEncoderSelection,
  TriggerWordSelection,
  VaeSelection,
  ValidationIssue,
  ValidationResult,
  WorkflowManifest,
} from '../domain/artifact-types.js';

export type {
  CameraPromptGroups,
  CaptionContent,
  CatalogClipSelection,
  CatalogCollection,
  CatalogFile,
  CatalogItem,
  CatalogTextEncoderSelection,
  CatalogVersion,
  CheckpointSelection,
  CivitaiGenerationExample,
  ClipSelection,
  CloudInstanceProviderId,
  CloudInstanceStatus,
  DiffusionModelSelection,
  ExecutionBranchProgress,
  ExecutionError,
  ExecutionEvidence,
  ExecutionEvidenceKind,
  ExecutionGenerationTiming,
  ExecutionModelProgress,
  ExecutionPhase,
  ExecutionProgressCounter,
  ExecutionRemoteInstanceSnapshot,
  ExecutionRemoteLifecycleState,
  ExecutionRun,
  ExecutionRunLifecycle,
  ExecutionRunSnapshot,
  ExecutionTarget,
  LoraSelection,
  LoraUsage,
  ModelAvailabilityRow,
  ModelCatalog,
  ModelFamily,
  ModelFileCandidate,
  ModelFileRole,
  ModelFileSelectionBase,
  ModelSelectionBase,
  ModelSelectionRole,
  ModelsArtifact,
  NegativePromptGroups,
  PositivePromptGroups,
  PreflightResult,
  ProjectBriefInput,
  PromptBranchV1,
  PromptBranchV2,
  PromptLeafV1,
  PromptLeafV2,
  PromptPlanArtifact,
  PromptPlanArtifactV1,
  PromptPlanArtifactV2,
  PromptSubmissionIntent,
  Severity,
  StrengthBaseline,
  StructuredPrompt,
  TextEncoderSelection,
  TriggerWordSelection,
  VaeSelection,
  ValidationIssue,
  ValidationResult,
  WorkflowManifest,
} from '../domain/artifact-types.js';

export interface AppSettings {
  comfyUiInstallPath: string;
  assistantProvider?: 'grok' | 'codex';
  remoteComfyUiInstallPath?: string;
  comfyUiApiEndpoint?: string;
  projectRoot?: string;
  artifactRoot?: string;
  catalogPath?: string;
  r2Bucket?: string;
  r2ModelPrefix?: string;
  r2IndexPath?: string;
  templatePath?: string;
  manifestPath?: string;
}
export interface AppSettingsSaveInput extends AppSettings {
  githubPat?: string;
}
export interface LocalModelFile {
  fileName: string;
  path: string;
  size: number;
}
export interface LocalModelDirectory {
  path: string | null;
  exists: boolean;
  files: LocalModelFile[];
}
export interface AppSettingsStatus extends Required<AppSettings> {
  configured: boolean;
  githubPatConfigured: boolean;
  githubPatSource: 'saved' | 'environment' | 'none';
  modelsPath: string | null;
  installExists: boolean;
  modelsExists: boolean;
  modelFiles: { text_encoders: LocalModelDirectory; vae: LocalModelDirectory };
}

export interface ArtifactReadResult {
  key: ArtifactKey;
  source: 'confirmed' | 'draft';
  content: string | null;
  exists: boolean;
  validation: ValidationResult;
}

export type { ImportResult } from '../domain/artifact-types.js';

import type { ImportResult } from '../domain/artifact-types.js';

export type GrokLoraSelectionStage = 'models' | 'models-fix';
export interface GrokLoraSelectionHistoryEntry {
  id: string;
  stage: GrokLoraSelectionStage;
  createdAt: string;
  loras: LoraSelection[];
}
export interface LoraFileAvailability {
  fileName: string;
  local: boolean;
  r2: boolean;
}

export type PromptLeaf = PromptLeafV1 | PromptLeafV2;
export type PromptBranch = PromptBranchV1 | PromptBranchV2;

export interface CatalogStatus {
  configured: boolean;
  path: string | null;
  exists: boolean;
  schemaVersion?: number;
  generation?: number;
  generatedAt?: string;
  itemCount: number;
  error?: string;
}
export interface CivitaiCatalogStatus {
  state: 'idle' | 'running' | 'ready' | 'error';
  phase: string;
  completed: number;
  total: number;
  message: string;
  generation: number;
  changes: { added: number; updated: number; removed: number };
  error: string | null;
  apiKeyConfigured: boolean;
  catalogPath: string;
}
export interface CivitaiConnectionInput {
  apiKey: string;
}
export interface CivitaiConnectionStatus {
  configured: boolean;
  source: 'saved' | 'environment' | 'none';
}
export interface VastAiConnectionInput {
  apiKey?: string;
  sshPrivateKeyPath?: string;
  sshPublicKeyPath?: string;
  sshUser?: string;
}
export interface VastAiConnectionStatus {
  configured: boolean;
  source: 'saved' | 'environment' | 'none';
  sshPrivateKeyPath: string;
  sshPrivateKeyExists: boolean;
  sshPublicKeyPath: string;
  sshPublicKeyExists: boolean;
  sshKeyPairValid: boolean;
  sshUser: string;
}
export interface VastAiComfyUiTemplate {
  id: number | null;
  hashId: string;
  name: string;
  recommendedDiskSpaceGb: number;
  countCreated: number | null;
  extraFilters: Record<string, unknown>;
}
export interface VastAiOfferSearchInput {
  storageGb: number;
  minTflops: number;
  gpuCount: number;
  minReliability: number;
  excludedCountries: string[];
}
export interface VastAiOffer {
  id: number;
  gpuName: string | null;
  gpuCount: number | null;
  gpuRamMb: number | null;
  gpuTotalRamMb: number | null;
  totalFlops: number | null;
  gpuMemBandwidthGbps: number | null;
  verification: string | null;
  geolocation: string | null;
  machineId: number | null;
  hostId: number | null;
  motherboard: string | null;
  pciGen: number | null;
  gpuLanes: number | null;
  pcieBandwidthGbps: number | null;
  cpuName: string | null;
  cpuCores: number | null;
  cpuCoresEffective: number | null;
  cpuRamMb: number | null;
  diskName: string | null;
  diskBandwidthMb: number | null;
  diskSpaceGb: number | null;
  internetDownMb: number | null;
  internetUpMb: number | null;
  directPortCount: number | null;
  dlperf: number | null;
  cudaMaxGood: number | null;
  durationSeconds: number | null;
  reliability: number | null;
  dlperfPerDollar: number | null;
  flopsPerDollar: number | null;
  hourlyCost: number | null;
  storageCostPerGbMonth: number | null;
  internetDownCostPerTb: number | null;
  internetUpCostPerTb: number | null;
}
export interface VastAiOfferSearchResult {
  template: VastAiComfyUiTemplate;
  offers: VastAiOffer[];
}
export interface VastAiRentRequest {
  offerId: number;
  storageGb: number;
  templateHashId: string;
}

export interface VastAiSshEndpoint {
  provider: 'vastai';
  instanceId: number;
  host: string;
  port: number;
  user: string;
  privateKeyPath: string;
  publicKeyPath: string;
  comfyUiDirectory: string;
  comfyUiPort: number;
}

export interface CatalogSelectionEntry {
  collectionId: number;
  modelId: number;
  versionId: number;
}
export interface CatalogSelectionTemplate {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  selection: CatalogSelectionEntry[];
}
export interface CatalogSelectionTemplateInput {
  id?: string;
  name: string;
  selection: CatalogSelectionEntry[];
}

export interface FinalArtifactImageItem {
  path: string;
  name: string;
}

export interface FinalArtifactImageSource extends FinalArtifactImageItem {
  width: number;
  height: number;
  dataUrl: string;
}

export type ThumbnailImageItem = FinalArtifactImageItem;
export type ThumbnailImageSource = FinalArtifactImageSource & { cacheVersion?: string };

export interface ThumbnailPickerSession {
  sessionId: string;
}

export interface ThumbnailPickerContext extends ThumbnailPickerSession {
  root: string;
  slot: ThumbnailSlotKey;
  currentImagePath: string;
}

export interface ThumbnailPickerSelection extends ThumbnailPickerSession {
  slot: ThumbnailSlotKey;
  imagePath: string;
  previewGeneration?: number;
}

export interface ThumbnailTemplateSource {
  name: string;
  dataUrl: string;
}

export interface ThumbnailExportResult {
  path: string;
  cleanupWarning?: string;
}

export interface MarketplaceGenerationResult {
  outputDirectory: string;
  outputPaths: string[];
  zipPath: string | null;
  cleanupWarning?: string;
}

export interface MarketplacePickerSession {
  sessionId: string;
}

export interface MarketplacePickerContext extends MarketplacePickerSession {
  root: string;
  sourceType: MarketplaceSourceType;
  currentImagePath: string;
}

export interface MarketplacePickerSelection extends MarketplacePickerSession {
  imagePath: string;
  previewGeneration?: number;
}

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

export interface CompileResult {
  outputPath: string;
  apiOutputPath: string;
  branchCount: number;
  imageCount: number;
  nodeCount: number;
  linkCount: number;
  uiSha256: string;
  apiSha256: string;
  workflowIdentity: string;
  validation: ValidationResult;
}

export interface R2ConnectionInput {
  name?: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey?: string;
  publicUrl?: string;
  cloudflareApiToken?: string;
}
export interface R2ConnectionStatus {
  configured: boolean;
  name: string;
  accountId: string;
  accessKeyId: string;
  publicUrl: string;
  secretConfigured: boolean;
  metricsTokenConfigured: boolean;
}
export interface R2Bucket {
  name: string;
  createdAt?: string | null;
}
export interface R2Object {
  key: string;
  name: string;
  size: number;
  etag: string;
  lastModified?: string | null;
  storageClass?: string;
}
export interface R2ListResult {
  folders: Array<{ prefix: string; name: string }>;
  objects: R2Object[];
  nextToken: string | null;
}
export interface R2SearchResult {
  objects: R2Object[];
  nextToken: string | null;
  scanned: number;
}
export interface R2DownloadInfo {
  key: string;
  url: string;
  public: boolean;
  expiresIn: number | null;
  fileName: string;
  commands: { url: string; curl: string; wget: string; aria2c: string };
}
export interface R2PutUrlInfo {
  key: string;
  url: string;
  expiresIn: number;
  contentType: string | null;
  commands: { url: string; curl: string };
}
export interface R2BatchDownloadTemplate {
  id: string;
  name: string;
  bucket: string;
  createdAt: string;
  updatedAt: string;
  objects: Array<{ key: string; name: string; size?: number }>;
}
export interface R2UploadSourceFingerprint {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
  sha256: string;
  partSha256: string[];
}
export interface R2UploadJob {
  id: string;
  sourceFingerprint?: R2UploadSourceFingerprint;
  hashProgressBytes?: number;
  kind?: 'upload' | 'move';
  startedAt?: string;
  initialTransferredBytes?: number;
  completedAt?: string;
  bucket: string;
  key: string;
  filePath: string;
  fileName: string;
  size: number;
  contentType: string;
  uploadId: string | null;
  partSize: number;
  completedParts: Record<string, string>;
  status: 'paused' | 'uploading' | 'complete' | 'failed' | 'cancelled';
  transferredBytes: number;
  error: string;
  createdAt: string;
}
export interface R2Metrics {
  configured: boolean;
  payload?: unknown;
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

export interface AssistantPaneContext extends AgentContext {
  provider: AgentProvider;
}

export interface AssistantPaneSnapshot {
  context: AssistantPaneContext | null;
  availability: AgentAvailability | null;
  capabilities: AgentCapabilities | null;
  sessionIds: string[];
  activeSessionId: string | null;
  messages: AgentConversationMessage[];
  modelSettings: AgentModelSettings | null;
  busy: boolean;
}
export type AutoArtifactPhase =
  | 'waiting'
  | 'detected'
  | 'validating'
  | 'imported'
  | 'duplicate'
  | 'invalid'
  | 'failed';
export interface AutoArtifactEvent {
  provider: AutoArtifactProvider;
  root: string;
  stage: GrokTask['stage'];
  fileName: string;
  phase: AutoArtifactPhase;
  sourceId: string;
  filePath?: string;
  rawResponsePath?: string;
  message?: string;
  issues?: ValidationIssue[];
  summary?: ImportResult['summary'];
}
export interface CodexMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}
export interface CodexContext {
  root: string;
  stage: GrokContextStage;
}
export type CodexTurnPhase =
  | 'idle'
  | 'sending'
  | 'processing'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'unknown';
export interface CodexTurnStatus {
  phase: CodexTurnPhase;
  startedAt: number | null;
  updatedAt: number | null;
  finishedAt: number | null;
  error: string | null;
}
export interface CodexModelSelection {
  model: string;
  effort: string;
}
export interface CodexModelOption {
  id: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
}
export interface CodexModelSettings {
  models: CodexModelOption[];
  selection: CodexModelSelection;
}
export interface CodexThreadState {
  activeThreadId: string | null;
  threadIds: string[];
}
export interface CodexSendResult extends CodexThreadState {
  status: CodexTurnStatus;
  artifact?: AutoArtifactEvent | null;
}
export interface CodexSnapshot extends CodexContext, CodexSendResult {
  messages: CodexMessage[];
  activity: import('./codex-activity.js').CodexActivityState;
  busy: boolean;
  historyUnavailable?: boolean;
}
export interface CodexEvent {
  method: string;
  params: Record<string, unknown>;
}
export interface CodexAccountStatus {
  authenticated: boolean;
  authMode: string | null;
  planType: string | null;
}
export interface GrokPaneState {
  visible: boolean;
  ratio: number;
}
export interface AssistantPaneState {
  visible: boolean;
  ratio: number;
}

export interface BatchStudioApi {
  editorSaves: {
    onFlushRequest: (listener: (id: string, root: string) => void) => () => void;
    flushResult: (id: string, ok: boolean, message?: string) => Promise<void>;
  };
  appSettings: {
    get: () => Promise<AppSettingsStatus>;
    selectComfyUiDirectory: () => Promise<string | null>;
    save: (settings: AppSettingsSaveInput) => Promise<AppSettingsStatus>;
  };
  project: {
    select: () => Promise<ProjectSummary | null>;
    last: () => Promise<ProjectSummary | null>;
    recent: () => Promise<ProjectSummary[]>;
    removeRecent: (root: string) => Promise<void>;
    open: (root: string) => Promise<ProjectSummary | null>;
    close: () => Promise<void>;
    selectParent: (defaultPath?: string) => Promise<string | null>;
    create: (parent: string, brief: ProjectBriefInput) => Promise<ProjectSummary>;
    onMenuCommand: (
      listener: (command: 'new' | 'open' | 'settings' | 'close', project?: ProjectSummary) => void,
    ) => () => void;
    scan: (root: string) => Promise<ProjectSummary>;
    openFolder: (root: string) => Promise<void>;
    saveSettings: (root: string, settings: ProjectSettings) => Promise<ProjectSummary>;
    saveBrief: (root: string, brief: ProjectBriefInput) => Promise<ProjectSummary>;
  };
  artifact: {
    read: (
      root: string,
      key: ArtifactKey,
      source: 'confirmed' | 'draft',
    ) => Promise<ArtifactReadResult>;
    beginEdit: (
      root: string,
      key: 'story' | 'models' | 'promptPlan',
    ) => Promise<ArtifactReadResult>;
    saveDraft: (
      root: string,
      key: 'story' | 'models' | 'promptPlan',
      content: string,
    ) => Promise<ArtifactReadResult>;
    importGrok: (
      root: string,
      key: 'story' | 'models' | 'promptPlan',
      raw: string,
      stage?: GrokLoraSelectionStage,
    ) => Promise<ImportResult>;
    confirm: (root: string, key: 'story' | 'models' | 'promptPlan') => Promise<ProjectSummary>;
    savePromptPlan: (root: string, plan: PromptPlanArtifact) => Promise<ArtifactReadResult>;
    grokLoraHistory: (root: string) => Promise<GrokLoraSelectionHistoryEntry[]>;
  };
  grokTask: {
    build: (root: string, stage: GrokTask['stage'], extra?: string) => Promise<GrokTask>;
  };
  autoArtifact: {
    armGrok: (root: string, stage: GrokTask['stage']) => Promise<AutoArtifactEvent | null>;
    onEvent: (listener: (event: AutoArtifactEvent) => void) => () => void;
  };
  file: { showInFolder: (filePath: string) => Promise<void> };
  catalog: {
    status: (root: string) => Promise<CatalogStatus>;
    integratedStatus: () => Promise<CivitaiCatalogStatus>;
    snapshot: () => Promise<ModelCatalog | null>;
    sync: () => Promise<CivitaiCatalogStatus>;
    linkProject: (root: string) => Promise<ProjectSummary>;
    templates: () => Promise<CatalogSelectionTemplate[]>;
    saveTemplate: (input: CatalogSelectionTemplateInput) => Promise<CatalogSelectionTemplate[]>;
    deleteTemplate: (id: string) => Promise<CatalogSelectionTemplate[]>;
    openModel: (url: string) => Promise<void>;
  };
  civitai: {
    settings: () => Promise<CivitaiConnectionStatus>;
    saveSettings: (input: CivitaiConnectionInput) => Promise<CivitaiConnectionStatus>;
  };
  vastai: {
    settings: () => Promise<VastAiConnectionStatus>;
    saveSettings: (input: VastAiConnectionInput) => Promise<VastAiConnectionStatus>;
    test: (input?: VastAiConnectionInput) => Promise<void>;
    selectPrivateKey: () => Promise<string | null>;
    selectPublicKey: () => Promise<string | null>;
    instances: () => Promise<VastAiInstance[]>;
    comfyUiTemplate: () => Promise<VastAiComfyUiTemplate>;
    searchOffers: (input: VastAiOfferSearchInput) => Promise<VastAiOfferSearchResult>;
    rentOffer: (input: VastAiRentRequest) => Promise<number | null>;
    startInstance: (id: number) => Promise<void>;
    stopInstance: (id: number) => Promise<void>;
    destroyInstance: (id: number) => Promise<boolean>;
    rebootInstance: (id: number) => Promise<void>;
    resolveSshEndpoint: (id: number) => Promise<VastAiSshEndpoint>;
  };
  workflow: { compile: (root: string) => Promise<CompileResult> };
  availability: {
    check: (root: string) => Promise<AvailabilityResult>;
    checkLoraFiles: (root: string, fileNames: string[]) => Promise<LoraFileAvailability[]>;
    openR2: (root: string) => Promise<void>;
  };
  preflight: { run: (root: string) => Promise<PreflightResult> };
  execution: {
    start: (root: string) => Promise<ExecutionRun>;
    status: (root: string) => Promise<ExecutionRun | null>;
    storageDiagnostics: (
      root: string,
    ) => Promise<Array<{ runId: string | null; file: string; backupFile: string; reason: string }>>;
    restoreBackup: (
      root: string,
      runId: string | null,
    ) => Promise<Array<{
      runId: string | null;
      file: string;
      backupFile: string;
      reason: string;
    }> | null>;
    reconcile: (root: string, runId: string) => Promise<ExecutionRun>;
    leave: (root: string) => Promise<boolean>;
    stopForEdit: (root: string, runId: string, interrupt: boolean) => Promise<ExecutionRun>;
    discardForEdit: (root: string, runId: string) => Promise<ExecutionRun | null>;
    get: (root: string, runId: string) => Promise<ExecutionRun | null>;
    stopScheduling: (root: string, runId: string) => Promise<ExecutionRun>;
    forceInterrupt: (root: string, runId: string) => Promise<ExecutionRun>;
    resume: (root: string, runId: string) => Promise<ExecutionRun>;
    restartRemote: (root: string, runId: string) => Promise<ExecutionRun>;
    restartFromScratch: (root: string, runId: string) => Promise<ExecutionRun>;
  };
  finalArtifact: {
    status: (root: string) => Promise<FinalArtifactStatus>;
    selectDirectory: (root: string) => Promise<FinalArtifactStatus>;
    listImages: (root: string) => Promise<FinalArtifactImageItem[]>;
    readImage: (root: string, imagePath: string) => Promise<FinalArtifactImageSource | null>;
    readPreview: (root: string, imagePath: string) => Promise<FinalArtifactImageSource | null>;
  };
  caption: {
    status: (root: string) => Promise<CaptionStatus>;
    selectSourceDirectory: (root: string) => Promise<CaptionStatus>;
    importGrok: (root: string, raw: string) => Promise<ImportResult>;
    generate: (root: string) => Promise<CaptionStatus>;
    savePixivTitle: (root: string, title: { ja: string; en: string }) => Promise<CaptionStatus>;
  };
  thumbnail: {
    fonts: () => Promise<string[]>;
    load: (root: string) => Promise<ThumbnailEditorState>;
    restoreBackup: (root: string) => Promise<ThumbnailEditorState | null>;
    initializeCorrupt: (root: string) => Promise<ThumbnailEditorState | null>;
    save: (root: string, state: ThumbnailEditorState) => Promise<ThumbnailEditorState>;
    selectImage: (root: string) => Promise<ThumbnailImageSource | null>;
    listImages: (root: string) => Promise<ThumbnailImageItem[]>;
    readImage: (imagePath: string) => Promise<ThumbnailImageSource | null>;
    readPreview: (imagePath: string) => Promise<ThumbnailImageSource | null>;
    readEditorImage: (imagePath: string) => Promise<ThumbnailImageSource | null>;
    storeWebpPreview: (imagePath: string, dataUrl: string) => Promise<void>;
    readTemplate: (pattern: ThumbnailPattern) => Promise<ThumbnailTemplateSource>;
    openPicker: (
      root: string,
      slot: ThumbnailSlotKey,
      currentImagePath: string,
    ) => Promise<ThumbnailPickerSession>;
    pickerContext: () => Promise<ThumbnailPickerContext>;
    logPickerPerf: (
      event: string,
      metrics: Record<string, number | string | boolean>,
    ) => Promise<void>;
    openPickerPerfLog: () => Promise<void>;
    previewPicker: (imagePath: string) => Promise<void>;
    previewResult: (
      sessionId: string,
      imagePath: string,
      generation: number,
      ok: boolean,
      message?: string,
    ) => Promise<boolean>;
    commitPicker: (imagePath: string) => Promise<void>;
    commitResult: (
      sessionId: string,
      imagePath: string,
      ok: boolean,
      message?: string,
    ) => Promise<boolean>;
    onPickerPreview: (listener: (selection: ThumbnailPickerSelection) => void) => () => void;
    onPickerCommit: (listener: (selection: ThumbnailPickerSelection) => void) => () => void;
    onPickerCancel: (listener: (session: ThumbnailPickerSession) => void) => () => void;
    deleteOutputs: (root: string, documentId: number) => Promise<void>;
    exportImage: (
      root: string,
      documentId: number,
      format: 'png' | 'jpeg',
      dataUrl: string,
    ) => Promise<ThumbnailExportResult>;
  };
  marketplace: {
    targets: () => Promise<MarketplaceImageTarget[]>;
    listThumbnailImages: (root: string) => Promise<FinalArtifactImageItem[]>;
    readSource: (
      root: string,
      imagePath: string,
      sourceType: MarketplaceSourceType,
    ) => Promise<FinalArtifactImageSource | null>;
    readSourcePreview: (
      root: string,
      imagePath: string,
      sourceType: MarketplaceSourceType,
    ) => Promise<FinalArtifactImageSource | null>;
    load: (root: string) => Promise<MarketplaceImageEditorState>;
    restoreBackup: (root: string) => Promise<MarketplaceImageEditorState | null>;
    initializeCorrupt: (root: string) => Promise<MarketplaceImageEditorState | null>;
    save: (
      root: string,
      state: MarketplaceImageEditorState,
    ) => Promise<MarketplaceImageEditorState>;
    generate: (
      root: string,
      state: MarketplaceImageEditorState,
      webpDataUrls?: Record<string, string>,
      sourcePngDataUrl?: string,
    ) => Promise<MarketplaceGenerationResult>;
    generateZip: (
      root: string,
      format: MarketplaceOutputFormat,
      state?: MarketplaceImageEditorState,
    ) => Promise<MarketplaceGenerationResult>;
    exportCustom: (
      root: string,
      state: MarketplaceImageEditorState,
      webpDataUrl?: string,
      sourcePngDataUrl?: string,
    ) => Promise<MarketplaceGenerationResult>;
    renderPng: (
      root: string,
      sourceImagePath: string,
      crop: MarketplaceCropRect,
      width: number,
      height: number,
      sourcePngDataUrl?: string,
      sourceType?: MarketplaceSourceType,
    ) => Promise<string>;
    openPicker: (
      root: string,
      currentImagePath: string,
      sourceType: MarketplaceSourceType,
    ) => Promise<MarketplacePickerSession>;
    pickerContext: () => Promise<MarketplacePickerContext>;
    previewPicker: (imagePath: string) => Promise<void>;
    previewResult: (
      sessionId: string,
      imagePath: string,
      generation: number,
      ok: boolean,
      message?: string,
    ) => Promise<boolean>;
    commitPicker: (imagePath: string) => Promise<void>;
    commitResult: (
      sessionId: string,
      imagePath: string,
      ok: boolean,
      message?: string,
    ) => Promise<boolean>;
    onPickerPreview: (listener: (selection: MarketplacePickerSelection) => void) => () => void;
    onPickerCommit: (listener: (selection: MarketplacePickerSelection) => void) => () => void;
    onPickerCancel: (listener: (session: MarketplacePickerSession) => void) => () => void;
  };
  clipboard: { writeText: (text: string) => Promise<void> };
  r2: {
    settings: () => Promise<R2ConnectionStatus>;
    environment: () => Promise<R2ConnectionInput>;
    test: (input: R2ConnectionInput) => Promise<void>;
    saveSettings: (input: R2ConnectionInput) => Promise<R2ConnectionStatus>;
    buckets: () => Promise<R2Bucket[]>;
    createBucket: (name: string) => Promise<void>;
    deleteBucket: (name: string) => Promise<void>;
    list: (bucket: string, prefix: string, token?: string | null) => Promise<R2ListResult>;
    search: (bucket: string, query: string, token?: string | null) => Promise<R2SearchResult>;
    downloadInfo: (bucket: string, key: string, expiresIn?: number) => Promise<R2DownloadInfo>;
    batchDownloadInfo: (
      bucket: string,
      keys: string[],
      expiresIn?: number,
    ) => Promise<R2DownloadInfo[]>;
    putUrlInfo: (
      bucket: string,
      key: string,
      expiresIn?: number,
      contentType?: string,
    ) => Promise<R2PutUrlInfo>;
    deleteObjects: (
      bucket: string,
      keys: string[],
    ) => Promise<{ deleted: string[]; errors: unknown[] }>;
    move: (
      bucket: string,
      sourceKey: string,
      destinationKey: string,
      overwrite?: boolean,
    ) => Promise<void>;
    selectUploadFiles: () => Promise<string[]>;
    beginUpload: (
      bucket: string,
      prefix: string,
      filePath: string,
      overwrite?: boolean,
    ) => Promise<R2UploadJob>;
    uploads: () => Promise<R2UploadJob[]>;
    resumeUpload: (id: string) => Promise<R2UploadJob>;
    pauseUpload: (id: string) => Promise<R2UploadJob>;
    cancelUpload: (id: string) => Promise<void>;
    templates: (bucket?: string) => Promise<R2BatchDownloadTemplate[]>;
    saveTemplate: (input: {
      id?: string;
      name: string;
      bucket: string;
      objects: Array<{ key: string; name: string; size?: number }>;
    }) => Promise<R2BatchDownloadTemplate[]>;
    deleteTemplate: (id: string) => Promise<R2BatchDownloadTemplate[]>;
    metrics: () => Promise<R2Metrics>;
  };
  assistant: {
    getProvider: (stage: GrokContextStage) => Promise<AssistantPaneProvider>;
    setProvider: (
      provider: AssistantPaneProvider,
      stage: GrokContextStage,
    ) => Promise<GrokPaneState>;
    setContext: (root: string, stage: GrokContextStage) => Promise<void>;
    context: () => Promise<AssistantPaneContext | null>;
    snapshot: () => Promise<AssistantPaneSnapshot>;
    send: (text: string) => Promise<AgentTurn>;
    stopTurn: () => Promise<void>;
    newConversation: () => Promise<AssistantPaneSnapshot>;
    restoreConversation: (sessionId: string) => Promise<AssistantPaneSnapshot>;
    models: () => Promise<AgentModelSettings>;
    selectModel: (selection: AgentModelSelection) => Promise<AgentModelSelection>;
    setVisible: (visible: boolean) => Promise<AssistantPaneState>;
    setRatio: (ratio: number) => Promise<AssistantPaneState>;
    setDividerScreenX: (screenX: number) => Promise<AssistantPaneState>;
    startTask: (root: string, stage: GrokTask['stage'], extra?: string) => Promise<void>;
    stopTask: (root: string, stage: GrokTask['stage']) => Promise<void>;
    onContext: (listener: (context: AssistantPaneContext | null) => void) => () => void;
    onEvent: (listener: (event: AgentEventEnvelope) => void) => () => void;
  };
  codex: {
    getProvider: (stage: GrokContextStage) => Promise<AssistantPaneProvider>;
    setProvider: (
      provider: AssistantPaneProvider,
      stage: GrokContextStage,
    ) => Promise<GrokPaneState>;
    setContext: (root: string, stage: GrokContextStage) => Promise<void>;
    selectStageTask: (root: string, stage: GrokTask['stage']) => Promise<void>;
    onStageTaskSelected: (listener: (stage: GrokTask['stage']) => void) => () => void;
    context: () => Promise<CodexContext | null>;
    onContext: (listener: (context: CodexContext | null) => void) => () => void;
    status: () => Promise<CodexAccountStatus>;
    signIn: () => Promise<void>;
    snapshot: () => Promise<CodexSnapshot>;
    models: () => Promise<CodexModelSettings>;
    selectModel: (selection: CodexModelSelection) => Promise<CodexModelSelection>;
    newChat: () => Promise<CodexSnapshot>;
    restoreChat: (threadId: string) => Promise<CodexSnapshot>;
    stopTurn: () => Promise<CodexSnapshot>;
    send: (text: string) => Promise<CodexSendResult>;
    sendTask: (stage: GrokTask['stage'], extra?: string) => Promise<CodexSendResult>;
    onEvent: (listener: (event: CodexEvent) => void) => () => void;
    saveResponse: (text: string) => Promise<string | null>;
    retryArtifact: () => Promise<AutoArtifactEvent | null>;
    latestArtifact: () => Promise<AutoArtifactEvent | null>;
  };
  grok: {
    setVisible: (visible: boolean) => Promise<GrokPaneState>;
    setContext: (root: string, stage: GrokContextStage) => Promise<GrokPaneState>;
    setRatio: (ratio: number) => Promise<GrokPaneState>;
    setDividerScreenX: (screenX: number) => Promise<GrokPaneState>;
    reload: () => Promise<void>;
    openExternal: () => Promise<void>;
  };
}
