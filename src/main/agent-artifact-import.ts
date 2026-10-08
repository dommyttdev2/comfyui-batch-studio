import { importAgentDraft } from '../application/agent-draft-import.js';
import { selectLatestAutoArtifact } from '../domain/auto-artifact-selection.js';
import { ingestAutoArtifact } from '../application/auto-artifact-ingestion.js';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  AutoArtifactEvent,
  AutoArtifactProvider,
  GrokContextStage,
  GrokTask,
} from '../shared/types.js';
import { importGrok, internalDir } from './artifact-service.js';
import { importCaptionGrok } from './caption-service.js';
import { readJson, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';
import { applyPromptPlanPatch } from './prompt-plan-patch.js';

type Stage = GrokTask['stage'];
type Ledger = { schemaVersion: 1; records: Record<string, AutoArtifactEvent> };

export { artifactFileContent, expectedArtifact } from '../domain/agent-artifact-policy.js';

import { artifactFileContent, expectedArtifact } from '../domain/agent-artifact-policy.js';

function ledgerPath(root: string) {
  return path.join(internalDir(root), 'auto-artifacts.json');
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function readLedger(root: string): Promise<Ledger> {
  const value = await readJson<Ledger>(ledgerPath(root));
  return value?.schemaVersion === 1 && value.records && typeof value.records === 'object'
    ? value
    : { schemaVersion: 1, records: {} };
}

export async function latestAutoArtifact(
  root: string,
  provider: AutoArtifactProvider,
  stage: Stage | GrokContextStage,
  sourcePrefix = '',
): Promise<AutoArtifactEvent | null> {
  const ledger = await readLedger(root);
  return selectLatestAutoArtifact(ledger.records, provider, stage, sourcePrefix);
}

export async function importAutoArtifact(
  root: string,
  provider: AutoArtifactProvider,
  stage: Stage,
  sourceId: string,
  raw: string,
  notify?: (status: AutoArtifactEvent) => void,
) {
  return ingestAutoArtifact(
    {
      readLedger,
      writeLedger: (root, ledger) => writeJsonAtomic(ledgerPath(root), ledger),
      hash: digest,
      outputPath: (root, provider, stage, key, fileName) =>
        path.join(internalDir(root), 'agent-artifacts', provider, stage, key, fileName),
      writeText: writeTextAtomic,
      importDraft: (root, stage, raw) =>
        importAgentDraft(
          {
            caption: (root, raw, provider) =>
              importCaptionGrok(root, raw, { automatic: true, provider }),
            patch: applyPromptPlanPatch,
            artifact: (root, key, raw, stage, provider) =>
              importGrok(root, key, raw, stage, { automatic: true, provider }),
          },
          root,
          stage,
          raw,
          provider,
        ),
    },
    path.resolve(root),
    provider,
    stage,
    sourceId,
    raw,
    notify,
  );
}
