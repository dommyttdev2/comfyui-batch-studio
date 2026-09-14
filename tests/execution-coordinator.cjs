const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-execution-coordinator-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);

(async () => {
  const { ExecutionCoordinator } = await load('execution-coordinator.js');
  const coordinator = new ExecutionCoordinator();

  let releaseLocal;
  const localGate = new Promise((resolve) => {
    releaseLocal = resolve;
  });
  const localA = { projectRoot: path.join(runtime, 'a'), runId: 'run-a' };
  const localB = { projectRoot: path.join(runtime, 'b'), runId: 'run-b' };
  const localTask = coordinator.startLocal(localA, 'HTTP://127.0.0.1:8188/', async () => {
    await localGate;
  });
  assert.equal(coordinator.hasActiveRuns(), true);
  assert.throws(
    () => coordinator.startLocal(localB, 'http://127.0.0.1:8188', async () => {}),
    /already in use/,
    'normalized Local ComfyUI endpoint must be exclusive',
  );
  releaseLocal();
  await localTask;
  assert.equal(coordinator.hasActiveRuns(), false);

  await coordinator.startLocal(localB, 'http://127.0.0.1:8188/', async () => {});

  let releaseRemote;
  const remoteGate = new Promise((resolve) => {
    releaseRemote = resolve;
  });
  const remoteA = { projectRoot: path.join(runtime, 'ra'), runId: 'remote-a' };
  const remoteB = { projectRoot: path.join(runtime, 'rb'), runId: 'remote-b' };
  const remoteC = { projectRoot: path.join(runtime, 'rc'), runId: 'remote-c' };
  const remoteTask = coordinator.startRemote(remoteA, 'vastai', 100, async () => {
    await remoteGate;
  });
  assert.throws(
    () => coordinator.startRemote(remoteB, 'vastai', 100, async () => {}),
    /already in use/,
    'same Vast.ai Instance must be exclusive',
  );
  await coordinator.startRemote(remoteC, 'vastai', 101, async () => {});
  releaseRemote();
  await remoteTask;
  assert.equal(coordinator.hasActiveRuns(), false);

  console.log('Execution coordinator tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
