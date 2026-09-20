const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-remote-scene-'));
const compiled = path.join(runtime, 'compiled');
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', compiled],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(compiled, 'main', relative)).href);
const callWorker = (workerPath, runDir, req) =>
  new Promise((resolve, reject) => {
    const child = spawn('python', [workerPath, '--root', runDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code,
        stderr,
        lines: stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse),
      }),
    );
    child.stdin.end(JSON.stringify(req) + '\n');
  });
const graph = () => ({
  1: {
    class_type: 'SceneMatrix',
    inputs: {
      matrix_json: JSON.stringify({
        version: 1,
        sets: [
          { row_id: 'a1', enabled: true },
          { row_id: 'a2', enabled: true },
        ],
      }),
      run_handle: '',
    },
  },
  2: {
    class_type: 'ScenePrompterExpand',
    inputs: {
      scene_prompt: ['1', 0],
      current_index: 0,
      run_id: '',
      seed_base: 0,
      prefix: 'a',
      model_mode: 'Illustrious',
    },
  },
  3: {
    class_type: 'SceneSaveImage',
    inputs: { images: ['2', 0], path: 'BatchStudio/test/branch-a', metadata_mode: 'none' },
  },
});
const payload = (endpoint, runId = 'remote-run') => ({
  requestId: 'run-' + runId,
  op: 'run_scene_sequence',
  runId,
  projectId: 'test',
  outputPrefix: 'BatchStudio/test',
  comfyEndpoint: endpoint,
  workflow: { nodes: [], links: [] },
  branches: [{ branchId: 'branch-a', leafIds: ['a1', 'a2'], expandNodeId: '2', graph: graph() }],
});

function startMock() {
  const calls = {
    prompts: [],
    prepares: 0,
    claims: [],
    finalizes: [],
    releases: [],
    interrupts: 0,
  };
  const history = new Map([['recovered-1', 'success']]);
  const running = new Set();
  const pending = new Set(['unrelated-pending']);
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : {};
    const json = (status, value) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (req.url === '/system_stats') return json(200, { ok: true });
    if (req.url === '/object_info')
      return json(200, { SceneMatrix: {}, ScenePrompterExpand: {}, SceneSaveImage: {} });
    if (req.url === '/scene_prompt/runs/prepare') {
      calls.prepares++;
      return json(200, {
        run_handle: 'handle-' + calls.prepares,
        total_batches: 2,
        total_images: 2,
      });
    }
    if (req.url === '/scene_prompt/runs/claim') {
      calls.claims.push(body);
      return json(200, { claimed: true });
    }
    if (req.url === '/scene_prompt/runs/finalize') {
      calls.finalizes.push(body);
      return json(200, { state: 'finalized' });
    }
    if (req.url === '/scene_prompt/runs/release') {
      calls.releases.push(body);
      return json(200, { released: true });
    }
    if (req.url === '/prompt') {
      const expand = body.prompt['2'],
        id = 'prompt-' + (calls.prompts.length + 1);
      calls.prompts.push({
        id,
        index: expand.inputs.current_index,
        runHandle: expand.inputs.run_handle,
      });
      history.set(id, 'success');
      return json(200, { prompt_id: id, number: calls.prompts.length, node_errors: {} });
    }
    if (req.url?.startsWith('/history/')) {
      const id = decodeURIComponent(req.url.slice('/history/'.length)),
        state = history.get(id);
      if (!state) return json(200, {});
      return json(200, { [id]: { status: { status_str: state, completed: state === 'success' } } });
    }
    if (req.url === '/queue')
      return json(200, {
        queue_running: [...running].map((id, i) => [i, id, {}]),
        queue_pending: [...pending].map((id, i) => [i, id, {}]),
      });
    if (req.url === '/interrupt') {
      calls.interrupts++;
      running.clear();
      return json(200, {});
    }
    return json(404, { error: 'not found' });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({
        server,
        calls,
        history,
        running,
        pending,
        endpoint: 'http://127.0.0.1:' + server.address().port,
      }),
    ),
  );
}

