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
import { applyPromptPlanPatch } from './prompt-plan-patch.js';
import { readJson, writeJsonAtomic, writeTextAtomic } from './fs-utils.js';

type Stage = GrokTask['stage'];
type Ledger = { schemaVersion: 1; records: Record<string, AutoArtifactEvent> };
const queues = new Map<string, Promise<void>>();
const fileNames: Partial<Record<Stage, string>> = {
  'story-finalize': 'story.md',
  'story-fix': 'story.md',
  models: 'model_loras.json',
  'models-fix': 'model_loras.json',
  'prompt-plan': 'prompt_plan.json',
  'prompt-plan-fix': 'prompt_plan.json',
  'prompt-plan-patch': 'prompt_plan_patch.json',
  caption: 'caption_content.json',
};

export function expectedArtifact(stage: Stage): string | null {
  return fileNames[stage] ?? null;
}
export function artifactFileContent(stage: Stage, raw: string, extracted: string): string {
  if (stage === 'story-finalize' || stage === 'story-fix') return extracted.trimEnd();
  if (stage === 'prompt-plan-patch') {
    const fenced = raw.trim().match(/^`{3}(?:json)?\s*\n([\s\S]*?)\n`{3}\s*$/i);
    return JSON.stringify(JSON.parse(fenced?.[1] ?? raw), null, 2);
  }
  if (stage === 'models' || stage === 'models-fix') {
    // importGrok merges LoRA selections with the user's base models for the draft.
    // The downloadable model_loras.json must retain ONLY the agent's LoRA payload.
    const fenced = raw.match(/`{3}(?:json)?\s*\n([\s\S]*?)`{3}/i);
    const candidate = fenced?.[1] ?? raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    return JSON.stringify(JSON.parse(candidate.trim()), null, 2);
  }
  return JSON.stringify(JSON.parse(extracted), null, 2);
}

function ledgerPath(root: string) {
  return path.join(internalDir(root), 'auto-artifacts.json');
}

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function eventKey(provider: AutoArtifactProvider, stage: Stage, sourceId: string, hash: string) {
  return digest([provider, stage, sourceId, hash].join('\0'));
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
  const found = Object.values(ledger.records).filter(
    (record) =>
      record.provider === provider &&
      (record.stage === stage ||
        (stage === 'story' && record.stage.startsWith('story-')) ||
        (stage === 'models' && record.stage.startsWith('models')) ||
        (stage === 'prompt-plan' && record.stage.startsWith('prompt-plan'))) &&
      record.sourceId.startsWith(sourcePrefix),
  );
  return found.at(-1) ?? null;
}

export async function importAutoArtifact(
  root: string,
  provider: AutoArtifactProvider,
  stage: Stage,
  sourceId: string,
  raw: string,
  notify?: (status: AutoArtifactEvent) => void,
): Promise<AutoArtifactEvent> {
  const fileName = expectedArtifact(stage);
  if (!fileName || !sourceId.trim()) throw new Error('Invalid automatic artifact expectation.');
  const base: AutoArtifactEvent = { provider, root, stage, fileName, sourceId, phase: 'detected' };
  if (!raw.trim() || Buffer.byteLength(raw, 'utf8') > 10_000_000)
    return {
      ...base,
      phase: 'invalid',
      message: '成果物が空、または10MBを超えています。',
    };
  const queueKey = path.resolve(root);
  const previous = queues.get(queueKey) ?? Promise.resolve();
  let release = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(queueKey, next);
  await previous.catch(() => {});
  try {
    const hash = digest(raw);
    const key = eventKey(provider, stage, sourceId, hash);
    const ledger = await readLedger(root);
    const prior = ledger.records[key];
    if (prior?.phase === 'imported' || prior?.phase === 'duplicate') {
      const duplicate: AutoArtifactEvent = { ...prior, phase: 'duplicate' };
      notify?.(duplicate);
      return duplicate;
    }
    notify?.({ ...base, phase: 'validating' });
    const result =
      stage === 'caption'
        ? await importCaptionGrok(root, raw, { automatic: true, provider })
        : stage === 'prompt-plan-patch'
          ? await applyPromptPlanPatch(root, raw)
          : await importGrok(
                root,
                stage.startsWith('story-')
                  ? 'story'
                  : stage.startsWith('models')
                    ? 'models'
                    : 'promptPlan',
                raw,
                stage as Exclude<Stage, 'story-initial' | 'caption'>,
                { automatic: true, provider },
              );
    if (!result.validation.valid) {
      const invalid: AutoArtifactEvent = {
        ...base,
        phase: 'invalid',
        message: '検証に失敗しました。既存の下書きは変更していません。',
        issues: result.validation.issues,
      };
      notify?.(invalid);
      return invalid;
    }
    // The model's raw reply is retained separately from the validated draft.
    // Store the actual expected artifact (model_loras.json, not merged models.json).
    const artifactDir = path.join(internalDir(root), 'agent-artifacts', provider, stage, key);
    const filePath = path.join(artifactDir, fileName);
    const content = artifactFileContent(stage, raw, result.extracted);
    await writeTextAtomic(filePath, content.trimEnd() + '\n');
    const imported: AutoArtifactEvent = {
      ...base,
      phase: 'imported',
      filePath,
      message: `${fileName} を検証して下書きに取り込みました。確定は行っていません。`,
    };
    ledger.records[key] = imported;
    // Prevent unbounded growth; preserve the most recent 300 successful imports.
    const entries = Object.entries(ledger.records);
    if (entries.length > 300) ledger.records = Object.fromEntries(entries.slice(-300));
    await writeJsonAtomic(ledgerPath(root), ledger);
    notify?.(imported);
    return imported;
  } catch (error) {
    const failed: AutoArtifactEvent = {
      ...base,
      phase: 'failed',
      message: error instanceof Error ? error.message : String(error),
    };
    notify?.(failed);
    return failed;
  } finally {
    release();
    if (queues.get(queueKey) === next) queues.delete(queueKey);
  }
}
