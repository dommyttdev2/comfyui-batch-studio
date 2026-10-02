import { enumerateImageTasks, graphToWorkflow } from './image-tasks.js';
import { randomUUID, randomInt } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type {
  ExecutionEvidence,
  ExecutionEvidenceKind,
  ModelsArtifact,
  ExecutionPhase,
  ExecutionRun,
  ExecutionRunLifecycle,
  ExecutionRunSnapshot,
  PreflightResult,
  PromptPlanArtifact,
} from '../shared/types.js';
import { readJson, restoreJsonFromBackup, writeJsonAtomic } from './fs-utils.js';
import { readProjectMeta } from './project-meta.js';
import {
  hashCanonicalJson,
  hashWorkflowModelInputs,
  validateApiGraphStructure,
  type ApiGraph,
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
function initialPhase(target: 'local' | 'remote'): ExecutionPhase {
  return target === 'remote' ? 'CLOUD_INSTANCE_RESOLVING' : 'LOCAL_COMFYUI_CONNECTING';
}
function terminalLifecycle(lifecycle: ExecutionRunLifecycle) {
  return lifecycle === 'FAILED' || lifecycle === 'COMPLETED' || lifecycle === 'DISCARDED';
}
function resumableLifecycle(lifecycle: ExecutionRunLifecycle) {
  return lifecycle === 'PAUSED' || lifecycle === 'INTERRUPTED' || lifecycle === 'FAILED';
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

function assertPersistSafe(value: unknown, keyPath = 'run') {
  if (typeof value === 'string') {
    if (
      /-----BEGIN [^-]*PRIVATE KEY-----/i.test(value) ||
      /[?&](?:X-Amz-(?:Credential|Signature|Security-Token)|AWSAccessKeyId|Signature|sig|token)=/i.test(
        value,
      )
    )
      throw new Error(`Execution Run contains sensitive value at ${keyPath}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertPersistSafe(item, `${keyPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      /api.?key|secret|credential|private.?key|authorization|presigned.?url|signed.?url|cloudflare.?token/i.test(
        key,
      )
    )
      throw new Error(`Execution Run contains forbidden field: ${keyPath}.${key}`);
    assertPersistSafe(item, `${keyPath}.${key}`);
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
  const uiPath = String(build?.outputs?.ui?.path ?? build?.outputPath ?? '');
  const apiPath = String(build?.outputs?.api?.path ?? build?.apiOutputPath ?? '');
  const expectedUiSha = String(build?.outputs?.ui?.sha256 ?? '');
  const expectedApiSha = String(build?.outputs?.api?.sha256 ?? '');
  const expectedIdentity = String(build?.workflowIdentity ?? '');
  const expectedModelsSha = String(build?.modelsSha256 ?? '');
  if (!uiPath || !apiPath || !expectedUiSha || !expectedApiSha || !expectedIdentity)
    throw new Error('Execution cannot start: Workflow/API graph provenance is missing.');
  const ui = await readJson<unknown>(path.join(root, uiPath)),
    api = await readJson<unknown>(path.join(root, apiPath));
  if (!ui || !api) throw new Error('Execution cannot start: Workflow/API graph file is missing.');
  const apiIssues = validateApiGraphStructure(api).filter((issue) => issue.severity === 'error');
  if (apiIssues.length)
    throw new Error(
      `Execution cannot start: API graph is invalid: ${apiIssues.map((issue) => issue.message).join(' / ')}`,
    );
  const uiSha256 = hashCanonicalJson(ui),
    apiSha256 = hashCanonicalJson(api),
    workflowIdentity = hashCanonicalJson({ uiSha256, apiSha256 });
  if (
    uiSha256 !== expectedUiSha ||
    apiSha256 !== expectedApiSha ||
    workflowIdentity !== expectedIdentity
  )
    throw new Error('Execution cannot start/resume: Workflow/API graph is stale.');
  const models = await readJson<unknown>(path.join(root, 'models.json'));
  if (
    !models ||
    !expectedModelsSha ||
    hashWorkflowModelInputs(models as ModelsArtifact) !== expectedModelsSha
  )
    throw new Error('Execution cannot start/resume: WORKFLOW_MODEL_STALE (models.json changed).');
  const brief = await readJson<any>(path.join(root, 'project_brief.json'));
  if (!brief?.project?.id) throw new Error('Execution cannot start: project.id is missing.');
  const plan = await readJson<PromptPlanArtifact>(path.join(root, 'prompt_plan.json'));
  if (!plan) throw new Error('Execution cannot start: prompt_plan.json is missing.');
  const target = meta?.settings.executionTarget === 'remote' ? 'remote' : 'local';
  const promptPlanSha256 = hashCanonicalJson(plan);
  enumerateImageTasks(
    api as ApiGraph,
    {
      snapshot: {
        plan: {
          branches: plan.branches.map((branch) => ({
            branchId: branch.id,
            leafIds: branch.leaves.map((leaf) => leaf.id),
          })),
        },
      },
    } as any,
  );
  const planSnapshot = {
    sha256: promptPlanSha256,
    branches: plan.branches.map((branch) => ({
      branchId: branch.id,
      leafIds: branch.leaves.map((leaf) => leaf.id),
    })),
  };
  const remote =
    target === 'remote'
      ? {
          provider: meta?.settings.remoteProvider ?? null,
          instanceId: meta?.settings.remoteInstanceId ?? null,
        }
      : null;
  const runIdentity = hashCanonicalJson({
    projectId: brief.project.id,
    target,
    workflowIdentity,
    apiSha256,
    promptPlanSha256,
    modelsSha256: expectedModelsSha,
  });
  return {
    projectId: String(brief.project.id),
    target,
    remote,
    preflight: clone(preflight),
    workflow: {
      uiPath,
      apiPath,
      uiSha256,
      apiSha256,
      workflowIdentity,
      modelsSha256: expectedModelsSha,
    },
    plan: planSnapshot,
    runIdentity,
  };
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
  const { workflow } = run.snapshot;
  if (!workflow.sourceWorkflowIdentity || !workflow.immutable)
    throw new Error(
      'STANDARD_RUN_REQUIRED: 旧Runは再開できません。Workflowを再生成し、新Runを作成してください。',
    );
  const ui = await readJson<unknown>(path.join(root, workflow.uiPath));
  const api = await readJson<unknown>(path.join(root, workflow.apiPath));
  if (!ui || !api)
    throw new Error(
      'EXECUTION_SNAPSHOT_MISSING: saved Run workflow is absent; project files cannot replace it.',
    );
  const uiSha256 = hashCanonicalJson(ui),
    apiSha256 = hashCanonicalJson(api);
  if (
    uiSha256 !== workflow.uiSha256 ||
    apiSha256 !== workflow.apiSha256 ||
    hashCanonicalJson({ uiSha256, apiSha256 }) !== workflow.workflowIdentity
  )
    throw new Error(
      `EXECUTION_SNAPSHOT_HASH_MISMATCH: saved Run workflow was modified. UI expected=${workflow.uiSha256} actual=${uiSha256}; API expected=${workflow.apiSha256} actual=${apiSha256}; identity expected=${workflow.workflowIdentity} actual=${hashCanonicalJson({ uiSha256, apiSha256 })}. The original Run snapshot must be restored; never rewrite expected hashes.`,
    );
  if (workflow.immutable) {
    const plan = await readJson<unknown>(path.join(root, workflow.immutable.planPath));
    const models = await readJson<unknown>(path.join(root, workflow.immutable.modelsPath));
    if (
      !plan ||
      !models ||
      hashCanonicalJson(plan) !== run.snapshot.plan.sha256 ||
      hashWorkflowModelInputs(models as ModelsArtifact) !== workflow.modelsSha256
    )
      throw new Error(
        'EXECUTION_SNAPSHOT_HASH_MISMATCH: saved Run Prompt Plan or model identity is absent or modified.',
      );
  }
  enumerateImageTasks(api as ApiGraph, run);
  return { ui, api: api as ApiGraph };
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
  const seededApi = structuredClone(api) as ApiGraph;
  for (const node of Object.values(seededApi))
    if (node.class_type === 'KSampler') node.inputs.seed = randomInt(0, 2 ** 48 - 1);
  const seededUi = graphToWorkflow(seededApi);
  const seededUiSha = hashCanonicalJson(seededUi),
    seededApiSha = hashCanonicalJson(seededApi);
  const dir = path.join(root, RUNS_DIR, runId, 'snapshot');
  try {
    await writeJsonAtomic(path.join(root, paths.uiPath), seededUi);
    await writeJsonAtomic(path.join(root, paths.apiPath), seededApi);
    await writeJsonAtomic(path.join(root, paths.planPath), plan);
    await writeJsonAtomic(path.join(root, paths.modelsPath), models);
    const next: ExecutionRunSnapshot = {
      ...snapshot,
      workflow: {
        ...snapshot.workflow,
        sourceWorkflowIdentity: snapshot.workflow.workflowIdentity,
        uiSha256: seededUiSha,
        apiSha256: seededApiSha,
        workflowIdentity: hashCanonicalJson({ uiSha256: seededUiSha, apiSha256: seededApiSha }),
        uiPath: paths.uiPath,
        apiPath: paths.apiPath,
        immutable: { planPath: paths.planPath, modelsPath: paths.modelsPath },
      },
    };
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

function sameSnapshot(a: ExecutionRunSnapshot, b: ExecutionRunSnapshot) {
  return (
    a.runIdentity === b.runIdentity &&
    (a.workflow.sourceWorkflowIdentity ?? a.workflow.workflowIdentity) ===
      (b.workflow.sourceWorkflowIdentity ?? b.workflow.workflowIdentity) &&
    a.workflow.modelsSha256 === b.workflow.modelsSha256 &&
    a.plan.sha256 === b.plan.sha256
  );
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
  const valid: ExecutionEvidence[] = [],
    invalid: string[] = [];
  for (const evidence of run.evidence) {
    const expected = hashCanonicalJson({
      runIdentity: run.snapshot.runIdentity,
      kind: evidence.kind,
      scope: evidence.scope,
      data: evidence.data ?? {},
    });
    if (evidence.runIdentity === run.snapshot.runIdentity && evidence.fingerprint === expected)
      valid.push(evidence);
    else invalid.push(evidence.id);
  }
  return { valid, invalid };
}

function resumePhase(
  run: ExecutionRun,
  evidence: ExecutionEvidence[],
): { phase: ExecutionPhase; lifecycle: ExecutionRunLifecycle } {
  const kinds = new Set(evidence.map((item) => item.kind));
  if (
    run.executionTarget === 'remote' &&
    kinds.has('LOCAL_FILE_VERIFIED') &&
    !kinds.has('CLEANUP_COMPLETED')
  )
    return { phase: 'REMOTE_CLEANUP', lifecycle: 'RUNNING' };
  if (
    run.executionTarget === 'remote' &&
    kinds.has('LOCAL_FILE_VERIFIED') &&
    kinds.has('CLEANUP_COMPLETED') &&
    (!run.remoteLifecycle?.finalizedAt || run.remoteLifecycle.latest?.status !== 'stopped')
  )
    return { phase: 'CLOUD_INSTANCE_FINALIZING', lifecycle: 'RUNNING' };
  if (kinds.has('LOCAL_FILE_VERIFIED')) return { phase: 'COMPLETED', lifecycle: 'COMPLETED' };
  if (run.executionTarget === 'remote' && kinds.has('R2_OBJECT_VERIFIED'))
    return { phase: 'LOCAL_DOWNLOADING', lifecycle: 'RUNNING' };
  if (run.executionTarget === 'remote' && kinds.has('PACKAGE_VERIFIED'))
    return { phase: 'R2_UPLOAD_URL_ISSUED', lifecycle: 'RUNNING' };
  if (kinds.has('EXECUTION_COMPLETED'))
    return {
      phase: run.executionTarget === 'remote' ? 'ARTIFACTS_COLLECTING' : 'LOCAL_OUTPUT_VERIFYING',
      lifecycle: 'RUNNING',
    };
  if (kinds.has('MODELS_VERIFIED')) return { phase: 'WORKFLOW_PREPARING', lifecycle: 'RUNNING' };
  return { phase: initialPhase(run.executionTarget), lifecycle: 'RUNNING' };
}

export async function startExecutionRun(
  root: string,
  preflightProvider: PreflightProvider,
): Promise<ExecutionRun> {
  return withProjectLock(root, async () => {
    const current = await getCurrentExecutionRun(root);
    if (current?.error?.code === 'LOCAL_OUTPUT_COLLECTION_FAILED')
      throw new Error(
        '生成済みPromptの画像回収が未確定です。「既存Runの状態を再確認」または安全なRun破棄を行ってください。',
      );
    if (current && !terminalLifecycle(current.lifecycle))
      throw new Error(`Execution Run ${current.runId} is already active for this project.`);
    const before = await captureSnapshot(root, {
      state: 'READY',
      plannedImages: 0,
      targetImages: null,
      blocking: [],
      warnings: [],
      sections: [],
    });
    const preflight = await preflightProvider();
    if (preflight.state !== 'READY')
      throw new Error(
        `Execution cannot start: Preflight is BLOCKED: ${preflight.blocking.map((item) => item.message).join(' / ')}`,
      );
    const snapshot = await captureSnapshot(root, preflight);
    if (!sameSnapshot(before, snapshot))
      throw new Error(
        'Execution cannot start: Workflow/API graph or Prompt Plan changed during Preflight.',
      );
    const now = new Date().toISOString(),
      runId = randomUUID();
    const stable = await persistRunSnapshot(root, runId, snapshot);
    // Compilers and reset operations may not share this project's Run lock.
    // A second provenance capture catches changes during the copy phase.
    const postCopy = await captureSnapshot(root, preflight);
    if (!sameSnapshot(snapshot, postCopy)) {
      await rm(path.join(root, RUNS_DIR, runId), { recursive: true, force: true });
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
    await writeRun(root, run);
    await writeCurrent(root, runId);
    return run;
  });
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
  if (!Number.isInteger(replacementInstanceId) || replacementInstanceId < 1)
    throw new Error('Invalid replacement Vast.ai Instance ID.');
  return mutateExecutionRun(root, runId, (run) => {
    if (
      run.executionTarget !== 'remote' ||
      run.remote?.provider !== 'vastai' ||
      !Number.isInteger(run.remote.instanceId) ||
      Number(run.remote.instanceId) < 1
    )
      throw new Error('Execution Run is not a Vast.ai Remote Run.');
    if (Number(run.remote.instanceId) === replacementInstanceId)
      throw new Error('Replacement Instance must differ from the current Run Instance.');
    if (terminalLifecycle(run.lifecycle))
      throw new Error(`Execution Run ${runId} is already terminal.`);
    const at = new Date().toISOString();
    const e = {
      code: 'REMOTE_INSTANCE_REPLACED',
      message: `Execution Run was superseded by Vast.ai Instance ${replacementInstanceId}; original Instance ${run.remote.instanceId} is preserved in this Run history.`,
      phase: run.phase,
      at,
      retryable: false,
    };
    run.error = e;
    run.errorHistory.push(e);
    run.lifecycle = 'FAILED';
    run.controls.scheduling = 'STOPPED';
    run.controls.interrupt = 'IDLE';
    run.controls.stopSchedulingRequestedAt = null;
    run.controls.forceInterruptRequestedAt = null;
    run.current.promptId = null;
  });
}

export async function discardExecutionRun(root: string, runId: string): Promise<ExecutionRun> {
  return mutateExecutionRun(root, runId, (run) => {
    if (run.lifecycle === 'DISCARDED') return;
    const at = new Date().toISOString();
    const e = {
      code: 'EXECUTION_RUN_DISCARDED',
      message:
        'Execution Run was discarded. Locally generated and collected artifacts are preserved.',
      phase: run.phase,
      at,
      retryable: false,
    };
    run.error = e;
    run.errorHistory.push(e);
    run.lifecycle = 'DISCARDED';
    run.controls.scheduling = 'STOPPED';
    run.controls.interrupt = 'INTERRUPTED';
    run.controls.stopSchedulingRequestedAt = null;
    run.controls.forceInterruptRequestedAt = null;
    run.current = { branchId: null, leafId: null, promptId: null };
    if (run.progress.generationTiming) {
      run.progress.generationTiming.currentPromptId = null;
      run.progress.generationTiming.currentStartedAt = null;
    }
    run.completedAt = at;
  });
}

export async function requestStopScheduling(root: string, runId: string): Promise<ExecutionRun> {
  return mutateExecutionRun(root, runId, (run) => {
    if (run.lifecycle !== 'RUNNING') throw new Error(`Execution Run ${runId} is not running.`);
    if (run.controls.scheduling === 'ACTIVE') {
      run.controls.scheduling = 'STOP_REQUESTED';
      run.controls.stopSchedulingRequestedAt = new Date().toISOString();
    }
  });
}

export async function requestForceInterrupt(root: string, runId: string): Promise<ExecutionRun> {
  return mutateExecutionRun(root, runId, (run) => {
    if (run.lifecycle !== 'RUNNING') throw new Error(`Execution Run ${runId} is not running.`);
    if (run.controls.interrupt === 'IDLE') {
      run.controls.interrupt = 'FORCE_REQUESTED';
      run.controls.forceInterruptRequestedAt = new Date().toISOString();
    }
  });
}

export async function resumeExecutionRunFinalization(
  root: string,
  runId: string,
): Promise<ExecutionRun> {
  return withProjectLock(root, async () => {
    const run = await getExecutionRun(root, runId);
    if (!run) throw new Error(`Execution Run ${runId} was not found.`);
    if (
      run.lifecycle !== 'FAILED' ||
      run.executionTarget !== 'remote' ||
      run.remote?.provider !== 'vastai' ||
      run.error?.code !== 'REMOTE_INSTANCE_FINALIZE_FAILED' ||
      run.remoteLifecycle?.finalizedAt
    )
      throw new Error('This Execution Run has no pending Vast.ai stop finalization to retry.');
    const verified = validatedExecutionEvidence(run);
    const kinds = new Set(verified.valid.map((item) => item.kind));
    if (!kinds.has('LOCAL_FILE_VERIFIED') || !kinds.has('CLEANUP_COMPLETED'))
      throw new Error(
        'Cannot retry only finalization before artifacts were delivered and cleaned.',
      );
    const now = new Date().toISOString();
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
  return withProjectLock(root, async () => {
    const run = await getExecutionRun(root, runId);
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
    await readExecutionWorkflow(root, run);
    const before = await captureSnapshot(root, placeholder);
    if (!sameSnapshot(run.snapshot, before))
      throw new Error(
        'Execution cannot resume: Project inputs no longer match this immutable Run. The old graph is preserved but the changed model/preflight environment cannot be used for automatic Resume.',
      );
    const preflight = await preflightProvider();
    if (preflight.state !== 'READY')
      throw new Error(
        `Execution cannot resume: Preflight is BLOCKED: ${preflight.blocking.map((item) => item.message).join(' / ')}`,
      );
    const after = await captureSnapshot(root, preflight);
    if (!sameSnapshot(run.snapshot, after))
      throw new Error(
        'Execution cannot resume: Workflow/API graph or Prompt Plan changed during validation.',
      );
    const checked = validatedExecutionEvidence(run),
      decision = resumePhase(run, checked.valid),
      now = new Date().toISOString();
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
    await writeRun(root, next);
    await writeCurrent(root, runId);
    return next;
  });
}
