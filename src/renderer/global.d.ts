import type { BatchStudioApi, ProjectSummary } from '../shared/types';

type BatchStudioWindowApi = Omit<BatchStudioApi, 'project' | 'artifact'> & {
  project: BatchStudioApi['project'] & {
    removeRecent: (root: string) => Promise<void>;
  };
  artifact: BatchStudioApi['artifact'] & {
    resetFrom: (
      root: string,
      scope: 'story' | 'base-models' | 'models' | 'models-fix' | 'prompt-plan' | 'workflow',
    ) => Promise<ProjectSummary>;
  };
};

declare global {
  interface Window {
    batchStudio: BatchStudioWindowApi;
  }
}

export {};
