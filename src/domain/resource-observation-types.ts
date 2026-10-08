import type { LoraSelection } from './artifact-types.js';
export type GrokLoraSelectionStage = 'models' | 'models-fix';
export interface R2Object {
  key: string;
  name: string;
  size: number;
  etag: string;
  lastModified?: string | null;
  storageClass?: string;
}
export interface R2SearchResult {
  objects: R2Object[];
  nextToken: string | null;
  scanned: number;
}
export interface LoraFileAvailability {
  fileName: string;
  local: boolean;
  r2: boolean;
}
export interface GrokLoraSelectionHistoryEntry {
  id: string;
  stage: GrokLoraSelectionStage;
  createdAt: string;
  loras: LoraSelection[];
}
