import type {
  ExecutionRun,
  ExecutionRunSnapshot,
  PreflightResult,
} from '../domain/artifact-types.js';
import { validatedExecutionEvidence as validateEvidence } from '../domain/execution-evidence.js';
import { resumePhase } from '../domain/execution-resume.js';
import { sameSnapshot } from './execution-creation.js';
export interface ResumptionPorts {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  load(): Promise<ExecutionRun | null>;
  verifyWorkflow(run: ExecutionRun): Promise<void>;
  capture(result: PreflightResult): Promise<ExecutionRunSnapshot>;
  write(run: ExecutionRun): Promise<void>;
  setCurrent(id: string): Promise<void>;
  now(): string;
  hash(value: unknown): string;
}
function resumableLifecycle(value: string) {
  return ['PAUSED', 'INTERRUPTED', 'FAILED'].includes(value);
}
export async function resumeReservedExecution(
  ports: ResumptionPorts,
  runId: string,
  preflightProvider: () => Promise<PreflightResult>,
) {
  return ports.exclusive(async () => {
    const run = await ports.load();
    if (!run) throw new Error(`Execution Run ${runId} was not found.`);
    if (!resumableLifecycle(run.lifecycle))
      throw new Error(`Execution Run ${runId} is not resumable from ${run.lifecycle}.`);
    if (
      run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN' ||
      run.error?.code === 'LOCAL_OUTPUT_COLLECTION_FAILED'
    )
      throw new Error(
        'Execution Run recovery is uncertain or output collection failed. Reconcile the exact accepted Prompt before resuming; automatic re-submission is disabled.',
      );
    const placeholder: PreflightResult = {
      state: 'READY',
      plannedImages: run.snapshot.preflight.plannedImages,
      targetImages: run.snapshot.preflight.targetImages,
      blocking: [],
      warnings: [],
      sections: [],
    };
    await ports.verifyWorkflow(run);
    const before = await ports.capture(placeholder);
    if (!sameSnapshot(run.snapshot, before))
      throw new Error(
        'Execution cannot resume: Project inputs no longer match this immutable Run. The old graph is preserved but the changed model/preflight environment cannot be used for automatic Resume.',
      );
    const preflight = await preflightProvider();
    if (preflight.state !== 'READY')
      throw new Error(
        `Execution cannot resume: Preflight is BLOCKED: ${preflight.blocking.map((item) => item.message).join(' / ')}`,
      );
    const after = await ports.capture(preflight);
    if (!sameSnapshot(run.snapshot, after))
      throw new Error(
        'Execution cannot resume: Workflow/API graph or Prompt Plan changed during validation.',
      );
    const checked = validateEvidence(run, ports.hash),
      decision = resumePhase(run, checked.valid),
      now = ports.now();
    const next: ExecutionRun = {
      ...run,
      lifecycle: decision.lifecycle,
      phase: decision.phase,
      controls: {
        scheduling: 'ACTIVE',
        interrupt: 'IDLE',
        stopSchedulingRequestedAt: null,
        forceInterruptRequestedAt: null,
      },
      progress: {
        ...run.progress,
        generationTiming: {
          currentPromptId: null,
          currentStartedAt: null,
          recentDurationsMs: [...(run.progress.generationTiming?.recentDurationsMs ?? [])].slice(
            -5,
          ),
        },
      },
      error: null,
      resume: {
        attempts: run.resume.attempts + 1,
        lastAttemptAt: now,
        lastValidatedEvidenceIds: checked.valid.map((item) => item.id),
        lastIgnoredEvidenceIds: checked.invalid,
        lastDecisionPhase: decision.phase,
      },
      updatedAt: now,
      completedAt: decision.lifecycle === 'COMPLETED' ? (run.completedAt ?? now) : null,
    };
    await ports.write(next);
    await ports.setCurrent(runId);
    return next;
  });
}
