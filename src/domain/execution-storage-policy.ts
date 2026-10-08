import type { ExecutionRun } from './artifact-types.js';
import { assertPersistSafe } from './execution-record-policy.js';

export function assertRunBackup(value: unknown, runId: string | null): void {
  if (runId === null) {
    const pointer = value as { schemaVersion?: unknown; runId?: unknown } | null;
    if (
      pointer?.schemaVersion !== 1 ||
      typeof pointer.runId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        pointer.runId,
      )
    )
      throw new Error('バックアップのcurrentポインタが不正です。');
    return;
  }
  const run = value as ExecutionRun | null;
  if (
    !run ||
    run.runId !== runId ||
    !['RUNNING', 'PAUSED', 'INTERRUPTED', 'FAILED', 'COMPLETED', 'DISCARDED'].includes(
      run.lifecycle,
    ) ||
    typeof run.projectId !== 'string' ||
    !run.snapshot ||
    !run.controls ||
    !run.progress ||
    !Array.isArray(run.evidence)
  )
    throw new Error('バックアップのRun IDまたは形式が一致しません。');
  assertPersistSafe(run);
}
