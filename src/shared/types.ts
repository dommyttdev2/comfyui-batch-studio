export type Severity = 'error' | 'warning' | 'info';
export interface ValidationIssue { severity: Severity; code: string; message: string; path?: string; }
export interface ValidationResult { valid: boolean; issues: ValidationIssue[]; }

export type ArtifactKey = 'projectBrief' | 'story' | 'models' | 'promptPlan' | 'workflow' | 'legacyPromptTree';
export type ArtifactState = 'missing' | 'draft' | 'invalid' | 'warning' | 'confirmed' | 'stale' | 'generated' | 'legacy';
export interface ArtifactSummary { key: ArtifactKey; label: string; relativePath: string | null; state: ArtifactState; validation?: ValidationResult; }

export interface ProjectBriefInput {
  project: { id: string; title: string; };
  subject: { copyrightedCharacter: boolean; characterName: string; series: string; };
  audience: string;
  request: string;
  exclusions: string;
  assumptions: { adultCharacters: boolean; consensual: boolean; };
  generation: { target_image_count: number; modelFamily?: string; targetChapterCount?: number; };
  references?: string[];
}

export interface ProjectSettings {
  catalogPath?: string;
  comfyModelsRoot?: string;
  r2IndexPath?: string;
  templatePath?: string;
  manifestPath?: string;
  r2FileManagerUrl?: string;
}
export interface ProjectMeta { schemaVersion: 1; createdAt: string; updatedAt?: string; settings: ProjectSettings; workflowBuild?: Record<string, unknown>; }
export interface ProjectSummary { rootPath: string; title: string; id: string | null; targetImageCount: number | null; artifacts: ArtifactSummary[]; meta: ProjectMeta | null; }

export interface ArtifactReadResult { key: ArtifactKey; source: 'confirmed' | 'draft'; content: string | null; exists: boolean; validation: ValidationResult; }
export interface MissingRequirement { role: string; requirement: string; reason: string; }
export interface ImportResult { extracted: string; validation: ValidationResult; summary: Record<string,string|number|boolean|null>; missingRequirements: MissingRequirement[]; }

export interface StrengthBaseline { value: number; provenance: { source: 'civitai'; basis: 'creator-declared' | 'observed-usage-derived'; method?: string; sampleCount?: number; }; }
export interface ModelSelectionBase { ref: string; modelId: number; modelName: string; versionId: number; versionName: string; fileId: number; fileName: string; modelUrl: string; trainedWords: string[]; reason: string; }
export interface CheckpointSelection extends ModelSelectionBase { ref: 'checkpoint.main'; }
export interface LoraSelection extends ModelSelectionBase { ref: string; strengthBaseline?: StrengthBaseline; }
export interface ModelsArtifact { schemaVersion: 1; catalog: { schemaVersion: number; generation: number; generatedAt: string; }; checkpoint: CheckpointSelection; loras: LoraSelection[]; }

export interface LoraUsage { modelRef: string; strengthModel: number; strengthClip: number; }
export interface PromptLeaf { id: string; name: string; positive: string; negative: string; }
export interface PromptBranch { id: string; label: string; loras: LoraUsage[]; leaves: PromptLeaf[]; }
export interface PromptPlanArtifact { schemaVersion: 1; common: { positive: string; negative: string; }; rootLoras: LoraUsage[]; branches: PromptBranch[]; }

export interface CatalogFile { id: number; name: string; primary?: boolean; sizeKB?: number; format?: string; precision?: string; }
export interface CatalogVersion { versionId: number; versionName: string; files: CatalogFile[]; trainedWords?: string[]; strengthBaseline?: StrengthBaseline; modelUrl?: string; thumbnailUrl?: string; thumbnailWidth?: number; thumbnailHeight?: number; }
export interface CatalogItem { modelId: number; modelName: string; versionId: number; versionName: string; files: CatalogFile[]; trainedWords?: string[]; versions?: CatalogVersion[]; strengthBaseline?: StrengthBaseline; modelUrl?: string; thumbnailUrl?: string; thumbnailWidth?: number; thumbnailHeight?: number; error?: string; }
export interface CatalogCollection { id:number; name:string; description?:string; read?:string; type?:string; imageId?:number; thumbnailUrl?:string; items:CatalogItem[]; }
export interface ModelCatalog { schemaVersion: number; generation: number; generatedAt: string; collections: CatalogCollection[]; }
export interface CatalogStatus { configured: boolean; path: string | null; exists: boolean; schemaVersion?: number; generation?: number; generatedAt?: string; itemCount: number; error?: string; }
export interface CivitaiCatalogStatus { state:'idle'|'running'|'ready'|'error'; phase:string; completed:number; total:number; message:string; generation:number; changes:{added:number;updated:number;removed:number}; error:string|null; apiKeyConfigured:boolean; catalogPath:string; }
export interface CatalogSelectionEntry { collectionId:number; modelId:number; versionId:number; }
export interface CatalogSelectionTemplate { id:string; name:string; createdAt:string; updatedAt:string; selection:CatalogSelectionEntry[]; }
export interface CatalogSelectionTemplateInput { id?:string; name:string; selection:CatalogSelectionEntry[]; }

