import type { AutoArtifactEvent } from '../domain/auto-artifact-types.js';
import {
  expectedArtifact,
  artifactFileContent,
  type ArtifactStage,
} from '../domain/agent-artifact-policy.js';
import { utf8Size } from '../domain/text-policy.js';
import type { ImportResult } from '../domain/artifact-types.js';
export type AutoArtifactLedger = { schemaVersion: 1; records: Record<string, AutoArtifactEvent> };
export interface AutoArtifactPorts {
  readLedger(root: string): Promise<AutoArtifactLedger>;
  writeLedger(root: string, value: AutoArtifactLedger): Promise<void>;
  hash(raw: string): string;
  importDraft(
    root: string,
    stage: ArtifactStage,
    raw: string,
  ): Promise<
    Pick<ImportResult, 'validation' | 'extracted' | 'summary'> & { rawResponsePath?: string }
  >;
  outputPath(
    root: string,
    provider: 'grok' | 'codex',
    stage: ArtifactStage,
    key: string,
    fileName: string,
  ): string;
  writeText(resource: string, content: string): Promise<void>;
}
const queues = new Map<string, Promise<void>>();
export async function ingestAutoArtifact(
  ports: AutoArtifactPorts,
  root: string,
  provider: 'grok' | 'codex',
  stage: ArtifactStage,
  sourceId: string,
  raw: string,
  notify?: (status: AutoArtifactEvent) => void,
): Promise<AutoArtifactEvent> {
  const fileName = expectedArtifact(stage);
  if (!fileName || !sourceId.trim()) throw new Error('Invalid automatic artifact expectation.');
  const base: AutoArtifactEvent = { provider, root, stage, fileName, sourceId, phase: 'detected' };
  if (!raw.trim() || utf8Size(raw) > 10_000_000)
    return {
      ...base,
      phase: 'invalid',
      message: '成果物が空、または10MBを超えています。',
    };
  const queueKey = root;
  const previous = queues.get(queueKey) ?? Promise.resolve();
  let release = () => {};
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  queues.set(queueKey, next);
  await previous.catch(() => {});
  try {
    const hash = ports.hash(raw);
    const key = ports.hash([provider, stage, sourceId, hash].join('\0'));
    const ledger = await ports.readLedger(root);
    const prior = ledger.records[key];
    if (prior?.phase === 'imported' || prior?.phase === 'duplicate') {
      const duplicate: AutoArtifactEvent = { ...prior, phase: 'duplicate' };
      notify?.(duplicate);
      return duplicate;
    }
    notify?.({ ...base, phase: 'validating' });
    const result = await ports.importDraft(root, stage, raw);
    if (!result.validation.valid) {
      const invalid: AutoArtifactEvent = {
        ...base,
        phase: 'invalid',
        message: '検証に失敗しました。既存の下書きは変更していません。',
        issues: result.validation.issues,
        ...('rawResponsePath' in result && typeof result.rawResponsePath === 'string'
          ? { rawResponsePath: result.rawResponsePath }
          : {}),
      };
      notify?.(invalid);
      return invalid;
    }
    // The model's raw reply is retained separately from the validated draft.
    // Store the actual expected artifact (model_loras.json, not merged models.json).
    const filePath = ports.outputPath(root, provider, stage, key, fileName);
    const content = artifactFileContent(stage, raw, result.extracted);
    await ports.writeText(filePath, content.trimEnd() + '\n');
    const imported: AutoArtifactEvent = {
      ...base,
      phase: 'imported',
      filePath,
      summary: result.summary,
      message: `${fileName} を検証して下書きに取り込みました。確定は行っていません。`,
    };
    ledger.records[key] = imported;
    // Prevent unbounded growth; preserve the most recent 300 successful imports.
    const entries = Object.entries(ledger.records);
    if (entries.length > 300) ledger.records = Object.fromEntries(entries.slice(-300));
    await ports.writeLedger(root, ledger);
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
