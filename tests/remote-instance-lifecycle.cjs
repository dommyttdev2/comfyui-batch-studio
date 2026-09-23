const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-remote-lifecycle-'));
const compiled = path.join(runtime, 'compiled');
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', compiled],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(compiled, 'main', relative)).href);
const runId = '11111111-1111-4111-8111-111111111111';

function instance(status, overrides = {}) {
  return {
    provider: 'vastai',
    id: 7,
    label: 'test',
    status,
    rawStatus: status,
    intendedStatus: null,
    curState: null,
    statusMessage: null,
    gpuName: 'RTX 4090',
    gpuCount: 1,
    gpuRamMb: 24576,
    hourlyCost: 0.2,
    sshHost: null,
    sshPort: null,
    comfyUiPort: null,
    ...overrides,
  };
}
function ready() {
  return instance('running', { sshHost: '203.0.113.7', sshPort: 42022, comfyUiPort: 8188 });
}
function writeRun(root) {
  fs.mkdirSync(path.join(root, 'execution_runs'), { recursive: true });
  const now = '2026-09-12T00:00:00.000Z';
  const run = {
    schemaVersion: 1,
    runId,
    projectId: 'p',
    executionTarget: 'remote',
    remote: { provider: 'vastai', instanceId: 7 },
    remoteLifecycle: {
      initialStatus: null,
      startedByBatchStudio: false,
      latest: null,
      restorePolicy: 'restore-if-started',
      restoredInitialState: false,
      finalizedAt: null,
    },
    lifecycle: 'RUNNING',
    phase: 'CLOUD_INSTANCE_RESOLVING',
    controls: {
      scheduling: 'ACTIVE',
      interrupt: 'IDLE',
      stopSchedulingRequestedAt: null,
      forceInterruptRequestedAt: null,
    },
    current: { branchId: null, leafId: null, promptId: null },
    progress: { overall: { completed: 0, total: 1 }, branches: [], models: [] },
    promptIds: [],
    evidence: [],
    error: null,
    errorHistory: [],
    snapshot: {
      projectId: 'p',
      target: 'remote',
      remote: { provider: 'vastai', instanceId: 7 },
      preflight: {
        state: 'READY',
        plannedImages: 1,
        targetImages: 1,
        blocking: [],
        warnings: [],
        sections: [],
      },
      workflow: { uiPath: 'x', apiPath: 'y', uiSha256: 'a', apiSha256: 'b', workflowIdentity: 'c' },
      plan: { sha256: 'd', branches: [] },
      runIdentity: 'run-identity',
    },
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
  fs.writeFileSync(
    path.join(root, 'execution_runs', runId + '.json'),
    JSON.stringify(run, null, 2) + '\n',
  );
}
class FakeClient {
  constructor(states) {
    this.states = states;
    this.reads = 0;
    this.starts = 0;
    this.stops = 0;
    this.stopped = false;
  }
  async getInstance(id) {
    assert.equal(id, 7);
    if (this.stopped) return instance('stopped');
    const value = this.states[Math.min(this.reads++, this.states.length - 1)];
    if (value instanceof Error) throw value;
    return structuredClone(value);
  }
  async requestStartInstance(id) {
    assert.equal(id, 7);
    this.starts++;
  }
  async stopInstance(id) {
    assert.equal(id, 7);
    this.stops++;
    this.stopped = true;
    return instance('stopped');
  }
}
async function scenario(lifecycle, states) {
  const root = fs.mkdtempSync(path.join(runtime, 'case-'));
  writeRun(root);
  const client = new FakeClient(states);
  const service = new lifecycle.RemoteInstanceLifecycleService(client, {
    timeoutMs: 100,
    pollMs: 0,
    sleep: async () => {},
  });
  return { root, client, service };
}

(async () => {
  const lifecycle = await load('remote-instance-lifecycle.js');
  const execution = await load('execution-run.js');

  {
    const { root, client, service } = await scenario(lifecycle, [
      instance('stopped'),
      instance('starting'),
      ready(),
    ]);
    const result = await service.prepare(root, runId);
    assert.equal(result.status, 'running');
    assert.equal(client.starts, 1);
    let run = await execution.getExecutionRun(root, runId);
    assert.equal(run.phase, 'CLOUD_INSTANCE_READY');
    assert.equal(run.remoteLifecycle.initialStatus, 'stopped');
    assert.equal(run.remoteLifecycle.startedByBatchStudio, true);
    assert.equal(run.remoteLifecycle.latest.instanceId, 7);
    assert.equal(run.remoteLifecycle.latest.status, 'running');
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.lifecycle = 'COMPLETED';
      r.phase = 'COMPLETED';
    });
    await service.finalize(root, runId);
    run = await execution.getExecutionRun(root, runId);
    assert.equal(client.stops, 1);
    assert.equal(run.remoteLifecycle.restoredInitialState, true);
    assert.equal(run.remoteLifecycle.latest.status, 'stopped');
    assert.ok(run.remoteLifecycle.finalizedAt);
    assert.equal(run.phase, 'COMPLETED');
  }

  {
    const { root, client, service } = await scenario(lifecycle, [
      instance('stopped'),
      instance('starting'),
      ready(),
    ]);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.remoteLifecycle.initialStatus = 'stopped';
      r.remoteLifecycle.startedByBatchStudio = true;
      r.remoteLifecycle.latest = {
        provider: 'vastai',
        instanceId: 7,
        status: 'stopped',
        rawStatus: 'stopped',
        intendedStatus: 'stopped',
        curState: 'stopped',
        statusMessage: null,
        sshHost: null,
        sshPort: null,
        comfyUiPort: null,
        resolvedAt: new Date().toISOString(),
      };
    });
    await service.prepare(root, runId);
    assert.equal(
      client.starts,
      1,
      'resume must re-issue start once when an owned Instance is stopped again',
    );
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.initialStatus, 'stopped');
    assert.equal(run.remoteLifecycle.startedByBatchStudio, true);
    assert.equal(run.remoteLifecycle.latest.status, 'running');
  }

  {
    // Stop-for-edit must remain resumable even if the Instance was originally
    // running before Batch Studio used it.
    const { root, client, service } = await scenario(lifecycle, [
      instance('stopped'),
      instance('starting'),
      ready(),
    ]);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.remoteLifecycle.initialStatus = 'running';
      r.remoteLifecycle.startedByBatchStudio = false;
      r.remoteLifecycle.latest = { status: 'stopped' };
      r.remoteLifecycle.finalizedAt = new Date().toISOString();
      r.resume.attempts = 1;
    });
    const result = await service.prepare(root, runId);
    assert.equal(result.status, 'running');
    assert.equal(client.starts, 1, 'explicitly stopped Instance must restart on Resume');
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.initialStatus, 'stopped');
    assert.equal(run.remoteLifecycle.startedByBatchStudio, true);
    assert.equal(run.remoteLifecycle.latest.status, 'running');
  }

  {
    // An unexpected provider stop is not equivalent to Batch Studio's
    // confirmed stop-for-edit; never silently restart without that evidence.
    const { root, client, service } = await scenario(lifecycle, [instance('stopped')]);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.remoteLifecycle.initialStatus = 'running';
      r.remoteLifecycle.latest = { status: 'stopped' };
      r.resume.attempts = 1;
    });
    await assert.rejects(() => service.prepare(root, runId), /became stopped/);
    assert.equal(client.starts, 0, 'unconfirmed stop must not restart the Instance');
  }

  {
    const { root, client, service } = await scenario(lifecycle, [ready()]);
    await service.prepare(root, runId);
    assert.equal(client.starts, 0);
    let run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.initialStatus, 'running');
    assert.equal(run.remoteLifecycle.startedByBatchStudio, false);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.lifecycle = 'COMPLETED';
      r.phase = 'COMPLETED';
    });
    await service.finalize(root, runId);
    run = await execution.getExecutionRun(root, runId);
    assert.equal(client.stops, 1, 'completed remote run must stop a pre-existing running instance');
    assert.equal(run.remoteLifecycle.restoredInitialState, false);
    assert.equal(run.remoteLifecycle.latest.status, 'stopped');
    assert.ok(run.remoteLifecycle.finalizedAt);
    assert.equal(run.phase, 'COMPLETED');
  }

  {
    const { root, client, service } = await scenario(lifecycle, [ready()]);
    await service.prepare(root, runId);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.lifecycle = 'FAILED';
      r.phase = 'EXECUTING';
    });
    await service.finalize(root, runId);
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(client.stops, 0, 'failed run must preserve a pre-existing running instance');
    assert.equal(run.remoteLifecycle.restoredInitialState, true);
    assert.equal(run.remoteLifecycle.latest.status, 'running');
    assert.ok(run.remoteLifecycle.finalizedAt);
  }

  {
    const { root, client, service } = await scenario(lifecycle, [instance('starting'), ready()]);
    await service.prepare(root, runId);
    assert.equal(client.starts, 0, 'starting instance must not receive a second start request');
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.initialStatus, 'starting');
    assert.equal(run.remoteLifecycle.latest.status, 'running');
  }

  {
    const { root, client, service } = await scenario(lifecycle, [
      instance('scheduling'),
      instance('starting'),
      ready(),
    ]);
    await assert.rejects(
      () => service.prepare(root, runId),
      /is scheduling; Execution Run cannot continue/,
    );
    assert.equal(client.starts, 0, 'scheduling instance must fail without a start request');
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.initialStatus, 'scheduling');
    assert.equal(run.remoteLifecycle.latest.status, 'scheduling');
  }

  {
    // Vast can report scheduling after accepting our start request. Do not
    // fail the Run; wait through scheduling and starting until SSH is usable.
    const { root, client, service } = await scenario(lifecycle, [
      instance('stopped'),
      instance('scheduling'),
      instance('starting', { rawStatus: 'starting' }),
      ready(),
    ]);
    const result = await service.prepare(root, runId);
    assert.equal(result.status, 'running');
    assert.equal(client.starts, 1, 'start must be requested only once during scheduling');
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.phase, 'CLOUD_INSTANCE_READY');
    assert.equal(run.remoteLifecycle.initialStatus, 'stopped');
    assert.equal(run.remoteLifecycle.startedByBatchStudio, true);
    assert.equal(run.remoteLifecycle.latest.status, 'running');
    assert.equal(run.remoteLifecycle.startRequestedAt, null);
  }

  {
    // The provider may briefly return stopped even after accepting start,
    // before reporting scheduling or starting. Never send a second start.
    const { root, client, service } = await scenario(lifecycle, [
      instance('stopped'),
      instance('stopped'),
      instance('scheduling'),
      ready(),
    ]);
    await service.prepare(root, runId);
    assert.equal(client.starts, 1);
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.latest.status, 'running');
  }

  {
    // Scheduling remains bounded by the existing startup timeout.
    const { root, client, service } = await scenario(lifecycle, [
      instance('stopped'),
      instance('scheduling'),
    ]);
    await assert.rejects(() => service.prepare(root, runId), /before timeout/);
    assert.equal(client.starts, 1);
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.latest.status, 'scheduling');
  }

  {
    const { service } = await scenario(lifecycle, [
      instance('error', { statusMessage: 'provider failure' }),
    ]);
    await assert.rejects(
      () => service.prepare(path.dirname(path.join(runtime, 'noop')), runId),
      /was not found/,
    );
  }

  {
    const { root, service } = await scenario(lifecycle, [
      instance('error', { statusMessage: 'provider failure' }),
    ]);
    await assert.rejects(() => service.prepare(root, runId), /entered error: provider failure/);
  }

  {
    const { root, service } = await scenario(lifecycle, [
      new Error('Vast.ai API 404: instance missing'),
    ]);
    await assert.rejects(() => service.prepare(root, runId), /instance missing/);
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(
      run.remote.instanceId,
      7,
      'selected instance identity must remain unchanged on provider failure',
    );
  }

  {
    const { root, client, service } = await scenario(lifecycle, [instance('running'), ready()]);
    await service.prepare(root, runId);
    assert.equal(
      client.reads,
      2,
      'running without SSH endpoint must continue polling until endpoint is ready',
    );
  }

  {
    // A provider stop acknowledgement is not evidence that the instance stopped.
    const { root, client, service } = await scenario(lifecycle, [
      ready(),
      ready(),
      instance('scheduling'),
    ]);
    await service.prepare(root, runId);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.lifecycle = 'COMPLETED';
      r.phase = 'COMPLETED';
    });
    client.stopInstance = async () => {
      client.stops++;
      return instance('stopped');
    };
    await assert.rejects(() => service.finalize(root, runId), /stopping is not confirmed/);
    const run = await execution.getExecutionRun(root, runId);
    assert.equal(run.remoteLifecycle.finalizedAt, null);
    assert.equal(run.remoteLifecycle.latest.status, 'scheduling');
  }

  {
    // Once generation/transfer/cleanup have completed, retrying a failed stop
    // must not run Preflight or generation, even after reloading the Run from disk.
    const { root, client, service } = await scenario(lifecycle, [ready()]);
    await service.prepare(root, runId);
    await execution.recordExecutionEvidence(root, runId, {
      kind: 'LOCAL_FILE_VERIFIED',
      scope: 'remote-package',
      data: { size: 1 },
    });
    await execution.recordExecutionEvidence(root, runId, {
      kind: 'CLEANUP_COMPLETED',
      scope: 'remote-artifacts',
      data: { remote: true, r2: true },
    });
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.lifecycle = 'COMPLETED';
      r.phase = 'COMPLETED';
    });
    const originalStop = client.stopInstance.bind(client);
    client.stopInstance = async () => {
      client.stops++;
      throw new Error('Vast provider temporarily unavailable');
    };
    await assert.rejects(() => service.finalize(root, runId), /temporarily unavailable/);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.lifecycle = 'FAILED';
      r.phase = 'CLOUD_INSTANCE_FINALIZING';
      r.error = {
        code: 'REMOTE_INSTANCE_FINALIZE_FAILED',
        message: 'Vast provider temporarily unavailable',
        phase: 'CLOUD_INSTANCE_FINALIZING',
        at: new Date().toISOString(),
        retryable: true,
      };
    });
    const resumed = await execution.resumeExecutionRunFinalization(root, runId);
    assert.equal(resumed.lifecycle, 'RUNNING');
    assert.equal(resumed.phase, 'CLOUD_INSTANCE_FINALIZING');
    assert.equal(resumed.resume.attempts, 1);
    assert.equal(client.starts, 0, 'finalize retry must not restart the instance');
    client.stopInstance = originalStop;
    await service.finalize(root, runId);
    const after = await execution.getExecutionRun(root, runId);
    assert.equal(after.remoteLifecycle.latest.status, 'stopped');
    assert.ok(after.remoteLifecycle.finalizedAt);
    assert.equal(client.stops, 2, 'only the instance stop must be repeated');
    await assert.rejects(
      () => execution.resumeExecutionRunFinalization(root, runId),
      /no pending Vast.ai stop finalization/,
    );
  }

  {
    // A successful stop response followed by a failed verification must remain retryable.
    const { root, client, service } = await scenario(lifecycle, [
      ready(),
      ready(),
      new Error('Vast status API timed out'),
    ]);
    await service.prepare(root, runId);
    await execution.mutateExecutionRun(root, runId, (r) => {
      r.lifecycle = 'COMPLETED';
      r.phase = 'COMPLETED';
    });
    client.stopInstance = async () => {
      client.stops++;
      return instance('stopped');
    };
    await assert.rejects(() => service.finalize(root, runId), /status API timed out/);
    const after = await execution.getExecutionRun(root, runId);
    assert.equal(after.remoteLifecycle.finalizedAt, null);
  }

  {
    // Keep code, requirement, decision and user documentation aligned: a
    // successful Run stops even an Instance that was running before the Run.
    const readDoc = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
    const architecture = readDoc('docs/architecture/remote-execution.md');
    const requirements = readDoc('docs/requirements/requirements.md');
    const runtimeDoc = readDoc('docs/architecture/project-window-execution-runtime.md');
    const decisions = readDoc('docs/decisions/decision-log.md');
    const readme = readDoc('README.md');
    assert.match(architecture, /REQ-EXEC-015 \/ DEC-026/);
    assert.match(architecture, /正常完了[\s\S]*初期状態を問わず必須停止/);
    assert.doesNotMatch(architecture, /Run開始前からrunning\s*\n\s*-> Run終了後もrunningを維持/);
    assert.match(architecture, /stopInstance[^\n]*API[^\n]*停止要求の受理/);
    assert.match(architecture, /REMOTE_INSTANCE_FINALIZE_FAILED/);
    assert.match(requirements, /REQ-EXEC-015[^\n]*開始前からrunningだったか否かを問わず必ず停止/);
    assert.match(decisions, /DEC-026: Completed Vast\.ai Run must stop its Instance/);
    assert.match(
      runtimeDoc,
      /成功したRun: mandatory stopped confirmation|successful Run: mandatory stopped confirmation/,
    );
    assert.match(readme, /開始前から稼働していたものを含めVast\.ai Instanceを停止/);
  }

  console.log('Remote Vast instance lifecycle tests passed.');
})()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => fs.rmSync(runtime, { recursive: true, force: true }));
