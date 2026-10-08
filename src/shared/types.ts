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

export type { ArtifactReadResult } from '../domain/artifact-types.js';
import type { ArtifactReadResult } from '../domain/artifact-types.js';

export type { ImportResult } from '../domain/artifact-types.js';

import type { ImportResult } from '../domain/artifact-types.js';

export type GrokLoraSelectionStage = 'models' | 'models-fix';
export type { GrokLoraSelectionHistoryEntry } from '../domain/resource-observation-types.js';
import type { GrokLoraSelectionHistoryEntry } from '../domain/resource-observation-types.js';
export type { LoraFileAvailability } from '../domain/resource-observation-types.js';
import type { LoraFileAvailability } from '../domain/resource-observation-types.js';

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
import type {
  VastAiComfyUiTemplate,
  VastAiOfferSearchInput,
  VastAiOffer,
  VastAiOfferSearchResult,
  VastAiRentRequest,
} from '../domain/integration-types.js';
export type {
  VastAiComfyUiTemplate,
  VastAiOfferSearchInput,
  VastAiOffer,
  VastAiOfferSearchResult,
  VastAiRentRequest,
} from '../domain/integration-types.js';

import type { VastAiSshEndpoint } from '../domain/integration-types.js';
export type { VastAiSshEndpoint } from '../domain/integration-types.js';

import type {
  CatalogSelectionEntry,
  CatalogSelectionTemplate,
  CatalogSelectionTemplateInput,
} from '../domain/integration-types.js';
export type {
  CatalogSelectionEntry,
  CatalogSelectionTemplate,
  CatalogSelectionTemplateInput,
} from '../domain/integration-types.js';

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

export type { GrokTask } from '../domain/agent-runtime-types.js';
import type { GrokTask } from '../domain/agent-runtime-types.js';

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
export type { R2Object } from '../domain/resource-observation-types.js';
import type { R2Object } from '../domain/resource-observation-types.js';
export interface R2ListResult {
  folders: Array<{ prefix: string; name: string }>;
  objects: R2Object[];
  nextToken: string | null;
}
export type { R2SearchResult } from '../domain/resource-observation-types.js';
import type { R2SearchResult } from '../domain/resource-observation-types.js';
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
import type {
  R2BatchDownloadTemplate,
  R2UploadSourceFingerprint,
  R2UploadJob,
} from '../domain/integration-types.js';
export type {
  R2BatchDownloadTemplate,
  R2UploadSourceFingerprint,
  R2UploadJob,
} from '../domain/integration-types.js';

export interface R2Metrics {
  configured: boolean;
  payload?: unknown;
}
export type {
  GrokContextStage,
  AgentProvider,
  AssistantPaneProvider,
  AutoArtifactProvider,
  AgentContext,
  AgentCapabilities,
  AgentAvailability,
  AgentModelOption,
  AgentModelSelection,
  AgentModelSettings,
  AgentWorkspaceDescriptor,
  AgentConversationWorkspaceDescriptor,
  AgentTaskWorkspaceDescriptor,
  AgentTaskRequest,
  AgentTurn,
  AgentEvent,
  AgentEventEnvelope,
  AgentConversationMessage,
} from '../domain/agent-runtime-types.js';
import type {
  GrokContextStage,
  AgentProvider,
  AssistantPaneProvider,
  AutoArtifactProvider,
  AgentContext,
  AgentCapabilities,
  AgentAvailability,
  AgentModelOption,
  AgentModelSelection,
  AgentModelSettings,
  AgentWorkspaceDescriptor,
  AgentConversationWorkspaceDescriptor,
  AgentTaskWorkspaceDescriptor,
  AgentTaskRequest,
  AgentTurn,
  AgentEvent,
  AgentEventEnvelope,
  AgentConversationMessage,
} from '../domain/agent-runtime-types.js';
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
export type { AutoArtifactEvent, AutoArtifactPhase } from '../domain/auto-artifact-types.js';
import type { AutoArtifactEvent } from '../domain/auto-artifact-types.js';
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
    deleteDocument: (
      root: string,
      id: number,
      expectedRevision: number,
      deleteOutputs: boolean,
    ) => Promise<{ state: ThumbnailEditorState; cleanupWarning?: string }>;
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
