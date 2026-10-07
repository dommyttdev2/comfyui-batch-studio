import { randomInt, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, readdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { createExecutionRun, sameSnapshot } from '../application/execution-creation.js';
import { resumeReservedExecution } from '../application/execution-resumption.js';
import { validatedExecutionEvidence as validateEvidence } from '../domain/execution-evidence.js';
import { resumeFinalization } from '../domain/execution-finalization-policy.js';
import {
  abandonRunForRemoteReplacement,
  discardRun,
  requestForceInterruptPolicy,
  requestStopSchedulingPolicy,
} from '../domain/execution-mutation-policy.js';
import { assertPersistSafe } from '../domain/execution-record-policy.js';
import { resumePhase } from '../domain/execution-resume.js';
import { captureExecutionSnapshot } from '../domain/execution-snapshot-capture.js';
import { seedExecutionSnapshot } from '../domain/execution-snapshot-policy.js';
import { verifyExecutionWorkflow } from '../domain/execution-workflow-policy.js';
import type {
  ExecutionEvidence,
  ExecutionEvidenceKind,
  ExecutionPhase,
  ExecutionRun,
  ExecutionRunLifecycle,
  ExecutionRunSnapshot,
  ModelsArtifact,
  PreflightResult,
  PromptPlanArtifact,
} from '../shared/types.js';
import { readJson, restoreJsonFromBackup, writeJsonAtomic } from './fs-utils.js';
import { enumerateImageTasks, graphToWorkflow } from './image-tasks.js';
import { readProjectMeta } from './project-meta.js';
import {
  type ApiGraph,
  hashCanonicalJson,
  hashWorkflowModelInputs,
  validateApiGraphStructure,
} from './workflow-api.js';

const RUNS_DIR = 'execution_runs';
const CURRENT_FILE = 'current.json';
const runLocks = new Map<string, Promise<void>>();

type PreflightProvider = () => Promise<PreflightResult>;
export type ExecutionEvidenceInput = {
  kind: ExecutionEvidenceKind;
  scope: string;
  data?: Record<string, string | number | boolean | null>;
};

function executionRunsDir(root: string) {
  return path.join(root, RUNS_DIR);
}
function executionRunPath(root: string, runId: string) {
  assertRunId(runId);
  return path.join(executionRunsDir(root), `${runId}.json`);
}
function currentRunPath(root: string) {
  return path.join(executionRunsDir(root), CURRENT_FILE);
}
function assertRunId(runId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId))
    throw new Error('Invalid Execution Run ID');
}
function clone<T>(value: T): T {
  return structuredClone(value);
}

async function withProjectLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const key = path.resolve(root),
    previous = runLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  runLocks.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (runLocks.get(key) === tail) runLocks.delete(key);
  }
}

async function writeRun(root: string, run: ExecutionRun) {
  assertPersistSafe(run);
  await writeJsonAtomic(executionRunPath(root, run.runId), run);
}

async function writeCurrent(root: string, runId: string) {
  assertRunId(runId);
  await writeJsonAtomic(currentRunPath(root), { schemaVersion: 1, runId });
}

export async function getExecutionRun(root: string, runId: string): Promise<ExecutionRun | null> {
  const file = executionRunPath(root, runId);
  const run = await readJson<ExecutionRun>(file);
  if (run !== null && (!run || run.runId !== runId || typeof run.lifecycle !== 'string'))
    throw new ExecutionRunStorageError([
      { runId, file, backupFile: `${file}.bak`, reason: 'Invalid Run structure' },
    ]);
  return run;
}

export type ExecutionRunStorageDiagnostic = {
  runId: string | null;
  file: string;
  backupFile: string;
  reason: string;
};

export class ExecutionRunStorageError extends Error {
  constructor(public readonly diagnostics: ExecutionRunStorageDiagnostic[]) {
    super(
      `Runの保存データを読み取れません。新規実行と編集を停止しました: ${diagnostics.map((item) => `${item.runId ?? '一覧'}: ${item.file} (${item.reason})`).join(', ')}。元ファイルを保持し、検証済みの .bak から復元した後に再読み込みしてください。`,
    );
    this.name = 'ExecutionRunStorageError';
  }
}

