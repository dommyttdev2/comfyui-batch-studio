const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

(async () => {
  const repo = path.resolve(__dirname, '..');
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-remote-'));
  const compiled = path.join(runtime, 'compiled');
  const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(
    process.execPath,
    [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', compiled],
    { cwd: repo, stdio: 'inherit' },
  );
  const load = (relative) => import(pathToFileURL(path.join(compiled, 'main', relative)).href);
  const hostKeys = await load('ssh-host-keys.js');
  const controlPlane = await load('remote-control-plane.js');
  const worker = await load('remote-worker-source.js');
  const workerClientModule = await load('remote-worker.js');
  const store = new hostKeys.SshHostKeyStore(runtime),
    key = crypto.randomBytes(64),
    fp = hostKeys.sshHostKeyFingerprint(key);
  const endpoint = {
    provider: 'vastai',
    instanceId: 52,
    host: 'gpu.example',
    port: 22022,
    user: 'root',
    privateKeyPath: 'private',
    publicKeyPath: 'public',
    comfyUiDirectory: '/workspace/ComfyUI',
    comfyUiPort: 18188,
  };
  assert.equal(
    controlPlane.remoteWorkerPayload(endpoint, 'run_scene_sequence', {
      comfyEndpoint: 'http://127.0.0.1:8188',
    }).comfyEndpoint,
    'http://127.0.0.1:18188',
  );
  assert.equal(
    controlPlane.remoteWorkerPayload(endpoint, 'force_interrupt_sequence', {}).comfyEndpoint,
    'http://127.0.0.1:18188',
  );
  assert.deepEqual(controlPlane.remoteWorkerPayload(endpoint, 'status', { value: 1 }), {
    value: 1,
  });
  assert.equal((await store.check('gpu.example', 22022, key)).status, 'unknown');
  await store.trust('gpu.example', 22022, key, 'ssh-ed25519');
  assert.equal((await store.check('gpu.example', 22022, key)).status, 'trusted');
  const changed = await store.check('gpu.example', 22022, crypto.randomBytes(64));
  assert.equal(changed.status, 'mismatch');
  assert.equal(changed.expectedFingerprint, fp);
  const workerPath = path.join(runtime, 'worker.py'),
    runDir = path.join(runtime, 'run');
  fs.mkdirSync(runDir);
  fs.writeFileSync(workerPath, worker.REMOTE_WORKER_FILE);
  const streamed = [];
  let streamClosed = false;
  const fakeSession = {
    exec: async (_command, stdin, onStdoutChunk) => {
      const requestId = JSON.parse(String(stdin).trim()).requestId;
      onStdoutChunk('{"type":"progress","stage":"prompt_terminal","overallCompleted":1,');
      onStdoutChunk(
        '"current":{"branchId":"b01","index":1,"promptId":null},"terminal":"success"}\n',
      );
      await Promise.resolve();
      assert.equal(streamed.length, 1, 'progress callback must run before the SSH command closes');
      assert.equal(streamed[0].overallCompleted, 1);
      onStdoutChunk(JSON.stringify({ type: 'response', requestId, result: { ok: true } }) + '\n');
      streamClosed = true;
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  const streamingClient = new workerClientModule.RemoteWorkerClient();
  const streamingResult = await streamingClient.request(
    fakeSession,
    { runDir: '/tmp/run', workerPath: '/tmp/worker.py' },
    'stream-test',
    {},
    (event) => {
      if (event.type === 'progress') streamed.push(event);
    },
  );
  assert.equal(streamClosed, true);
  assert.equal(streamingResult.response.ok, true);
  assert.equal(streamed.length, 1);
  // The generated Remote Worker runs on Vast.ai Linux hosts and imports POSIX-only modules
  // such as fcntl. Exercise the worker process on POSIX CI; Windows still covers the
  // TypeScript control plane, host-key store, payload rewriting, and streaming client above.
  if (process.platform !== 'win32') {
    const call = (req) =>
      spawnSync('python', [workerPath, '--root', runDir], {
        input: JSON.stringify(req) + '\n',
        encoding: 'utf8',
      });
    let result = call({ requestId: 'health-1', op: 'health' });
    assert.equal(result.status, 0);
    let lines = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(lines.at(-1).result.version, worker.REMOTE_WORKER_VERSION);
    result = call({
      requestId: 'state-1',
      op: 'write_state',
      state: { runId: 'abc', completed: 7 },
    });
    lines = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.equal(lines[0].type, 'progress');
    assert.equal(lines.at(-1).result.ok, true);
    result = call({ requestId: 'status-1', op: 'status' });
    lines = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.deepEqual(lines.at(-1).result.state, { runId: 'abc', completed: 7 });
    result = call({ requestId: 'escape-1', op: 'resolve_path', path: '../escape.txt' });
    assert.notEqual(result.status, 0);
    lines = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.match(lines.at(-1).error.code, /PATH_OUTSIDE_ALLOWED_ROOT/);
    const outside = path.join(runtime, 'outside');
    fs.mkdirSync(outside);
    fs.symlinkSync(outside, path.join(runDir, 'link'), 'junction');
    result = call({ requestId: 'link-1', op: 'resolve_path', path: 'link/file.txt' });
    assert.notEqual(result.status, 0);
    lines = result.stdout.trim().split(/\r?\n/).map(JSON.parse);
    assert.match(lines.at(-1).error.code, /PATH_OUTSIDE_ALLOWED_ROOT|SYMLINK_ESCAPE_REJECTED/);
  }
  const persisted = fs.readFileSync(path.join(runtime, 'ssh', 'known-hosts.json'), 'utf8');
  assert.ok(!persisted.includes('PRIVATE KEY'));
  console.log('remote control plane tests passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