export interface GrokTask { stage: 'story-initial'|'story-finalize'|'story-fix'|'models'|'models-fix'|'prompt-plan'|'prompt-plan-fix'; title: string; prompt: string; attachments: Array<{name:string;path:string;purpose:string;exists:boolean}>; }

export interface WorkflowManifest {
  schemaVersion: 1; manifestVersion: string;
  template: { id:string; version:string; sha256:string; };
  common: { roles: Record<string,{nodeId:number}> };
  branchPrototype: { nodeIds:number[]; groupIds:number[]; roles:Record<string,{nodeId:number}>; boundaries:Array<{id:string;source:{role:string;slot:number};target:{role:string;slot:number}}>; layout:{offset:{x:number;y:number}}; };
}
export interface CompileResult { outputPath:string; branchCount:number; imageCount:number; nodeCount:number; linkCount:number; validation:ValidationResult; }

export interface ModelAvailabilityRow { ref:string; fileName:string; kind:'checkpoint'|'lora'; local:boolean; r2:boolean; state:'available'|'transfer-required'|'missing'; localPath?:string; }
export interface AvailabilityResult { rows:ModelAvailabilityRow[]; validation:ValidationResult; }
export interface PreflightResult { state:'READY'|'BLOCKED'; plannedImages:number; targetImages:number|null; blocking:ValidationIssue[]; warnings:ValidationIssue[]; sections:Array<{name:string;valid:boolean;issues:ValidationIssue[]}>; }

export interface GrokPaneState { visible:boolean; ratio:number; }
export interface BatchStudioApi {
  project: {
    select: () => Promise<ProjectSummary|null>;
    last: () => Promise<ProjectSummary|null>;
    selectParent: () => Promise<string|null>;
    create: (parent:string, brief:ProjectBriefInput) => Promise<ProjectSummary>;
    scan: (root:string) => Promise<ProjectSummary>;
    openFolder: (root:string) => Promise<void>;
    saveSettings: (root:string, settings:ProjectSettings) => Promise<ProjectSummary>;
    saveBrief: (root:string, brief:ProjectBriefInput) => Promise<ProjectSummary>;
  };
  artifact: {
    read: (root:string,key:ArtifactKey,source:'confirmed'|'draft')=>Promise<ArtifactReadResult>;
    beginEdit: (root:string,key:'story'|'models'|'promptPlan')=>Promise<ArtifactReadResult>;
    saveDraft: (root:string,key:'story'|'models'|'promptPlan',content:string)=>Promise<ArtifactReadResult>;
    importGrok: (root:string,key:'story'|'models'|'promptPlan',raw:string)=>Promise<ImportResult>;
    confirm: (root:string,key:'story'|'models'|'promptPlan')=>Promise<ProjectSummary>;
    savePromptPlan: (root:string,plan:PromptPlanArtifact)=>Promise<ArtifactReadResult>;
  };
  grokTask: { build: (root:string,stage:GrokTask['stage'],extra?:string)=>Promise<GrokTask>; };
  file: { showInFolder:(filePath:string)=>Promise<void>; };
  catalog: {
    status:(root:string)=>Promise<CatalogStatus>;
    integratedStatus:()=>Promise<CivitaiCatalogStatus>;
    snapshot:()=>Promise<ModelCatalog|null>;
    sync:()=>Promise<CivitaiCatalogStatus>;
    linkProject:(root:string)=>Promise<ProjectSummary>;
    templates:()=>Promise<CatalogSelectionTemplate[]>;
    saveTemplate:(input:CatalogSelectionTemplateInput)=>Promise<CatalogSelectionTemplate[]>;
    deleteTemplate:(id:string)=>Promise<CatalogSelectionTemplate[]>;
    openModel:(url:string)=>Promise<void>;
  };
  workflow: { compile:(root:string)=>Promise<CompileResult>; };
  availability: { check:(root:string)=>Promise<AvailabilityResult>; openR2:(root:string)=>Promise<void>; };
  preflight: { run:(root:string)=>Promise<PreflightResult>; };
  clipboard: { writeText:(text:string)=>Promise<void>; };
  grok: { setVisible:(visible:boolean)=>Promise<GrokPaneState>; setRatio:(ratio:number)=>Promise<GrokPaneState>; setDividerScreenX:(screenX:number)=>Promise<GrokPaneState>; reload:()=>Promise<void>; openExternal:()=>Promise<void>; };
}
