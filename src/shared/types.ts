export type Severity = 'error' | 'warning' | 'info';
export interface ValidationIssue { severity: Severity; code: string; message: string; path?: string; }
export interface ValidationResult { valid:boolean; issues:ValidationIssue[]; }
export type ArtifactKey = 'projectBrief' | 'story' | 'models' | 'promptPlan' | 'workflow' | 'legacyPromptTree';
export type ArtifactState = 'missing' | 'draft' | 'invalid' | 'warning' | 'confirmed' | 'stale' | 'generated' | 'legacy';
export interface ArtifactSummary { key: ArtifactKey; label: string; relativePath: string | null; state: ArtifactState; validation?: ValidationResult; }
export type ModelFamily='illustrious'|'anima';
export type ModelSelectionRole='checkpoint'|'text_encoder'|'clip'|'lora';
export type ModelFileRole='text_encoder'|'vae';
export interface ProjectBriefInput { project:{id:string;title:string}; subject:{copyrightedCharacter:boolean;characterName:string;series:string}; audience:string; request:string; exclusions:string; assumptions:{adultCharacters:boolean;consensual:boolean}; generation:{target_image_count:number;modelFamily?:ModelFamily|'Illustrious';targetChapterCount?:number}; references?:string[]; }
export type ExecutionTarget = 'local' | 'remote';
export interface AppSettings { comfyUiInstallPath:string; catalogPath?:string; r2Bucket?:string; r2ModelPrefix?:string; r2IndexPath?:string; templatePath?:string; manifestPath?:string; }
export interface LocalModelFile { fileName:string; path:string; size:number; }
export interface LocalModelDirectory { path:string|null; exists:boolean; files:LocalModelFile[]; }
export interface AppSettingsStatus extends Required<AppSettings> { configured:boolean; modelsPath:string|null; installExists:boolean; modelsExists:boolean; modelFiles:{text_encoders:LocalModelDirectory;vae:LocalModelDirectory}; }
export interface ProjectSettings { catalogPath?:string; comfyModelsRoot?:string; executionTarget?:ExecutionTarget; r2IndexPath?:string; templatePath?:string; manifestPath?:string; r2FileManagerUrl?:string; r2Bucket?:string; r2ModelPrefix?:string; }
export interface ProjectMeta { schemaVersion:1; createdAt:string; updatedAt?:string; settings:ProjectSettings; workflowBuild?:Record<string,unknown>; }
export interface ProjectSummary { rootPath:string; title:string; id:string|null; targetImageCount:number|null; artifacts:ArtifactSummary[]; meta:ProjectMeta|null; }
export interface ArtifactReadResult { key:ArtifactKey; source:'confirmed'|'draft'; content:string|null; exists:boolean; validation:ValidationResult; }
export interface MissingRequirement { role:string; requirement:string; reason:string; }
export interface ImportResult { extracted:string; validation:ValidationResult; summary:Record<string,string|number|boolean|null>; missingRequirements:MissingRequirement[]; }
export interface StrengthBaseline { value:number; provenance:{source:'civitai';basis:'creator-declared'|'observed-usage-derived';method?:string;sampleCount?:number}; }
export interface ModelSelectionBase { ref:string; modelId:number; modelName:string; versionId:number; versionName:string; fileId:number; fileName:string; modelUrl:string; trainedWords:string[]; reason:string; }
export interface CheckpointSelection extends ModelSelectionBase { ref:'checkpoint.main'; }
export interface CatalogTextEncoderSelection extends ModelSelectionBase { ref:'text_encoder.main'; }
export interface CatalogClipSelection extends ModelSelectionBase { ref:'clip.main'; }
export interface ModelFileSelectionBase { ref:string; fileName:string; reason:string; }
export interface TextEncoderSelection extends ModelFileSelectionBase { ref:'text_encoder.main'; }
export interface ClipSelection extends ModelFileSelectionBase { ref:'clip.main'; }
export interface VaeSelection extends ModelFileSelectionBase { ref:'vae.main'; }
export interface LoraSelection extends ModelSelectionBase { ref:string; strengthBaseline?:StrengthBaseline; }
export interface ModelsArtifact { schemaVersion:1|2|3|4; modelFamily?:ModelFamily; catalog:{schemaVersion:number;generation:number;generatedAt:string}; checkpoint:CheckpointSelection; textEncoder?:CatalogTextEncoderSelection|TextEncoderSelection; clip?:CatalogClipSelection|ClipSelection; vae?:VaeSelection; loras:LoraSelection[]; }
export type GrokLoraSelectionStage='models'|'models-fix';
export interface GrokLoraSelectionHistoryEntry { id:string; stage:GrokLoraSelectionStage; createdAt:string; loras:LoraSelection[]; }
export interface LoraFileAvailability { fileName:string; local:boolean; r2:boolean; }
export interface ModelFileCandidate { fileName:string; local:boolean; r2:boolean; localPath?:string; r2Key?:string; localSize?:number; r2Size?:number; }
export interface LoraUsage { modelRef:string; strengthModel:number; strengthClip:number; }
export interface PromptLeaf { id:string; name:string; positive:string; negative:string; }
export interface PromptBranch { id:string; label:string; loras:LoraUsage[]; leaves:PromptLeaf[]; }
export interface PromptPlanArtifact { schemaVersion:1; common:{positive:string;negative:string}; rootLoras:LoraUsage[]; branches:PromptBranch[]; }
export interface CatalogFile { id:number; name:string; primary?:boolean; sizeKB?:number; type?:string; format?:string; precision?:string; }
export interface CatalogVersion { versionId:number; versionName:string; baseModel?:string; files:CatalogFile[]; trainedWords?:string[]; strengthBaseline?:StrengthBaseline; modelUrl?:string; thumbnailUrl?:string; thumbnailWidth?:number; thumbnailHeight?:number; }
export interface CatalogItem { modelId:number; modelName:string; modelType?:string; versionId:number; versionName:string; baseModel?:string; files:CatalogFile[]; trainedWords?:string[]; versions?:CatalogVersion[]; strengthBaseline?:StrengthBaseline; modelUrl?:string; thumbnailUrl?:string; thumbnailWidth?:number; thumbnailHeight?:number; error?:string; }
export interface CatalogCollection { id:number; name:string; description?:string; read?:string; type?:string; imageId?:number; thumbnailUrl?:string; items:CatalogItem[]; }
export interface ModelCatalog { schemaVersion:number; generation:number; generatedAt:string; collections:CatalogCollection[]; }
export interface CatalogStatus { configured:boolean; path:string|null; exists:boolean; schemaVersion?:number; generation?:number; generatedAt?:string; itemCount:number; error?:string; }
export interface CivitaiCatalogStatus { state:'idle'|'running'|'ready'|'error'; phase:string; completed:number; total:number; message:string; generation:number; changes:{added:number;updated:number;removed:number}; error:string|null; apiKeyConfigured:boolean; catalogPath:string; }
export interface CivitaiConnectionInput { apiKey:string; }
export interface CivitaiConnectionStatus { configured:boolean; source:'saved'|'environment'|'none'; }
export interface CatalogSelectionEntry { collectionId:number; modelId:number; versionId:number; }
export interface CatalogSelectionTemplate { id:string; name:string; createdAt:string; updatedAt:string; selection:CatalogSelectionEntry[]; }
export interface CatalogSelectionTemplateInput { id?:string; name:string; selection:CatalogSelectionEntry[]; }
export interface GrokTask { stage:'story-initial'|'story-finalize'|'story-fix'|'models'|'models-fix'|'prompt-plan'|'prompt-plan-fix'; title:string; prompt:string; attachments:Array<{name:string;path:string;purpose:string;exists:boolean}>; }
export interface WorkflowManifest { schemaVersion:1; manifestVersion:string; template:{id:string;version:string;sha256:string}; common:{roles:Record<string,{nodeId:number}>}; branchPrototype:{nodeIds:number[];groupIds:number[];roles:Record<string,{nodeId:number}>;boundaries:Array<{id:string;source:{role:string;slot:number};target:{role:string;slot:number}}>;layout:{offset:{x:number;y:number}}}; }
export interface CompileResult { outputPath:string; branchCount:number; imageCount:number; nodeCount:number; linkCount:number; validation:ValidationResult; }
export interface ModelAvailabilityRow { ref:string; fileName:string; kind:'checkpoint'|'text_encoder'|'clip'|'vae'|'lora'; local:boolean; r2:boolean; state:'available'|'transfer-required'|'missing'; localPath?:string; }
export interface AvailabilityResult { rows:ModelAvailabilityRow[]; validation:ValidationResult; executionTarget:ExecutionTarget; localModelsRoot:string|null; }
export interface PreflightResult { state:'READY'|'BLOCKED'; plannedImages:number; targetImages:number|null; blocking:ValidationIssue[]; warnings:ValidationIssue[]; sections:Array<{name:string;valid:boolean;issues:ValidationIssue[]}>; }
export interface R2ConnectionInput { name?:string; accountId:string; accessKeyId:string; secretAccessKey?:string; publicUrl?:string; cloudflareApiToken?:string; }
export interface R2ConnectionStatus { configured:boolean; name:string; accountId:string; accessKeyId:string; publicUrl:string; secretConfigured:boolean; metricsTokenConfigured:boolean; }
export interface R2Bucket { name:string; createdAt?:string|null; }
export interface R2Object { key:string; name:string; size:number; etag:string; lastModified?:string|null; storageClass?:string; }
export interface R2ListResult { folders:Array<{prefix:string;name:string}>; objects:R2Object[]; nextToken:string|null; }
export interface R2SearchResult { objects:R2Object[]; nextToken:string|null; scanned:number; }
export interface R2DownloadInfo { key:string; url:string; public:boolean; expiresIn:number|null; fileName:string; commands:{url:string;curl:string;wget:string;aria2c:string}; }
export interface R2BatchDownloadTemplate { id:string; name:string; bucket:string; createdAt:string; updatedAt:string; objects:Array<{key:string;name:string;size?:number}>; }
export interface R2UploadJob { id:string; bucket:string; key:string; filePath:string; fileName:string; size:number; contentType:string; uploadId:string|null; partSize:number; completedParts:Record<string,string>; status:'paused'|'uploading'|'complete'|'failed'|'cancelled'; transferredBytes:number; error:string; createdAt:string; }
export interface R2Metrics { configured:boolean; payload?:unknown; }
export type GrokContextStage='story'|'models'|'prompt-plan';
export interface GrokPaneState { visible:boolean; ratio:number; }
export interface BatchStudioApi {
  appSettings:{get:()=>Promise<AppSettingsStatus>;selectComfyUiDirectory:()=>Promise<string|null>;save:(settings:AppSettings)=>Promise<AppSettingsStatus>};
  project:{select:()=>Promise<ProjectSummary|null>;last:()=>Promise<ProjectSummary|null>;recent:()=>Promise<ProjectSummary[]>;open:(root:string)=>Promise<ProjectSummary>;close:()=>Promise<void>;selectParent:()=>Promise<string|null>;create:(parent:string,brief:ProjectBriefInput)=>Promise<ProjectSummary>;scan:(root:string)=>Promise<ProjectSummary>;openFolder:(root:string)=>Promise<void>;saveSettings:(root:string,settings:ProjectSettings)=>Promise<ProjectSummary>;saveBrief:(root:string,brief:ProjectBriefInput)=>Promise<ProjectSummary>};
  artifact:{read:(root:string,key:ArtifactKey,source:'confirmed'|'draft')=>Promise<ArtifactReadResult>;beginEdit:(root:string,key:'story'|'models'|'promptPlan')=>Promise<ArtifactReadResult>;saveDraft:(root:string,key:'story'|'models'|'promptPlan',content:string)=>Promise<ArtifactReadResult>;importGrok:(root:string,key:'story'|'models'|'promptPlan',raw:string,stage?:GrokLoraSelectionStage)=>Promise<ImportResult>;confirm:(root:string,key:'story'|'models'|'promptPlan')=>Promise<ProjectSummary>;savePromptPlan:(root:string,plan:PromptPlanArtifact)=>Promise<ArtifactReadResult>;grokLoraHistory:(root:string)=>Promise<GrokLoraSelectionHistoryEntry[]>};
  grokTask:{build:(root:string,stage:GrokTask['stage'],extra?:string)=>Promise<GrokTask>}; file:{showInFolder:(filePath:string)=>Promise<void>};
  catalog:{status:(root:string)=>Promise<CatalogStatus>;integratedStatus:()=>Promise<CivitaiCatalogStatus>;snapshot:()=>Promise<ModelCatalog|null>;sync:()=>Promise<CivitaiCatalogStatus>;linkProject:(root:string)=>Promise<ProjectSummary>;templates:()=>Promise<CatalogSelectionTemplate[]>;saveTemplate:(input:CatalogSelectionTemplateInput)=>Promise<CatalogSelectionTemplate[]>;deleteTemplate:(id:string)=>Promise<CatalogSelectionTemplate[]>;openModel:(url:string)=>Promise<void>};
  civitai:{settings:()=>Promise<CivitaiConnectionStatus>;saveSettings:(input:CivitaiConnectionInput)=>Promise<CivitaiConnectionStatus>};
  workflow:{compile:(root:string)=>Promise<CompileResult>}; availability:{check:(root:string)=>Promise<AvailabilityResult>;checkLoraFiles:(root:string,fileNames:string[])=>Promise<LoraFileAvailability[]>;openR2:(root:string)=>Promise<void>}; preflight:{run:(root:string)=>Promise<PreflightResult>}; clipboard:{writeText:(text:string)=>Promise<void>};
  r2:{settings:()=>Promise<R2ConnectionStatus>; environment:()=>Promise<R2ConnectionInput>; test:(input:R2ConnectionInput)=>Promise<void>; saveSettings:(input:R2ConnectionInput)=>Promise<R2ConnectionStatus>;buckets:()=>Promise<R2Bucket[]>; createBucket:(name:string)=>Promise<void>; deleteBucket:(name:string)=>Promise<void>;list:(bucket:string,prefix:string,token?:string|null)=>Promise<R2ListResult>; search:(bucket:string,query:string,token?:string|null)=>Promise<R2SearchResult>;downloadInfo:(bucket:string,key:string,expiresIn?:number)=>Promise<R2DownloadInfo>; batchDownloadInfo:(bucket:string,keys:string[],expiresIn?:number)=>Promise<R2DownloadInfo[]>;deleteObjects:(bucket:string,keys:string[])=>Promise<{deleted:string[];errors:unknown[]}>; move:(bucket:string,sourceKey:string,destinationKey:string,overwrite?:boolean)=>Promise<void>;selectUploadFiles:()=>Promise<string[]>; beginUpload:(bucket:string,prefix:string,filePath:string,overwrite?:boolean)=>Promise<R2UploadJob>; uploads:()=>Promise<R2UploadJob[]>; resumeUpload:(id:string)=>Promise<R2UploadJob>; pauseUpload:(id:string)=>Promise<R2UploadJob>; cancelUpload:(id:string)=>Promise<void>;templates:(bucket?:string)=>Promise<R2BatchDownloadTemplate[]>; saveTemplate:(input:{id?:string;name:string;bucket:string;objects:Array<{key:string;name:string;size?:number}>})=>Promise<R2BatchDownloadTemplate[]>; deleteTemplate:(id:string)=>Promise<R2BatchDownloadTemplate[]>;metrics:()=>Promise<R2Metrics>;};
  grok:{setVisible:(visible:boolean)=>Promise<GrokPaneState>;setContext:(root:string,stage:GrokContextStage)=>Promise<GrokPaneState>;setRatio:(ratio:number)=>Promise<GrokPaneState>;setDividerScreenX:(screenX:number)=>Promise<GrokPaneState>;reload:()=>Promise<void>;openExternal:()=>Promise<void>};
}
