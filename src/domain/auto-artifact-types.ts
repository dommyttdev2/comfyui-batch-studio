import type { ArtifactStage } from './agent-artifact-policy.js';
import type { ValidationIssue, ImportResult } from './artifact-types.js';
export type AutoArtifactPhase =
  | 'waiting'
  | 'detected'
  | 'validating'
  | 'imported'
  | 'duplicate'
  | 'invalid'
  | 'failed';
export interface AutoArtifactEvent {
  provider: 'grok' | 'codex';
  root: string;
  stage: ArtifactStage;
  fileName: string;
  phase: AutoArtifactPhase;
  sourceId: string;
  filePath?: string;
  rawResponsePath?: string;
  message?: string;
  issues?: ValidationIssue[];
  summary?: ImportResult['summary'];
}
