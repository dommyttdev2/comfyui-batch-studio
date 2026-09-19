export type Severity = 'error' | 'warning' | 'info';
export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
  location?: string;
}
export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}
export type ArtifactKey =
  | 'projectBrief'
  | 'story'
  | 'models'
  | 'promptPlan'
  | 'workflow'
  | 'legacyPromptTree';
export type ArtifactState =
  | 'missing'
  | 'draft'
  | 'invalid'
  | 'warning'
  | 'confirmed'
  | 'stale'
  | 'generated'
  | 'legacy';
export interface ArtifactSummary {
  key: ArtifactKey;
  label: string;
  relativePath: string | null;
  state: ArtifactState;
  validation?: ValidationResult;
}
export type ModelFamily = 'illustrious' | 'anima';
export type ModelSelectionRole = 'checkpoint' | 'text_encoder' | 'clip' | 'lora';
export type ModelFileRole = 'text_encoder' | 'vae';
export interface ProjectBriefInput {
  project: { id: string; title: string };
  subject: { copyrightedCharacter: boolean; characterName: string; series: string };
  audience: string;
  request: string;
  exclusions: string;
  assumptions: { adultCharacters: false | boolean; consensual: false | boolean };
  generation: {
    target_image_count: number;
    modelFamily?: ModelFamily | 'Illustrious';
    targetChapterCount?: number;
  };
  references?: string[];
}
export type ExecutionTarget = 'local' | 'remote';
export type CloudInstanceProviderId = 'vastai';
export interface RemoteCustomNodeRepository {
  repository: string;
  ref?: string;
}
export interface AppSettings {
  comfyUiInstallPath: string;
  assistantProvider?: 'grok' | 'codex';
  remoteComfyUiInstallPath?: string;
  comfyUiApiEndpoint?: string;
  projectRoot?: string;
  artifactRoot?: string;
  remoteCustomNodes?: RemoteCustomNodeRepository[];
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
export interface ProjectSettings {
  catalogPath?: string;
  comfyModelsRoot?: string;
  executionTarget?: ExecutionTarget;
  remoteProvider?: CloudInstanceProviderId;
  remoteInstanceId?: number;
  artifactOutputPath?: string;
  finalArtifactDirectory?: string;
  /** @deprecated Read-only compatibility for projects created before the Final Artifact stage. */
  captionSourceDirectory?: string;
  r2IndexPath?: string;
  templatePath?: string;
  manifestPath?: string;
  r2FileManagerUrl?: string;
  r2Bucket?: string;
  r2ModelPrefix?: string;
}
export interface ProjectMeta {
  schemaVersion: 1;
  createdAt: string;
  updatedAt?: string;
  settings: ProjectSettings;
  workflowBuild?: Record<string, unknown>;
}
export interface ProjectSummary {
  rootPath: string;
  title: string;
  id: string | null;
  targetImageCount: number | null;
  artifacts: ArtifactSummary[];
  meta: ProjectMeta | null;
}
export interface ArtifactReadResult {
  key: ArtifactKey;
  source: 'confirmed' | 'draft';
  content: string | null;
  exists: boolean;
  validation: ValidationResult;
}
export interface MissingRequirement {
  role: string;
  requirement: string;
  reason: string;
}
export interface ImportResult {
  extracted: string;
  validation: ValidationResult;
  summary: Record<string, string | number | boolean | null>;
  missingRequirements: MissingRequirement[];
}
export interface StrengthBaseline {
  value: number;
  provenance: {
    source: 'civitai';
    basis: 'creator-declared' | 'observed-usage-derived';
    method?: string;
    sampleCount?: number;
  };
}
export interface ModelSelectionBase {
  ref: string;
  modelId: number;
  modelName: string;
  versionId: number;
  versionName: string;
  fileId: number;
  fileName: string;
  modelUrl: string;
  trainedWords: string[];
  reason: string;
}
export interface CheckpointSelection extends ModelSelectionBase {
  ref: 'checkpoint.main';
}
export interface DiffusionModelSelection extends ModelSelectionBase {
  ref: 'diffusion_model.main';
}
export interface CatalogTextEncoderSelection extends ModelSelectionBase {
  ref: 'text_encoder.main';
}
export interface CatalogClipSelection extends ModelSelectionBase {
  ref: 'clip.main';
}
export interface ModelFileSelectionBase {
  ref: string;
  fileName: string;
  reason: string;
}
export interface TextEncoderSelection extends ModelFileSelectionBase {
  ref: 'text_encoder.main';
}
export interface ClipSelection extends ModelFileSelectionBase {
  ref: 'clip.main';
}
export interface VaeSelection extends ModelFileSelectionBase {
  ref: 'vae.main';
}
export interface LoraSelection extends ModelSelectionBase {
  ref: string;
  strengthBaseline?: StrengthBaseline;
}
export interface ModelsArtifact {
  schemaVersion: 1 | 2 | 3 | 4 | 5;
  modelFamily?: ModelFamily;
  catalog: { schemaVersion: number; generation: number; generatedAt: string };
  checkpoint?: CheckpointSelection;
  diffusionModel?: DiffusionModelSelection;
  textEncoder?: CatalogTextEncoderSelection | TextEncoderSelection;
  clip?: CatalogClipSelection | ClipSelection;
  vae?: VaeSelection;
  loras: LoraSelection[];
}
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
export interface ModelFileCandidate {
  fileName: string;
  local: boolean;
  r2: boolean;
  localPath?: string;
  r2Key?: string;
  localSize?: number;
  r2Size?: number;
}
export interface LoraUsage {
  modelRef: string;
  strengthModel: number;
  strengthClip: number;
}
export interface PromptLeafV1 {
  id: string;
  name: string;
  positive: string;
  negative: string;
}
export interface PromptBranchV1 {
  id: string;
  label: string;
  loras: LoraUsage[];
  leaves: PromptLeafV1[];
}
export interface PromptPlanArtifactV1 {
  schemaVersion: 1;
  common: { positive: string; negative: string };
  rootLoras: LoraUsage[];
  branches: PromptBranchV1[];
}
export interface CameraPromptGroups {
  pov?: string[];
  angle?: string[];
  framing?: string[];
  gaze?: string[];
  focus?: string[];
}
export interface PositivePromptGroups {
  subject?: string[];
  identity?: string[];
  appearance?: string[];
  style?: string[];
  outfit?: string[];
  expression?: string[];
  action?: string[];
  pose?: string[];
  camera?: CameraPromptGroups;
  environment?: string[];
  lighting?: string[];
  effects?: string[];
}
export interface NegativePromptGroups {
  anatomy?: string[];
  identity?: string[];
  appearance?: string[];
  subject?: string[];
  outfit?: string[];
  action?: string[];
  camera?: string[];
  environment?: string[];
  artifacts?: string[];
  content?: string[];
}
export interface TriggerWordSelection {
  modelRef: string;
  words: string[];
}
export interface StructuredPrompt {
  positive: PositivePromptGroups;
  negative: NegativePromptGroups;
  /** Explicit trigger selections for this prompt scope; no implicit injection in selected mode. */
  triggerWords?: TriggerWordSelection[];
}
export interface PromptLeafV2 {
  id: string;
  name: string;
  prompt: StructuredPrompt;
}
export interface PromptBranchV2 {
  id: string;
  label: string;
  loras: LoraUsage[];
  prompt?: StructuredPrompt;
  leaves: PromptLeafV2[];
}
export interface PromptPlanArtifactV2 {
  schemaVersion: 2;
  /** Missing on legacy v2 plans, which retain their original automatic-trigger behavior. */
  triggerWordsMode?: 'selected';
  common: StructuredPrompt;
  rootLoras: LoraUsage[];
  branches: PromptBranchV2[];
}
export type PromptLeaf = PromptLeafV1 | PromptLeafV2;
export type PromptBranch = PromptBranchV1 | PromptBranchV2;
export type PromptPlanArtifact = PromptPlanArtifactV1 | PromptPlanArtifactV2;
export interface CatalogFile {
  id: number;
  name: string;
  primary?: boolean;
  sizeKB?: number;
  type?: string;
  format?: string;
  precision?: string;
}
export interface CatalogVersion {
  versionId: number;
  versionName: string;
  baseModel?: string;
  files: CatalogFile[];
  trainedWords?: string[];
  strengthBaseline?: StrengthBaseline;
  modelUrl?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
}
export interface CatalogItem {
  modelId: number;
  modelName: string;
  modelType?: string;
  versionId: number;
  versionName: string;
  baseModel?: string;
  files: CatalogFile[];
  trainedWords?: string[];
  versions?: CatalogVersion[];
  strengthBaseline?: StrengthBaseline;
  modelUrl?: string;
  thumbnailUrl?: string;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  error?: string;
}
export interface CatalogCollection {
  id: number;
  name: string;
  description?: string;
  read?: string;
  type?: string;
  imageId?: number;
  thumbnailUrl?: string;
  items: CatalogItem[];
}
export interface ModelCatalog {
  schemaVersion: number;
  generation: number;
  generatedAt: string;
  collections: CatalogCollection[];
}
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
export type CloudInstanceStatus =
  | 'running'
  | 'stopped'
  | 'starting'
  | 'scheduling'
  | 'stopping'
  | 'offline'
  | 'error'
  | 'unknown';
export interface VastAiInstance {
  provider: 'vastai';
  id: number;
  label: string | null;
  status: CloudInstanceStatus;
  rawStatus: string;
  intendedStatus: string | null;
  curState: string | null;
  nextState: string | null;
  statusMessage: string | null;
  gpuName: string | null;
  gpuCount: number | null;
  gpuRamMb: number | null;
  hourlyCost: number | null;
  sshHost: string | null;
  sshPort: number | null;
  comfyUiPort: number | null;
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
export interface ExecutionRemoteInstanceSnapshot {
  provider: 'vastai';
  instanceId: number;
  status: CloudInstanceStatus;
  rawStatus: string;
  intendedStatus: string | null;
  curState: string | null;
  nextState: string | null;
  statusMessage: string | null;
  sshHost: string | null;
  sshPort: number | null;
  comfyUiPort: number | null;
  resolvedAt: string;
}
export interface ExecutionRemoteLifecycleState {
  initialStatus: CloudInstanceStatus | null;
  startedByBatchStudio: boolean;
  startRequestedAt?: string | null;
  latest: ExecutionRemoteInstanceSnapshot | null;
  restorePolicy: 'restore-if-started';
  restoredInitialState: boolean;
  finalizedAt: string | null;
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
export type ThumbnailPattern =
  | '3-images'
  | '4-images-left-split'
  | '4-images-right-split'
  | '5-images-both-split';

export type ThumbnailSlotKey =
  | 'LEFT'
  | 'LEFT_TOP'
  | 'LEFT_BOTTOM'
  | 'CENTER_MAIN'
  | 'RIGHT'
  | 'RIGHT_TOP'
  | 'RIGHT_BOTTOM';

export interface ThumbnailSlotState {
  imagePath: string;
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface ThumbnailTextState {
  text: string;
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
}

export interface ThumbnailDocument {
  id: number;
  pattern: ThumbnailPattern;
  slots: Partial<Record<ThumbnailSlotKey, ThumbnailSlotState>>;
  title: ThumbnailTextState;
  subtitle: ThumbnailTextState;
}

export interface ThumbnailEditorState {
  schemaVersion: 1;
  activeDocumentId: number;
  documents: ThumbnailDocument[];
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
export type ThumbnailImageSource = FinalArtifactImageSource;

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
}

export interface ThumbnailTemplateSource {
  name: string;
  dataUrl: string;
}

export interface ThumbnailExportResult {
  path: string;
}

export type MarketplaceOutputFormat = 'jpeg' | 'png' | 'webp';
export type MarketplaceEditorMode = 'marketplace' | 'custom';

export interface MarketplaceImageTarget {
  id: string;
  service: string;
  imageType: string;
  label: string;
  width: number;
  height: number;
  fileName: string;
}

export interface MarketplaceCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MarketplaceTargetState {
  crop: MarketplaceCropRect | null;
}

export interface MarketplaceCustomState {
  width: number;
  height: number;
  lockAspect: boolean;
  crop: MarketplaceCropRect | null;
}

export interface MarketplaceImageEditorState {
  schemaVersion: 1;
  sourceImagePath: string;
  mode: MarketplaceEditorMode;
  activeTargetId: string;
  format: MarketplaceOutputFormat;
  targets: Record<string, MarketplaceTargetState>;
  custom: MarketplaceCustomState;
}

export interface MarketplaceGenerationResult {
  outputDirectory: string;
  outputPaths: string[];
  zipPath: string | null;
}

export interface MarketplacePickerSession {
  sessionId: string;
}

export interface MarketplacePickerContext extends MarketplacePickerSession {
  root: string;
  currentImagePath: string;
}

export interface MarketplacePickerSelection extends MarketplacePickerSession {
  imagePath: string;
}

export interface FinalArtifactStatus {
  state: 'unconfigured' | 'source-missing' | 'empty' | 'ready';
  directory: string | null;
  exists: boolean;
  imageCount: number;
  imageExtensions: string[];
}

export interface CaptionContent {
  schemaVersion: 1;
  title: { ja: string; en: string };
  description: { ja: string[]; en: string[] };
  contents?: { ja: string[]; en: string[] };
}
export interface CaptionBuildInfo {
  schemaVersion: 1;
  sourceDirectory: string;
  imageCount: number;
  contentSha256: string;
  generatedAt: string;
}
export interface CaptionStatus {
  state:
    | 'unconfigured'
    | 'source-missing'
    | 'missing-content'
    | 'invalid-content'
    | 'ready'
    | 'generated'
    | 'stale';
  sourceDirectory: string | null;
  sourceExists: boolean;
  imageCount: number;
  imageExtensions: string[];
  content: CaptionContent | null;
  contentValidation: ValidationResult;
  captionPath: string;
  captionExists: boolean;
  stale: boolean;
  build: CaptionBuildInfo | null;
  preview: string | null;
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
    | 'caption';
  title: string;
  prompt: string;
  attachments: Array<{ name: string; path: string; purpose: string; exists: boolean }>;
}
export interface WorkflowManifest {
  schemaVersion: 1;
  manifestVersion: string;
  template: { id: string; version: string; sha256: string };
  common: { roles: Record<string, { nodeId: number }> };
  branchPrototype: {
    nodeIds: number[];
    groupIds: number[];
    roles: Record<string, { nodeId: number }>;
    boundaries: Array<{
      id: string;
      source: { role: string; slot: number };
      target: { role: string; slot: number };
    }>;
    layout: { offset: { x: number; y: number } };
  };
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
export interface ModelAvailabilityRow {
  ref: string;
  fileName: string;
  kind: 'checkpoint' | 'diffusion_model' | 'text_encoder' | 'clip' | 'vae' | 'lora';
  local: boolean;
  r2: boolean;
  state: 'available' | 'transfer-required' | 'missing';
  localPath?: string;
}
export interface AvailabilityResult {
  rows: ModelAvailabilityRow[];
  validation: ValidationResult;
  executionTarget: ExecutionTarget;
  localModelsRoot: string | null;
}
export interface PreflightResult {
  state: 'READY' | 'BLOCKED';
  plannedImages: number;
  targetImages: number | null;
  blocking: ValidationIssue[];
  warnings: ValidationIssue[];
  sections: Array<{ name: string; valid: boolean; issues: ValidationIssue[] }>;
}
export type ExecutionRunLifecycle =
  | 'RUNNING'
  | 'PAUSED'
  | 'INTERRUPTED'
  | 'FAILED'
  | 'COMPLETED'
  | 'DISCARDED';
export type ExecutionPhase =
  | 'LOCAL_COMFYUI_CONNECTING'
  | 'LOCAL_CAPABILITY_CHECKING'
  | 'CLOUD_INSTANCE_RESOLVING'
  | 'CLOUD_INSTANCE_STARTING'
  | 'CLOUD_INSTANCE_READY'
  | 'SSH_CONNECTING'
  | 'SSH_CONNECTED'
  | 'REMOTE_WORKER_PREPARING'
  | 'REMOTE_ENVIRONMENT_CHECKING'
  | 'REMOTE_DEPENDENCIES_INSTALLING'
  | 'REMOTE_GITHUB_AUTHENTICATING'
  | 'REMOTE_COMFYUI_UPDATING'
  | 'REMOTE_COMFYUI_RELEASE_CHECKING'
  | 'REMOTE_COMFYUI_RELEASE_FETCHING'
  | 'REMOTE_COMFYUI_CHECKING_OUT'
  | 'REMOTE_COMFYUI_REQUIREMENTS_INSTALLING'
  | 'REMOTE_COMFYUI_MANAGER_CONFIGURING'
  | 'REMOTE_CUSTOM_NODES_SYNCING'
  | 'REMOTE_COMFYUI_RESTARTING'
  | 'REMOTE_ENVIRONMENT_READY'
  | 'REMOTE_MODELS_CHECKING'
  | 'REMOTE_MODELS_DOWNLOADING'
  | 'REMOTE_MODELS_READY'
  | 'WORKFLOW_PREPARING'
  | 'EXECUTING'
  | 'EXECUTION_COMPLETED'
  | 'ARTIFACTS_COLLECTING'
  | 'ARTIFACTS_PACKAGING'
  | 'R2_UPLOAD_URL_ISSUED'
  | 'R2_UPLOADING'
  | 'R2_UPLOADED'
  | 'LOCAL_DOWNLOADING'
  | 'LOCAL_VERIFYING'
  | 'LOCAL_OUTPUT_VERIFYING'
  | 'REMOTE_CLEANUP'
  | 'CLOUD_INSTANCE_FINALIZING'
  | 'COMPLETED';
export type ExecutionEvidenceKind =
  | 'MODEL_VERIFIED'
  | 'MODELS_VERIFIED'
  | 'EXECUTION_COMPLETED'
  | 'PACKAGE_VERIFIED'
  | 'R2_OBJECT_VERIFIED'
  | 'LOCAL_FILE_VERIFIED'
  | 'CLEANUP_COMPLETED'
  | 'CUSTOM';
export interface ExecutionProgressCounter {
  completed: number;
  total: number;
}
export interface ExecutionGenerationTiming {
  currentPromptId: string | null;
  currentStartedAt: string | null;
  recentDurationsMs: number[];
}
export interface ExecutionBranchProgress {
  branchId: string;
  completed: number;
  total: number;
  state: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
}
export interface ExecutionModelProgress {
  ref: string;
  fileName: string;
  kind: ModelAvailabilityRow['kind'];
  objectKey: string;
  destination: string;
  state: 'pending' | 'checking' | 'downloading' | 'ready' | 'failed' | 'skipped';
  transferredBytes: number;
  totalBytes: number;
  reused: boolean;
  sha256: string | null;
  error: string | null;
}
export interface ExecutionError {
  code: string;
  message: string;
  phase: ExecutionPhase;
  at: string;
  retryable: boolean;
}
export interface ExecutionEvidence {
  id: string;
  kind: ExecutionEvidenceKind;
  scope: string;
  runIdentity: string;
  fingerprint: string;
  recordedAt: string;
  data: Record<string, string | number | boolean | null>;
}
export interface ExecutionRunSnapshot {
  projectId: string;
  target: ExecutionTarget;
  remote: { provider: CloudInstanceProviderId | null; instanceId: number | null } | null;
  preflight: PreflightResult;
  workflow: {
    uiPath: string;
    apiPath: string;
    uiSha256: string;
    apiSha256: string;
    workflowIdentity: string;
  };
  plan: { sha256: string; branches: Array<{ branchId: string; leafIds: string[] }> };
  runIdentity: string;
}
export interface ExecutionRun {
  schemaVersion: 1;
  runId: string;
  projectId: string;
  executionTarget: ExecutionTarget;
  remote: { provider: CloudInstanceProviderId | null; instanceId: number | null } | null;
  remoteLifecycle: ExecutionRemoteLifecycleState | null;
  lifecycle: ExecutionRunLifecycle;
  phase: ExecutionPhase;
  controls: {
    scheduling: 'ACTIVE' | 'STOP_REQUESTED' | 'STOPPED';
    interrupt: 'IDLE' | 'FORCE_REQUESTED' | 'INTERRUPTED';
    stopSchedulingRequestedAt: string | null;
    forceInterruptRequestedAt: string | null;
  };
  current: { branchId: string | null; leafId: string | null; promptId: string | null };
  progress: {
    overall: ExecutionProgressCounter;
    branches: ExecutionBranchProgress[];
    models: ExecutionModelProgress[];
    generationTiming?: ExecutionGenerationTiming;
  };
  promptIds: string[];
  evidence: ExecutionEvidence[];
  error: ExecutionError | null;
  errorHistory: ExecutionError[];
  snapshot: ExecutionRunSnapshot;
  resume: {
    attempts: number;
    lastAttemptAt: string | null;
    lastValidatedEvidenceIds: string[];
    lastIgnoredEvidenceIds: string[];
    lastDecisionPhase: ExecutionPhase | null;
  };
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
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
export interface R2UploadJob {
  id: string;
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
export type AssistantPaneProvider = 'grok' | 'codex';
export interface CodexMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
}
export interface CodexContext {
  root: string;
  stage: GrokContextStage;
}
export interface CodexSnapshot extends CodexContext {
  activeThreadId: string | null;
  threadIds: string[];
  messages: CodexMessage[];
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
export interface BatchStudioApi {
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
  };
  thumbnail: {
    fonts: () => Promise<string[]>;
    load: (root: string) => Promise<ThumbnailEditorState>;
    save: (root: string, state: ThumbnailEditorState) => Promise<ThumbnailEditorState>;
    selectImage: (root: string) => Promise<ThumbnailImageSource | null>;
    listImages: (root: string) => Promise<ThumbnailImageItem[]>;
    readImage: (imagePath: string) => Promise<ThumbnailImageSource | null>;
    readPreview: (imagePath: string) => Promise<ThumbnailImageSource | null>;
    readTemplate: (pattern: ThumbnailPattern) => Promise<ThumbnailTemplateSource>;
    openPicker: (
      root: string,
      slot: ThumbnailSlotKey,
      currentImagePath: string,
    ) => Promise<ThumbnailPickerSession>;
    pickerContext: () => Promise<ThumbnailPickerContext>;
    previewPicker: (imagePath: string) => Promise<void>;
    commitPicker: (imagePath: string) => Promise<void>;
    onPickerPreview: (listener: (selection: ThumbnailPickerSelection) => void) => () => void;
    onPickerCommit: (listener: (selection: ThumbnailPickerSelection) => void) => () => void;
    onPickerCancel: (listener: (session: ThumbnailPickerSession) => void) => () => void;
    exportImage: (
      root: string,
      documentId: number,
      format: 'png' | 'jpeg',
      dataUrl: string,
    ) => Promise<ThumbnailExportResult>;
  };
  marketplace: {
    targets: () => Promise<MarketplaceImageTarget[]>;
    load: (root: string) => Promise<MarketplaceImageEditorState>;
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
    ) => Promise<string>;
    openPicker: (root: string, currentImagePath: string) => Promise<MarketplacePickerSession>;
    pickerContext: () => Promise<MarketplacePickerContext>;
    previewPicker: (imagePath: string) => Promise<void>;
    commitPicker: (imagePath: string) => Promise<void>;
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
  codex: {
    getProvider: () => Promise<AssistantPaneProvider>;
    setProvider: (provider: AssistantPaneProvider) => Promise<GrokPaneState>;
    setContext: (root: string, stage: GrokContextStage) => Promise<void>;
    context: () => Promise<CodexContext | null>;
    onContext: (listener: (context: CodexContext | null) => void) => () => void;
    status: () => Promise<CodexAccountStatus>;
    signIn: () => Promise<void>;
    snapshot: () => Promise<CodexSnapshot>;
    newChat: () => Promise<CodexSnapshot>;
    restoreChat: (threadId: string) => Promise<CodexSnapshot>;
    send: (text: string) => Promise<void>;
    sendTask: (stage: GrokTask['stage'], extra?: string) => Promise<void>;
    onEvent: (listener: (event: CodexEvent) => void) => () => void;
    saveResponse: (text: string) => Promise<string | null>;
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
