import type { ExecutionRun } from './artifact-types.js';
import { validatedExecutionEvidence } from './execution-evidence.js';
export function resumeFinalization(
  run: ExecutionRun,
  now: string,
  hash: (value: unknown) => string,
) {
  if (
    run.lifecycle !== 'FAILED' ||
    run.executionTarget !== 'remote' ||
    run.remote?.provider !== 'vastai' ||
    run.error?.code !== 'REMOTE_INSTANCE_FINALIZE_FAILED' ||
    run.remoteLifecycle?.finalizedAt
  )
    throw new Error('This Execution Run has no pending Vast.ai stop finalization to retry.');
  const verified = validatedExecutionEvidence(run, hash);
  const kinds = new Set(verified.valid.map((item) => item.kind));
  if (!kinds.has('LOCAL_FILE_VERIFIED') || !kinds.has('CLEANUP_COMPLETED'))
    throw new Error('Cannot retry only finalization before artifacts were delivered and cleaned.');

  const next: ExecutionRun = {
    ...run,
    lifecycle: 'RUNNING',
    phase: 'CLOUD_INSTANCE_FINALIZING',
    controls: { ...run.controls, scheduling: 'STOPPED' },
    error: null,
    completedAt: null,
    resume: {
      attempts: run.resume.attempts + 1,
      lastAttemptAt: now,
      lastValidatedEvidenceIds: verified.valid.map((item) => item.id),
      lastIgnoredEvidenceIds: verified.invalid,
      lastDecisionPhase: 'CLOUD_INSTANCE_FINALIZING',
    },
    updatedAt: now,
  };
  return next;
}
