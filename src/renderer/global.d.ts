import type { BatchStudioApi } from '../shared/types';

type BatchStudioWindowApi = Omit<BatchStudioApi, 'project'> & {
  project: BatchStudioApi['project'] & {
    removeRecent:(root:string)=>Promise<void>;
  };
};

declare global {
  interface Window {
    batchStudio: BatchStudioWindowApi;
  }
}

export {};
