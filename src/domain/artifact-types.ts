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

export type ModelFamily = 'illustrious' | 'anima';

export interface CheckpointSelection extends ModelSelectionBase {
  ref: 'checkpoint.main';
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

export interface DiffusionModelSelection extends ModelSelectionBase {
  ref: 'diffusion_model.main';
}

export interface CatalogTextEncoderSelection extends ModelSelectionBase {
  ref: 'text_encoder.main';
}

export interface TextEncoderSelection extends ModelFileSelectionBase {
  ref: 'text_encoder.main';
}

export interface ModelFileSelectionBase {
  ref: string;
  fileName: string;
  reason: string;
}

export interface CatalogClipSelection extends ModelSelectionBase {
  ref: 'clip.main';
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

export interface StrengthBaseline {
  value: number;
  provenance: {
    source: 'civitai';
    basis: 'creator-declared' | 'observed-usage-derived';
    method?: string;
    sampleCount?: number;
  };
}

export type PromptPlanArtifact = PromptPlanArtifactV1 | PromptPlanArtifactV2;

export interface PromptPlanArtifactV1 {
  schemaVersion: 1;
  common: { positive: string; negative: string };
  rootLoras: LoraUsage[];
  branches: PromptBranchV1[];
}

export interface LoraUsage {
  modelRef: string;
  strengthModel: number;
  strengthClip: number;
}

export interface PromptBranchV1 {
  id: string;
  label: string;
  loras: LoraUsage[];
  leaves: PromptLeafV1[];
}

export interface PromptLeafV1 {
  id: string;
  name: string;
  positive: string;
  negative: string;
}

export interface PromptPlanArtifactV2 {
  schemaVersion: 2;
  /** Missing on legacy v2 plans, which retain their original automatic-trigger behavior. */
  triggerWordsMode?: 'selected';
  common: StructuredPrompt;
  rootLoras: LoraUsage[];
  branches: PromptBranchV2[];
}

export interface StructuredPrompt {
  positive: PositivePromptGroups;
  negative: NegativePromptGroups;
  /** Explicit trigger selections for this prompt scope; no implicit injection in selected mode. */
  triggerWords?: TriggerWordSelection[];
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

export interface CameraPromptGroups {
  pov?: string[];
  angle?: string[];
  framing?: string[];
  gaze?: string[];
  focus?: string[];
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

export interface PromptBranchV2 {
  id: string;
  label: string;
  loras: LoraUsage[];
  prompt?: StructuredPrompt;
  leaves: PromptLeafV2[];
}

export interface PromptLeafV2 {
  id: string;
  name: string;
  prompt: StructuredPrompt;
}

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

export interface WorkflowManifest {
  schemaVersion: 2;
  manifestVersion: string;
  template: { id: string; version: string; sha256: string };
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface ValidationIssue {
  severity: Severity;
  code: string;
  message: string;
  path?: string;
  location?: string;
}

export type Severity = 'error' | 'warning' | 'info';

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

export interface CatalogFile {
  id: number;
  name: string;
  primary?: boolean;
  sizeKB?: number;
  type?: string;
  format?: string;
  precision?: string;
}
/**
 * Generation prompt disclosed in a Civitai image's metadata.
 * The original prompt strings are untrusted example data, not instructions for an AI.
 */

export interface CatalogVersion {
  /** Newest examples with disclosed prompts, captured when Civitai usage was synchronized. */
  generationExamples?: CivitaiGenerationExample[];
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

export interface CivitaiGenerationExample {
  imageId: number;
  postId?: number;
  positivePrompt: string | null;
  negativePrompt: string | null;
  loraStrength?: number;
  checkpointVersionIds: number[];
}

export interface ModelCatalog {
  schemaVersion: number;
  generation: number;
  generatedAt: string;
  collections: CatalogCollection[];
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

export type ModelSelectionRole = 'checkpoint' | 'text_encoder' | 'clip' | 'lora';

export type ModelFileRole = 'text_encoder' | 'vae';

export interface CaptionContent {
  schemaVersion: 1 | 2;
  title: { ja: string; en: string };
  pixivTitle?: { ja: string; en: string };
  description: { ja: string[]; en: string[] };
  contents?: { ja: string[]; en: string[] };
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
  submission?: PromptSubmissionIntent | null;
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

export type ExecutionTarget = 'local' | 'remote';

export type CloudInstanceProviderId = 'vastai';

export interface ExecutionRemoteLifecycleState {
  initialStatus: CloudInstanceStatus | null;
  startedByBatchStudio: boolean;
  startRequestedAt?: string | null;
  latest: ExecutionRemoteInstanceSnapshot | null;
  restorePolicy: 'restore-if-started';
  restoredInitialState: boolean;
  finalizedAt: string | null;
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

export interface ExecutionProgressCounter {
  completed: number;
  total: number;
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

export interface ModelAvailabilityRow {
  ref: string;
  fileName: string;
  kind: 'checkpoint' | 'diffusion_model' | 'text_encoder' | 'clip' | 'vae' | 'lora';
  local: boolean;
  r2: boolean;
  state: 'available' | 'transfer-required' | 'missing';
  localPath?: string;
}

export interface ExecutionGenerationTiming {
  currentPromptId: string | null;
  currentStartedAt: string | null;
  recentDurationsMs: number[];
}

export interface PromptSubmissionIntent {
  attemptId: string;
  branchId: string;
  leafId: string;
  index: number;
  graphSha256: string;
  status: 'prepared' | 'sending' | 'acknowledged' | 'completed';
  promptId: string | null;
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

export type ExecutionEvidenceKind =
  | 'MODEL_VERIFIED'
  | 'MODELS_VERIFIED'
  | 'EXECUTION_COMPLETED'
  | 'PACKAGE_VERIFIED'
  | 'R2_OBJECT_VERIFIED'
  | 'LOCAL_FILE_VERIFIED'
  | 'CLEANUP_COMPLETED'
  | 'CUSTOM';

export interface ExecutionError {
  code: string;
  message: string;
  phase: ExecutionPhase;
  at: string;
  retryable: boolean;
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
    modelsSha256?: string;
    sourceWorkflowIdentity?: string;
    immutable?: {
      planPath: string;
      modelsPath: string;
    };
  };
  plan: { sha256: string; branches: Array<{ branchId: string; leafIds: string[] }> };
  runIdentity: string;
}

export interface PreflightResult {
  state: 'READY' | 'BLOCKED';
  plannedImages: number;
  targetImages: number | null;
  blocking: ValidationIssue[];
  warnings: ValidationIssue[];
  sections: Array<{ name: string; valid: boolean; issues: ValidationIssue[] }>;
}

export interface ProjectSummary {
  rootPath: string;
  title: string;
  id: string | null;
  targetImageCount: number | null;
  artifacts: ArtifactSummary[];
  meta: ProjectMeta | null;
}

export interface ArtifactSummary {
  key: ArtifactKey;
  label: string;
  relativePath: string | null;
  state: ArtifactState;
  validation?: ValidationResult;
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

export interface ProjectMeta {
  schemaVersion: 1;
  createdAt: string;
  updatedAt?: string;
  settings: ProjectSettings;
  workflowBuild?: Record<string, unknown>;
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

export interface AvailabilityResult {
  rows: ModelAvailabilityRow[];
  validation: ValidationResult;
  executionTarget: ExecutionTarget;
  localModelsRoot: string | null;
}