export async function listExecutionRuns(root: string): Promise<ExecutionRun[]> {
  let names: string[] = [];
  try {
    names = (await readdir(executionRunsDir(root))).filter(
      (name) => name.endsWith('.json') && name !== CURRENT_FILE,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    const file = executionRunsDir(root);
    throw new ExecutionRunStorageError([
      {
        runId: null,
        file,
        backupFile: '',
        reason: String((error as NodeJS.ErrnoException).code ?? 'directory unreadable'),
      },
    ]);
  }
  const results = await Promise.all(
    names.map(async (name) => {
      const runId = name.replace(/\.json$/, '');
      const file = path.join(executionRunsDir(root), name);
      try {
        const run = await getExecutionRun(root, runId);
        if (run === null) throw new Error('Run file disappeared during scan');
        return { run, diagnostic: null };
      } catch (error) {
        return {
          run: null,
          diagnostic:
            error instanceof ExecutionRunStorageError
              ? error.diagnostics[0]
              : {
                  runId,
                  file,
                  backupFile: `${file}.bak`,
                  reason: String((error as NodeJS.ErrnoException).code ?? 'corrupt or unreadable'),
                },
        };
      }
    }),
  );
  const diagnostics = results.flatMap((result) => (result.diagnostic ? [result.diagnostic] : []));
  if (diagnostics.length) throw new ExecutionRunStorageError(diagnostics);
  const runs = results
    .map((result) => result.run)
    .filter((run): run is ExecutionRun => Boolean(run));
  return runs.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
}

export async function getCurrentExecutionRun(root: string): Promise<ExecutionRun | null> {
  // Scan every Run before trusting the current pointer: an older damaged Run may
  // still own an active worker or remote instance.
  const runs = await listExecutionRuns(root);
  let pointer: { schemaVersion: 1; runId: string } | null;
  try {
    pointer = await readJson<{ schemaVersion: 1; runId: string }>(currentRunPath(root));
  } catch (error) {
    const file = currentRunPath(root);
    throw new ExecutionRunStorageError([
      {
        runId: null,
        file,
        backupFile: `${file}.bak`,
        reason: String((error as NodeJS.ErrnoException).code ?? 'corrupt or unreadable'),
      },
    ]);
  }
  if (pointer !== null) {
    const file = currentRunPath(root);
    if (pointer.schemaVersion !== 1 || typeof pointer.runId !== 'string')
      throw new ExecutionRunStorageError([
        { runId: null, file, backupFile: `${file}.bak`, reason: 'Invalid current pointer' },
      ]);
    const run = runs.find((item) => item.runId === pointer.runId);
    if (!run)
      throw new ExecutionRunStorageError([
        { runId: pointer.runId, file, backupFile: `${file}.bak`, reason: 'Current Run is missing' },
      ]);
    return run;
  }
  return runs[0] ?? null;
}

// Status polling reads only the current pointer and Run after a full reconciliation.
export async function getCurrentExecutionRunFast(
  root: string,
  fallbackRunId: string | null,
): Promise<ExecutionRun | null> {
  const file = currentRunPath(root);
  let pointer: { schemaVersion: 1; runId: string } | null;
  try {
    pointer = await readJson<{ schemaVersion: 1; runId: string }>(file);
  } catch (error) {
    throw new ExecutionRunStorageError([
      {
        runId: null,
        file,
        backupFile: `${file}.bak`,
        reason: String((error as NodeJS.ErrnoException).code ?? 'corrupt or unreadable'),
      },
    ]);
  }
  if (pointer !== null && (pointer.schemaVersion !== 1 || typeof pointer.runId !== 'string'))
    throw new ExecutionRunStorageError([
      { runId: null, file, backupFile: `${file}.bak`, reason: 'Invalid current pointer' },
    ]);
  const runId = pointer?.runId ?? fallbackRunId;
  if (!runId) return null;
  const run = await getExecutionRun(root, runId);
  if (!run)
    throw new ExecutionRunStorageError([
      { runId, file, backupFile: `${file}.bak`, reason: 'Current Run is missing' },
    ]);
  return run;
}

export async function inspectExecutionRunStorage(
  root: string,
): Promise<ExecutionRunStorageDiagnostic[]> {
  try {
    await getCurrentExecutionRun(root);
    return [];
  } catch (error) {
    if (error instanceof ExecutionRunStorageError) return error.diagnostics;
    throw error;
  }
}

/** Explicit recovery keeps the damaged original under a unique name for inspection. */
export async function restoreExecutionRunBackup(root: string, runId: string | null) {
  const diagnostics = await inspectExecutionRunStorage(root);
  const diagnostic = diagnostics.find((item) => item.runId === runId);
  if (!diagnostic || !diagnostic.backupFile)
    throw new Error('復元対象のRunが見つかりません。再読み込みしてください。');
  const file = runId === null ? currentRunPath(root) : executionRunPath(root, runId);
  if (diagnostic.file !== file) throw new Error('復元対象のパスが一致しません。');
  const backup = await readFile(diagnostic.backupFile, 'utf8');
  let value: unknown;
  try {
    value = JSON.parse(backup);
  } catch {
    throw new Error('バックアップが破損しています。元のRunは変更していません。');
  }
  if (runId === null) {
    const pointer = value as { schemaVersion?: unknown; runId?: unknown };
    if (pointer?.schemaVersion !== 1 || typeof pointer.runId !== 'string')
      throw new Error('バックアップのcurrentポインタが不正です。');
    assertRunId(pointer.runId);
  } else {
    const run = value as Partial<ExecutionRun>;
    if (run?.runId !== runId || typeof run.lifecycle !== 'string')
      throw new Error('バックアップのRun IDまたは形式が一致しません。');
  }
  try {
    await copyFile(file, `${file}.corrupt-${randomUUID()}`, constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await restoreJsonFromBackup(file);
  return inspectExecutionRunStorage(root);
}

async function captureSnapshot(
  root: string,
  preflight: PreflightResult,
): Promise<ExecutionRunSnapshot> {
  const meta = await readProjectMeta(root),
    build = meta?.workflowBuild as any;
  const uiPath = String(build?.outputs?.ui?.path ?? build?.outputPath ?? ''),
    apiPath = String(build?.outputs?.api?.path ?? build?.apiOutputPath ?? '');
  const [ui, api, models, plan, brief] = await Promise.all([
    readJson<unknown>(path.join(root, uiPath)),
    readJson<unknown>(path.join(root, apiPath)),
    readJson<ModelsArtifact>(path.join(root, 'models.json')),
    readJson<PromptPlanArtifact>(path.join(root, 'prompt_plan.json')),
    readJson<any>(path.join(root, 'project_brief.json')),
  ]);
  const target = meta?.settings.executionTarget === 'remote' ? 'remote' : 'local';
  return captureExecutionSnapshot(
    {
      projectId: String(brief?.project?.id ?? ''),
      target,
      remote:
        target === 'remote'
          ? {
              provider: meta?.settings.remoteProvider ?? null,
              instanceId: meta?.settings.remoteInstanceId ?? null,
            }
          : null,
      uiPath,
      apiPath,
      expectedUiSha: String(build?.outputs?.ui?.sha256 ?? ''),
      expectedApiSha: String(build?.outputs?.api?.sha256 ?? ''),
      expectedIdentity: String(build?.workflowIdentity ?? ''),
      expectedModelsSha: String(build?.modelsSha256 ?? ''),
      ui,
      api,
      models,
      plan,
    },
    preflight,
    hashCanonicalJson,
  );
}

function runSnapshotPaths(runId: string) {
  assertRunId(runId);
  const base = path.posix.join(RUNS_DIR, runId, 'snapshot');
  return {
    uiPath: path.posix.join(base, 'workflow-ui.json'),
    apiPath: path.posix.join(base, 'workflow-api.json'),
    planPath: path.posix.join(base, 'prompt-plan.json'),
    modelsPath: path.posix.join(base, 'models.json'),
  };
}

function requireRunOwnedSnapshot(run: ExecutionRun) {
  const immutable = run.snapshot.workflow.immutable;
  if (!immutable) return;
  const expected = runSnapshotPaths(run.runId);
  if (
    run.snapshot.workflow.uiPath !== expected.uiPath ||
    run.snapshot.workflow.apiPath !== expected.apiPath ||
    immutable.planPath !== expected.planPath ||
    immutable.modelsPath !== expected.modelsPath
  )
    throw new Error(
      'EXECUTION_SNAPSHOT_PATH_INVALID: Run snapshot must belong to its original Run ID.',
    );
}

// Every graph consumer verifies the Run's recorded hashes before executing.
// Only the standard contract with an immutable, seeded snapshot can execute.
export async function readExecutionWorkflow(root: string, run: ExecutionRun) {
  requireRunOwnedSnapshot(run);
  const workflow = run.snapshot.workflow;
  const [ui, api, plan, models] = await Promise.all([
    readJson<unknown>(path.join(root, workflow.uiPath)),
    readJson<unknown>(path.join(root, workflow.apiPath)),
    workflow.immutable ? readJson<unknown>(path.join(root, workflow.immutable.planPath)) : null,
    workflow.immutable ? readJson<unknown>(path.join(root, workflow.immutable.modelsPath)) : null,
  ]);
  return verifyExecutionWorkflow(run, { ui, api, plan, models }, hashCanonicalJson);
}

// Capture the validated graph and its semantic inputs into a Run-owned
// directory. Never re-use a Project output file during Local/Remote execution.
async function persistRunSnapshot(
  root: string,
  runId: string,
  snapshot: ExecutionRunSnapshot,
): Promise<ExecutionRunSnapshot> {
  const paths = runSnapshotPaths(runId);
  const [ui, api, plan, models] = await Promise.all([
    readJson<unknown>(path.join(root, snapshot.workflow.uiPath)),
    readJson<unknown>(path.join(root, snapshot.workflow.apiPath)),
    readJson<unknown>(path.join(root, 'prompt_plan.json')),
    readJson<unknown>(path.join(root, 'models.json')),
  ]);
  if (
    !ui ||
    !api ||
    !plan ||
    !models ||
    hashCanonicalJson(ui) !== snapshot.workflow.uiSha256 ||
    hashCanonicalJson(api) !== snapshot.workflow.apiSha256 ||
    hashCanonicalJson(plan) !== snapshot.plan.sha256 ||
    hashWorkflowModelInputs(models as ModelsArtifact) !== snapshot.workflow.modelsSha256
  )
    throw new Error(
      'EXECUTION_SNAPSHOT_SOURCE_CHANGED: Workflow, Prompt Plan or models changed while the Run was being created.',
    );
  const seeded = seedExecutionSnapshot(
    api,
    snapshot,
    paths,
    () => randomInt(0, 2 ** 48 - 1),
    hashCanonicalJson,
  );
  const dir = path.join(root, RUNS_DIR, runId, 'snapshot');
  try {
    await writeJsonAtomic(path.join(root, paths.uiPath), seeded.ui);
    await writeJsonAtomic(path.join(root, paths.apiPath), seeded.api);
    await writeJsonAtomic(path.join(root, paths.planPath), plan);
    await writeJsonAtomic(path.join(root, paths.modelsPath), models);
    const next = seeded.snapshot;
    await readExecutionWorkflow(root, {
      runId,
      snapshot: next,
    } as ExecutionRun);
    return next;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

function evidenceFingerprint(runIdentity: string, input: ExecutionEvidenceInput) {
  return hashCanonicalJson({
    runIdentity,
    kind: input.kind,
    scope: input.scope,
    data: input.data ?? {},
  });
}

export function validatedExecutionEvidence(run: ExecutionRun) {
  return validateEvidence(run, hashCanonicalJson);
}

export async function startExecutionRun(
  root: string,
  preflightProvider: PreflightProvider,
): Promise<ExecutionRun> {
  return createExecutionRun(
    {
      exclusive: (work) => withProjectLock(root, work),
      current: () => getCurrentExecutionRun(root),
      capture: (preflight) => captureSnapshot(root, preflight),
      persistSnapshot: (runId, snapshot) => persistRunSnapshot(root, runId, snapshot),
      removeSnapshot: (runId) =>
        rm(path.join(root, RUNS_DIR, runId), { recursive: true, force: true }),
      write: (run) => writeRun(root, run),
      setCurrent: (runId) => writeCurrent(root, runId),
      now: () => new Date().toISOString(),
      nextId: randomUUID,
    },
    preflightProvider,
  );
}

export async function mutateExecutionRun(
  root: string,
  runId: string,
  mutator: (run: ExecutionRun) => ExecutionRun | void,
): Promise<ExecutionRun> {
  return withProjectLock(root, async () => {
    const current = await getExecutionRun(root, runId);
    if (!current) throw new Error(`Execution Run ${runId} was not found.`);
    const working = clone(current),
      result = mutator(working),
      next = (result ?? working) as ExecutionRun;
    next.updatedAt = new Date().toISOString();
    if (next.lifecycle === 'COMPLETED' && !next.completedAt) next.completedAt = next.updatedAt;
    await writeRun(root, next);
    return next;
  });
}

export async function recordExecutionEvidence(
  root: string,
  runId: string,
  input: ExecutionEvidenceInput,
): Promise<ExecutionRun> {
  assertPersistSafe(input, 'evidence');
  return mutateExecutionRun(root, runId, (run) => {
    const evidence: ExecutionEvidence = {
      id: randomUUID(),
      kind: input.kind,
      scope: input.scope,
      runIdentity: run.snapshot.runIdentity,
      fingerprint: evidenceFingerprint(run.snapshot.runIdentity, input),
      recordedAt: new Date().toISOString(),
      data: input.data ?? {},
    };
    run.evidence.push(evidence);
  });
}

export async function abandonExecutionRunForRemoteReplacement(
  root: string,
  runId: string,
  replacementInstanceId: number,
): Promise<ExecutionRun> {
  return mutateExecutionRun(root, runId, (run) =>
    abandonRunForRemoteReplacement(run, replacementInstanceId, new Date().toISOString()),
  );
}

export async function discardExecutionRun(root: string, runId: string): Promise<ExecutionRun> {
  return mutateExecutionRun(root, runId, (run) => discardRun(run, new Date().toISOString()));
}

export async function requestStopScheduling(root: string, runId: string): Promise<ExecutionRun> {
  return mutateExecutionRun(root, runId, (run) =>
    requestStopSchedulingPolicy(run, new Date().toISOString()),
  );
}

export async function requestForceInterrupt(root: string, runId: string): Promise<ExecutionRun> {
  return mutateExecutionRun(root, runId, (run) =>
    requestForceInterruptPolicy(run, new Date().toISOString()),
  );
}

export async function resumeExecutionRunFinalization(
  root: string,
  runId: string,
): Promise<ExecutionRun> {
  return withProjectLock(root, async () => {
    const run = await getExecutionRun(root, runId);
    if (!run) throw new Error(`Execution Run ${runId} was not found.`);
    const next = resumeFinalization(run, new Date().toISOString(), hashCanonicalJson);
    await writeRun(root, next);
    await writeCurrent(root, runId);
    return next;
  });
}

export async function resumeExecutionRun(
  root: string,
  runId: string,
  preflightProvider: PreflightProvider,
): Promise<ExecutionRun> {
  return resumeReservedExecution(
    {
      exclusive: (work) => withProjectLock(root, work),
      load: () => getExecutionRun(root, runId),
      verifyWorkflow: (run) => readExecutionWorkflow(root, run).then(() => {}),
      capture: (result) => captureSnapshot(root, result),
      write: (run) => writeRun(root, run),
      setCurrent: (id) => writeCurrent(root, id),
      now: () => new Date().toISOString(),
      hash: hashCanonicalJson,
    },
    runId,
    preflightProvider,
  );
}
