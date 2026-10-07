import type {
  ExecutionPhase,
  ExecutionRun,
  ExecutionRunLifecycle,
  ExecutionRunSnapshot,
  PreflightResult,
} from '../domain/artifact-types.js';
import { assertProjectWritable, executionState } from '../domain/execution-policy.js';
import { assertPersistSafe } from '../domain/execution-record-policy.js';
export interface ExecutionCreationPorts {
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  current(): Promise<ExecutionRun | null>;
  capture(preflight: PreflightResult): Promise<ExecutionRunSnapshot>;
  preflight(): Promise<PreflightResult>;
  persistSnapshot(runId: string, snapshot: ExecutionRunSnapshot): Promise<ExecutionRunSnapshot>;
  removeSnapshot(runId: string): Promise<void>;
  write(run: ExecutionRun): Promise<void>;
  setCurrent(runId: string): Promise<void>;
  now(): string;
  nextId(): string;
}
function initialPhase(target: 'local' | 'remote'): ExecutionPhase {
  return target === 'remote' ? 'CLOUD_INSTANCE_RESOLVING' : 'LOCAL_COMFYUI_CONNECTING';
}
function terminalLifecycle(lifecycle: ExecutionRunLifecycle) {
  return lifecycle === 'FAILED' || lifecycle === 'COMPLETED' || lifecycle === 'DISCARDED';
}
export function sameSnapshot(a: ExecutionRunSnapshot, b: ExecutionRunSnapshot) {
  return (
    a.runIdentity === b.runIdentity &&
    (a.workflow.sourceWorkflowIdentity ?? a.workflow.workflowIdentity) ===
      (b.workflow.sourceWorkflowIdentity ?? b.workflow.workflowIdentity) &&
    a.workflow.modelsSha256 === b.workflow.modelsSha256 &&
    a.plan.sha256 === b.plan.sha256
  );
}
export async function createExecutionRun(ports: ExecutionCreationPorts): Promise<ExecutionRun> {
  return ports.exclusive(() => createReservedRun(ports));
}
async function createReservedRun(ports: ExecutionCreationPorts): Promise<ExecutionRun> {
  const current = await ports.current();
  if (current?.error?.code === 'LOCAL_OUTPUT_COLLECTION_FAILED')
    throw new Error(
      '生成済みPromptの画像回収が未確定です。「既存Runの状態を再確認」または安全なRun破棄を行ってください。',
    );
  if (current && !terminalLifecycle(current.lifecycle))
    throw new Error(`Execution Run ${current.runId} is already active for this project.`);
  if (current) assertProjectWritable([executionState(current)]);
  const before = await ports.capture({
    state: 'READY',
    plannedImages: 0,
    targetImages: null,
    blocking: [],
    warnings: [],
    sections: [],
  });
  const preflight = await ports.preflight();
  if (preflight.state !== 'READY')
    throw new Error(
      `Execution cannot start: Preflight is BLOCKED: ${preflight.blocking.map((item) => item.message).join(' / ')}`,
    );
  const snapshot = await ports.capture(preflight);
  if (!sameSnapshot(before, snapshot))
    throw new Error(
      'Execution cannot start: Workflow/API graph or Prompt Plan changed during Preflight.',
    );
  const now = ports.now(),
    runId = ports.nextId();
  assertPersistSafe(snapshot, 'snapshot');
  const stable = await ports.persistSnapshot(runId, snapshot);
  // Compilers and reset operations may not share this project's Run lock.
  // A second provenance capture catches changes during the copy phase.
  const postCopy = await ports.capture(preflight);
  if (!sameSnapshot(snapshot, postCopy)) {
    await ports.removeSnapshot(runId);
    throw new Error(
      'EXECUTION_SNAPSHOT_SOURCE_CHANGED: Project workflow changed during Run creation.',
    );
  }
  const branches = stable.plan.branches.map((branch) => ({
    branchId: branch.branchId,
    completed: 0,
    total: branch.leafIds.length,
    state: 'pending' as const,
  }));
  const run: ExecutionRun = {
    schemaVersion: 1,
    runId,
    projectId: snapshot.projectId,
    executionTarget: snapshot.target,
    remote: snapshot.remote,
    remoteLifecycle:
      snapshot.target === 'remote'
        ? {
            initialStatus: null,
            startedByBatchStudio: false,
            latest: null,
            restorePolicy: 'restore-if-started',
            restoredInitialState: false,
            finalizedAt: null,
          }
        : null,
    lifecycle: 'RUNNING',
    phase: initialPhase(snapshot.target),
    controls: {
      scheduling: 'ACTIVE',
      interrupt: 'IDLE',
      stopSchedulingRequestedAt: null,
      forceInterruptRequestedAt: null,
    },
    current: { branchId: null, leafId: null, promptId: null },
    progress: {
      overall: { completed: 0, total: preflight.plannedImages },
      branches,
      models: [],
      generationTiming: { currentPromptId: null, currentStartedAt: null, recentDurationsMs: [] },
    },
    promptIds: [],
    evidence: [],
    error: null,
    errorHistory: [],
    snapshot: stable,
    resume: {
      attempts: 0,
      lastAttemptAt: null,
      lastValidatedEvidenceIds: [],
      lastIgnoredEvidenceIds: [],
      lastDecisionPhase: null,
    },
    startedAt: now,
    updatedAt: now,
    completedAt: null,
  };
  assertPersistSafe(run);
  await ports.write(run);
  await ports.setCurrent(runId);
  return run;
}
