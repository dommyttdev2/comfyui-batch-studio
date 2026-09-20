const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-execution-run-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

(async () => {
  const execution = await load('execution-run.js');
  const progress = await load('../shared/execution-progress.js');
  const { hashCanonicalJson, hashWorkflowModelInputs } = await load('workflow-api.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-execution-project-'));
  const ui = { nodes: [{ id: 1, type: 'TestNode' }], links: [] };
  const api = { 1: { class_type: 'TestNode', inputs: {} } };
  const uiSha256 = hashCanonicalJson(ui),
    apiSha256 = hashCanonicalJson(api),
    workflowIdentity = hashCanonicalJson({ uiSha256, apiSha256 });
  writeJson(path.join(root, 'LoRA_project.json'), ui);
  writeJson(path.join(root, 'LoRA_project.api.json'), api);
  writeJson(path.join(root, 'project_brief.json'), {
    schemaVersion: 1,
    project: { id: 'execution-project', title: 'Execution' },
    subject: { copyrightedCharacter: false, characterName: '', series: '' },
    audience: 'test',
    request: 'test',
    exclusions: '',
    assumptions: { adultCharacters: true, consensual: true },
    generation: { target_image_count: 2, modelFamily: 'Illustrious' },
    references: [],
  });
  writeJson(path.join(root, 'prompt_plan.json'), {
    schemaVersion: 1,
    common: { positive: '', negative: '' },
    rootLoras: [],
    branches: [
      {
        id: 'branch-a',
        label: 'A',
        loras: [],
        leaves: [
          { id: 'leaf-a1', name: 'A1', positive: 'p1', negative: 'n1' },
          { id: 'leaf-a2', name: 'A2', positive: 'p2', negative: 'n2' },
        ],
      },
    ],
  });
  const initialModels = {
    schemaVersion: 1,
    checkpoint: { ref: 'checkpoint.main', fileName: 'model-a.safetensors' },
  };
  writeJson(path.join(root, 'models.json'), initialModels);
  writeJson(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: '2026-09-11T00:00:00.000Z',
    settings: { executionTarget: 'local' },
    workflowBuild: {
      compilerVersion: '2.1.0',
      outputPath: 'LoRA_project.json',
      apiOutputPath: 'LoRA_project.api.json',
      outputs: {
        ui: { path: 'LoRA_project.json', sha256: uiSha256 },
        api: { path: 'LoRA_project.api.json', sha256: apiSha256 },
      },
      workflowIdentity,
      modelsSha256: hashWorkflowModelInputs(initialModels),
    },
  });

  const ready = {
    state: 'READY',
    plannedImages: 2,
    targetImages: 2,
    blocking: [],
    warnings: [],
    sections: [{ name: 'Execution API graph', valid: true, issues: [] }],
  };
  const started = await execution.startExecutionRun(root, async () => ready);
  assert.match(started.runId, /^[0-9a-f-]{36}$/i);
  assert.equal(started.lifecycle, 'RUNNING');
  assert.equal(started.phase, 'LOCAL_COMFYUI_CONNECTING');
  assert.equal(started.snapshot.preflight.plannedImages, 2);
  assert.equal(started.snapshot.workflow.workflowIdentity, workflowIdentity);
  assert.deepEqual(started.snapshot.plan.branches, [
    { branchId: 'branch-a', leafIds: ['leaf-a1', 'leaf-a2'] },
  ]);
  assert.deepEqual(started.progress.overall, { completed: 0, total: 2 });
  assert.deepEqual(started.progress.generationTiming, {
    currentPromptId: null,
    currentStartedAt: null,
    recentDurationsMs: [],
  });
  const timingRun = structuredClone(started);
  timingRun.progress.overall.total = 10;
  let clock = 1_000;
  for (const duration of [1_000, 2_000, 3_000, 4_000, 5_000, 6_000]) {
    progress.markGenerationStarted(timingRun, 'prompt-' + duration, clock);
    progress.markGenerationCompleted(timingRun, clock + duration);
    clock += duration + 100;
  }
  assert.deepEqual(
    timingRun.progress.generationTiming.recentDurationsMs,
    [2_000, 3_000, 4_000, 5_000, 6_000],
    'moving average must retain only the latest five image durations',
  );
  timingRun.progress.overall.completed = 5;
  assert.equal(progress.generationAverageMs(timingRun), 4_000);
  assert.equal(
    progress.estimatedGenerationRemainingMs(timingRun, clock),
    20_000,
    'ETA must multiply the five-image moving average by the remaining image count',
  );
  progress.markGenerationStarted(timingRun, 'current', clock);
  assert.equal(
    progress.estimatedGenerationRemainingMs(timingRun, clock + 1_500),
    18_500,
    'ETA must subtract elapsed time for the current in-flight image',
  );
  progress.clearCurrentGenerationTiming(timingRun);
  assert.equal(timingRun.progress.generationTiming.currentStartedAt, null);
  assert.equal(fs.existsSync(path.join(root, 'execution_runs', started.runId + '.json')), true);
  assert.equal((await execution.getCurrentExecutionRun(root)).runId, started.runId);
  assert.equal((await execution.getExecutionRun(root, started.runId)).runId, started.runId);
  assert.deepEqual(
    (await execution.listExecutionRuns(root)).map((run) => run.runId),
    [started.runId],
    'persisted Run listing must include the active Run',
  );
  await assert.rejects(
    () => execution.startExecutionRun(root, async () => ready),
    /already active/,
  );

  const stopped = await execution.requestStopScheduling(root, started.runId);
  assert.equal(stopped.controls.scheduling, 'STOP_REQUESTED');
  assert.equal(stopped.controls.interrupt, 'IDLE');
  const interrupted = await execution.requestForceInterrupt(root, started.runId);
  assert.equal(interrupted.controls.scheduling, 'STOP_REQUESTED');
  assert.equal(interrupted.controls.interrupt, 'FORCE_REQUESTED');

  await assert.rejects(
    () =>
      execution.recordExecutionEvidence(root, started.runId, {
        kind: 'CUSTOM',
        scope: 'bad',
        data: { presignedUrl: 'https://example.com/object?X-Amz-Signature=secret' },
      }),
    /forbidden field|sensitive value/,
  );

  await execution.recordExecutionEvidence(root, started.runId, {
    kind: 'MODELS_VERIFIED',
    scope: 'all',
    data: { count: 2 },
  });
  await execution.recordExecutionEvidence(root, started.runId, {
    kind: 'EXECUTION_COMPLETED',
    scope: 'generation',
    data: { images: 2 },
  });
  await execution.mutateExecutionRun(root, started.runId, (run) => {
    run.lifecycle = 'PAUSED';
    run.controls.scheduling = 'STOPPED';
    run.controls.interrupt = 'INTERRUPTED';
  });

  const modelsPath = path.join(root, 'models.json');
  const modelsTime = fs.statSync(modelsPath);
  writeJson(modelsPath, {
    ...initialModels,
    checkpoint: { ...initialModels.checkpoint, fileName: 'model-b.safetensors' },
  });
  fs.utimesSync(modelsPath, modelsTime.atime, modelsTime.mtime);
  await assert.rejects(
    () => execution.resumeExecutionRun(root, started.runId, async () => ready),
    /WORKFLOW_MODEL_STALE/,
    'Resume must reject a changed model selection even with the original file timestamp',
  );
  writeJson(modelsPath, initialModels);
  fs.utimesSync(modelsPath, modelsTime.atime, modelsTime.mtime);

  writeJson(path.join(root, 'LoRA_project.api.json'), {
    1: { class_type: 'ChangedNode', inputs: {} },
  });
  await assert.rejects(
    () => execution.resumeExecutionRun(root, started.runId, async () => ready),
    /stale/,
  );
  writeJson(path.join(root, 'LoRA_project.api.json'), api);

  const runPath = path.join(root, 'execution_runs', started.runId + '.json');
  const tampered = JSON.parse(fs.readFileSync(runPath, 'utf8'));
  tampered.evidence.push({
    id: '00000000-0000-4000-8000-000000000001',
    kind: 'LOCAL_FILE_VERIFIED',
    scope: 'final',
    runIdentity: tampered.snapshot.runIdentity,
    fingerprint: 'bad-fingerprint',
    recordedAt: new Date().toISOString(),
    data: { size: 123 },
  });
  writeJson(runPath, tampered);
  const resumed = await execution.resumeExecutionRun(root, started.runId, async () => ready);
  assert.equal(resumed.lifecycle, 'RUNNING');
  assert.equal(
    resumed.phase,
    'LOCAL_OUTPUT_VERIFYING',
    'valid execution-completed evidence must skip generation',
  );
  assert.deepEqual(resumed.resume.lastIgnoredEvidenceIds, ['00000000-0000-4000-8000-000000000001']);
  assert.equal(resumed.resume.lastValidatedEvidenceIds.length, 2);
  assert.equal(resumed.controls.scheduling, 'ACTIVE');
  assert.equal(resumed.controls.interrupt, 'IDLE');

  await execution.recordExecutionEvidence(root, started.runId, {
    kind: 'LOCAL_FILE_VERIFIED',
    scope: 'final',
    data: { size: 123 },
  });
  await execution.mutateExecutionRun(root, started.runId, (run) => {
    run.lifecycle = 'PAUSED';
  });
  const completed = await execution.resumeExecutionRun(root, started.runId, async () => ready);
  assert.equal(completed.lifecycle, 'COMPLETED');
  assert.equal(completed.phase, 'COMPLETED');
  assert.ok(completed.completedAt);

  const persisted = fs.readFileSync(runPath, 'utf8');
  assert.doesNotMatch(persisted, /X-Amz-Signature|PRIVATE KEY|presignedUrl/);
  const remoteMeta = JSON.parse(fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8'));
  remoteMeta.settings.executionTarget = 'remote';
  remoteMeta.settings.remoteProvider = 'vastai';
  remoteMeta.settings.remoteInstanceId = 123;
  writeJson(path.join(root, 'project_meta.json'), remoteMeta);
  let second = await execution.startExecutionRun(root, async () => ready);
  assert.notEqual(second.runId, started.runId, 'a completed run must allow a new unique run');
  assert.equal(second.executionTarget, 'remote');
  assert.equal(second.phase, 'CLOUD_INSTANCE_RESOLVING');
  assert.deepEqual(second.remote, { provider: 'vastai', instanceId: 123 });

  remoteMeta.settings.remoteInstanceId = 456;
  writeJson(path.join(root, 'project_meta.json'), remoteMeta);
  const abandoned = await execution.abandonExecutionRunForRemoteReplacement(
    root,
    second.runId,
    456,
  );
  assert.equal(abandoned.lifecycle, 'FAILED');
  assert.equal(abandoned.error.code, 'REMOTE_INSTANCE_REPLACED');
  assert.equal(abandoned.error.retryable, false);
  assert.deepEqual(
    abandoned.remote,
    { provider: 'vastai', instanceId: 123 },
    'old Run must preserve its original Instance identity',
  );
  assert.equal(abandoned.controls.scheduling, 'STOPPED');
  const abandonedRunId = second.runId;
  second = await execution.startExecutionRun(root, async () => ready);
  assert.notEqual(second.runId, abandonedRunId, 'replacement must create a new Run ID');
  assert.deepEqual(
    second.remote,
    { provider: 'vastai', instanceId: 456 },
    'replacement Run must snapshot the newly selected Instance',
  );
  await assert.rejects(
    () => execution.abandonExecutionRunForRemoteReplacement(root, second.runId, 456),
    /must differ/,
  );

  const discardedRunId = second.runId;
  const discarded = await execution.discardExecutionRun(root, discardedRunId);
  assert.equal(discarded.lifecycle, 'DISCARDED');
  assert.equal(discarded.error.code, 'EXECUTION_RUN_DISCARDED');
  assert.equal(discarded.error.retryable, false);
  assert.equal(discarded.controls.scheduling, 'STOPPED');
  assert.equal(discarded.controls.interrupt, 'INTERRUPTED');
  await assert.rejects(
    () => execution.resumeExecutionRun(root, discardedRunId, async () => ready),
    /not resumable/,
  );
  second = await execution.startExecutionRun(root, async () => ready);
  assert.notEqual(second.runId, discardedRunId, 'discarded Run must allow a brand-new Run');
  assert.deepEqual(second.remote, { provider: 'vastai', instanceId: 456 });

  await execution.recordExecutionEvidence(root, second.runId, {
    kind: 'EXECUTION_COMPLETED',
    scope: 'remote-generation',
    data: { images: 2 },
  });
  await execution.recordExecutionEvidence(root, second.runId, {
    kind: 'PACKAGE_VERIFIED',
    scope: 'remote-package',
    data: {
      artifactCount: 2,
      size: 100,
      sha256: 'a'.repeat(64),
      manifestSha256: 'b'.repeat(64),
      outputPrefix: 'BatchStudio/execution-project/' + second.runId,
    },
  });
  await execution.recordExecutionEvidence(root, second.runId, {
    kind: 'R2_OBJECT_VERIFIED',
    scope: 'remote-package',
    data: { bucket: 'test', key: 'x.zip', size: 100, sha256: 'a'.repeat(64) },
  });
  await execution.recordExecutionEvidence(root, second.runId, {
    kind: 'LOCAL_FILE_VERIFIED',
    scope: 'remote-package',
    data: { path: '/tmp/x.zip', size: 100, sha256: 'a'.repeat(64) },
  });
  await execution.mutateExecutionRun(root, second.runId, (run) => {
    run.lifecycle = 'FAILED';
  });
  const cleanupResume = await execution.resumeExecutionRun(root, second.runId, async () => ready);
  assert.equal(
    cleanupResume.lifecycle,
    'RUNNING',
    'remote local verification still requires cleanup before completion',
  );
  assert.equal(cleanupResume.phase, 'REMOTE_CLEANUP');
  await execution.recordExecutionEvidence(root, second.runId, {
    kind: 'CLEANUP_COMPLETED',
    scope: 'remote-artifacts',
    data: { remote: true, r2: true },
  });
  await execution.mutateExecutionRun(root, second.runId, (run) => {
    run.lifecycle = 'FAILED';
  });
  const cleanupPendingStop = await execution.resumeExecutionRun(
    root,
    second.runId,
    async () => ready,
  );
  assert.equal(cleanupPendingStop.lifecycle, 'RUNNING');
  assert.equal(cleanupPendingStop.phase, 'CLOUD_INSTANCE_FINALIZING');
  await execution.mutateExecutionRun(root, second.runId, (run) => {
    run.lifecycle = 'FAILED';
    run.remoteLifecycle = {
      ...run.remoteLifecycle,
      finalizedAt: new Date().toISOString(),
      latest: {
        provider: 'vastai',
        instanceId: 456,
        status: 'stopped',
        rawStatus: 'stopped',
        intendedStatus: 'stopped',
        curState: 'stopped',
        nextState: null,
        statusMessage: null,
        sshHost: null,
        sshPort: null,
        comfyUiPort: null,
        resolvedAt: new Date().toISOString(),
      },
    };
  });
  const cleanupComplete = await execution.resumeExecutionRun(root, second.runId, async () => ready);
  assert.equal(cleanupComplete.lifecycle, 'COMPLETED');
  assert.equal(cleanupComplete.phase, 'COMPLETED');

  const blocked = {
    state: 'BLOCKED',
    plannedImages: 2,
    targetImages: 2,
    blocking: [{ severity: 'error', code: 'BLOCKED_FOR_TEST', message: 'blocked' }],
    warnings: [],
    sections: [],
  };
  await execution.mutateExecutionRun(root, second.runId, (run) => {
    run.lifecycle = 'FAILED';
  });
  await assert.rejects(
    () => execution.resumeExecutionRun(root, second.runId, async () => blocked),
    /Preflight is BLOCKED/,
  );

  const mainSource = fs.readFileSync(path.join(repo, 'src/main/main.ts'), 'utf8');
  const uiSource = fs.readFileSync(path.join(repo, 'src/renderer/ExecutionStages.tsx'), 'utf8');
  const restartHandlerStart = mainSource.indexOf('IPC.EXECUTION_RESTART_FROM_SCRATCH');
  const restartHandlerEnd = mainSource.indexOf('IPC.CAPTION_STATUS', restartHandlerStart);
  assert.ok(
    restartHandlerStart >= 0 && restartHandlerEnd > restartHandlerStart,
    'latest Prompt Plan restart handler must exist',
  );
  const restartHandler = mainSource.slice(restartHandlerStart, restartHandlerEnd);
  assert.equal(restartHandler.includes('listExecutionRuns(root)'), true);
  assert.equal(restartHandler.includes("['RUNNING', 'PAUSED', 'INTERRUPTED']"), true);
  assert.equal(restartHandler.includes('localExecutor()'), true);
  assert.equal(restartHandler.includes('remoteSceneExecutor()'), true);
  assert.ok(
    restartHandler.indexOf('await compileWorkflow(root);') <
      restartHandler.indexOf('await startExecutionRun(root, async () => preflight);'),
    'latest prompt_plan workflow compilation must happen before the replacement Run starts',
  );
  const restartFlagStart = uiSource.indexOf('const canRestartFromScratch');
  const restartFlagEnd = uiSource.indexOf('const canStart', restartFlagStart);
  assert.ok(restartFlagStart >= 0 && restartFlagEnd > restartFlagStart);
  assert.equal(
    uiSource.slice(restartFlagStart, restartFlagEnd).includes("preflight?.state === 'READY'"),
    false,
    'stale Preflight must not remove the prompt-plan restart path',
  );
  assert.equal(uiSource.includes('最新のPrompt Planで最初から実行'), true);

  console.log('Persistent Execution Run tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