(async () => {
  const { REMOTE_WORKER_FILE } = await load('remote-worker-source.js');
  const workerPath = path.join(runtime, 'worker.py');
  fs.writeFileSync(workerPath, REMOTE_WORKER_FILE);
  const mock = await startMock();
  try {
    const runDir = path.join(runtime, 'run1');
    fs.mkdirSync(runDir);
    let result = await callWorker(workerPath, runDir, payload(mock.endpoint));
    assert.equal(result.code, 0, result.stderr);
    let response = result.lines.at(-1).result;
    assert.equal(response.state.status, 'completed');
    assert.deepEqual(
      mock.calls.prompts.map((x) => x.index),
      [0, 1],
      'worker must submit FIFO after terminal completion',
    );
    assert.equal(mock.calls.claims.length, 1, 'run handle is claimed by the first prompt only');
    assert.equal(mock.calls.finalizes.length, 1);
    assert.equal(mock.calls.releases.length, 1);
    assert.ok(mock.calls.prompts.every((x) => String(x.runHandle).startsWith('handle-')));
    assert.equal(response.state.artifact.outputPrefix, 'BatchStudio/test');

    const reconnectDir = path.join(runtime, 'reconnect');
    fs.mkdirSync(reconnectDir);
    fs.writeFileSync(
      path.join(reconnectDir, 'state.json'),
      JSON.stringify({
        version: 1,
        runId: 'reconnect-run',
        status: 'running',
        workerPid: 0,
        current: { branchId: 'branch-a', leafId: 'a1', index: 0, promptId: 'recovered-1' },
        completed: {},
        overallCompleted: 0,
        overallTotal: 2,
        promptIds: ['recovered-1'],
        branchRuns: {
          'branch-a': { runHandle: 'handle-recovered', claimed: true, lastPromptId: 'recovered-1' },
        },
        artifact: { outputPrefix: 'BatchStudio/test', capturedAt: new Date().toISOString() },
        error: null,
      }),
    );
    const before = mock.calls.prompts.length;
    result = await callWorker(workerPath, reconnectDir, payload(mock.endpoint, 'reconnect-run'));
    assert.equal(result.code, 0, result.stderr);
    response = result.lines.at(-1).result;
    assert.equal(response.state.status, 'completed');
    assert.equal(
      mock.calls.prompts.length - before,
      1,
      'reconnect must reconcile recovered prompt instead of resubmitting it',
    );
    assert.equal(mock.calls.prompts.at(-1).index, 1);

    const stopDir = path.join(runtime, 'stop');
    fs.mkdirSync(stopDir);
    fs.writeFileSync(
      path.join(stopDir, 'state.json'),
      JSON.stringify({
        version: 1,
        runId: 'stop-run',
        status: 'running',
        workerPid: 0,
        current: { branchId: null, leafId: null, index: 0, promptId: null },
        completed: {},
        overallCompleted: 0,
        overallTotal: 2,
        promptIds: [],
        branchRuns: {},
        artifact: { outputPrefix: 'BatchStudio/test' },
        error: null,
      }),
    );
    result = await callWorker(workerPath, stopDir, {
      requestId: 'stop',
      op: 'stop_scene_sequence',
    });
    assert.equal(result.code, 0);
    const stopBefore = mock.calls.prompts.length;
    result = await callWorker(workerPath, stopDir, payload(mock.endpoint, 'stop-run'));
    assert.equal(result.code, 0, result.stderr);
    response = result.lines.at(-1).result;
    assert.equal(response.state.status, 'paused');
    assert.equal(
      mock.calls.prompts.length,
      stopBefore,
      'stop scheduling must not submit the next prompt',
    );

    // Stopping is durable: only an explicit resume may clear the persisted stop flags.
    const pausedState = JSON.parse(fs.readFileSync(path.join(stopDir, 'state.json'), 'utf8'));
    assert.equal(pausedState.status, 'paused');
    assert.equal(JSON.parse(fs.readFileSync(path.join(stopDir, 'control.json'), 'utf8')).stopRequested, true);
    result = await callWorker(workerPath, stopDir, {
      ...payload(mock.endpoint, 'stop-run'),
      resume: true,
    });
    assert.equal(result.code, 0, result.stderr);
    response = result.lines.at(-1).result;
    assert.equal(response.state.status, 'completed');
    assert.deepEqual(
      mock.calls.prompts.slice(stopBefore).map((x) => x.index),
      [0, 1],
      'explicit Resume must execute all remaining leaves after Stop Scheduling',
    );
    assert.equal(JSON.parse(fs.readFileSync(path.join(stopDir, 'control.json'), 'utf8')).stopRequested, false);

    const partialDir = path.join(runtime, 'partial');
    fs.mkdirSync(partialDir);
    fs.writeFileSync(
      path.join(partialDir, 'state.json'),
      JSON.stringify({
        ...pausedState,
        runId: 'partial-run',
        workerPid: 0,
        status: 'paused',
        current: { branchId: 'branch-a', leafId: null, index: 1, promptId: null },
        completed: { 'branch-a': 1 },
        overallCompleted: 1,
        promptIds: ['already-completed'],
        branchRuns: {},
        error: null,
      }),
    );
    fs.writeFileSync(
      path.join(partialDir, 'control.json'),
      JSON.stringify({ stopRequested: true, interruptRequested: true }),
    );
    const partialBefore = mock.calls.prompts.length;
    result = await callWorker(workerPath, partialDir, {
      ...payload(mock.endpoint, 'partial-run'),
      resume: true,
    });
    assert.equal(result.code, 0, result.stderr);
    response = result.lines.at(-1).result;
    assert.equal(response.state.status, 'completed');
    assert.equal(response.state.overallCompleted, 2);
    assert.deepEqual(
      mock.calls.prompts.slice(partialBefore).map((x) => x.index),
      [1],
      'previously completed leaves must never be submitted again',
    );
    assert.deepEqual(
      JSON.parse(fs.readFileSync(path.join(partialDir, 'control.json'), 'utf8')),
      { stopRequested: false, interruptRequested: false },
    );

    for (const priorStatus of ['interrupted', 'failed']) {
      const recoveredDir = path.join(runtime, 'recover-' + priorStatus);
      fs.mkdirSync(recoveredDir);
      fs.writeFileSync(
        path.join(recoveredDir, 'state.json'),
        JSON.stringify({
          ...pausedState,
          runId: 'recover-' + priorStatus,
          workerPid: 0,
          status: priorStatus,
          current: { branchId: 'branch-a', leafId: 'a2', index: 1, promptId: null },
          completed: { 'branch-a': 1 },
          overallCompleted: 1,
          promptIds: ['completed-first'],
          branchRuns: {},
          error:
            priorStatus === 'failed'
              ? { code: 'REMOTE_PROMPT_FAILED', message: 'Previous prompt was terminal error.' }
              : null,
        }),
      );
      const recoveredBefore = mock.calls.prompts.length;
      result = await callWorker(workerPath, recoveredDir, {
        ...payload(mock.endpoint, 'recover-' + priorStatus),
        resume: true,
      });
      assert.equal(result.code, 0, result.stderr);
      response = result.lines.at(-1).result;
      assert.equal(response.state.status, 'completed');
      assert.deepEqual(mock.calls.prompts.slice(recoveredBefore).map((x) => x.index), [1]);
    }

    const unsafeDir = path.join(runtime, 'unsafe-failure');
    fs.mkdirSync(unsafeDir);
    fs.writeFileSync(
      path.join(unsafeDir, 'state.json'),
      JSON.stringify({
        ...pausedState,
        runId: 'unsafe-failure',
        workerPid: 0,
        status: 'failed',
        error: { code: 'REMOTE_SCENE_PLAN_MISMATCH', message: 'Plan changed' },
      }),
    );
    const unsafeBefore = mock.calls.prompts.length;
    result = await callWorker(workerPath, unsafeDir, {
      ...payload(mock.endpoint, 'unsafe-failure'),
      resume: true,
    });
    assert.equal(result.code, 2);
    assert.equal(result.lines.at(-1).error.code, 'REMOTE_RESUME_UNSAFE');
    assert.equal(mock.calls.prompts.length, unsafeBefore);

    const interruptDir = path.join(runtime, 'interrupt');
    fs.mkdirSync(interruptDir);
    fs.writeFileSync(
      path.join(interruptDir, 'state.json'),
      JSON.stringify({
        version: 1,
        runId: 'interrupt-run',
        status: 'running',
        workerPid: 0,
        current: { branchId: 'branch-a', leafId: 'a1', index: 0, promptId: 'owned-prompt' },
        completed: {},
        overallCompleted: 0,
        overallTotal: 2,
        promptIds: ['owned-prompt'],
        branchRuns: {},
        artifact: { outputPrefix: 'BatchStudio/test' },
        error: null,
      }),
    );
    result = await callWorker(workerPath, interruptDir, {
      requestId: 'not-running',
      op: 'force_interrupt_sequence',
      comfyEndpoint: mock.endpoint,
    });
    assert.equal(result.lines.at(-1).result.interrupted, false);
    assert.equal(mock.calls.interrupts, 0);
    mock.running.add('owned-prompt');
    result = await callWorker(workerPath, interruptDir, {
      requestId: 'owned',
      op: 'force_interrupt_sequence',
      comfyEndpoint: mock.endpoint,
    });
    assert.equal(result.lines.at(-1).result.interrupted, true);
    assert.equal(mock.calls.interrupts, 1);
    assert.equal(
      mock.pending.has('unrelated-pending'),
      true,
      'unrelated pending queue must remain untouched',
    );

    console.log('Remote Scene Prompt execution tests passed.');
  } finally {
    mock.server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
