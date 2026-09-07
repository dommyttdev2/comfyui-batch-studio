export type ArtifactState = 'present' | 'missing' | 'legacy';

export type ArtifactKey =
  | 'projectBrief'
  | 'story'
  | 'models'
  | 'promptPlan'
  | 'workflow'
  | 'legacyPromptTree';

export interface ArtifactSummary {
  key: ArtifactKey;
  label: string;
  relativePath: string | null;
  state: ArtifactState;
}

export interface ProjectSummary {
  rootPath: string;
  title: string;
  id: string | null;
  artifacts: ArtifactSummary[];
}

export interface GrokPaneState {
  visible: boolean;
  ratio: number;
}

export interface BatchStudioApi {
  project: {
    select: () => Promise<ProjectSummary | null>;
    scan: (rootPath: string) => Promise<ProjectSummary>;
    openFolder: (rootPath: string) => Promise<void>;
  };
  clipboard: {
    writeText: (text: string) => Promise<void>;
  };
  grok: {
    setVisible: (visible: boolean) => Promise<GrokPaneState>;
    setRatio: (ratio: number) => Promise<GrokPaneState>;
    reload: () => Promise<void>;
    openExternal: () => Promise<void>;
  };
}
