const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-cache-prune-build-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);

function seed(root, count, bytes = 8) {
  for (const variant of ['editor', 'gallery'])
    fs.mkdirSync(path.join(root, variant), { recursive: true });
  for (let index = 0; index < count; index++) {
    const file = path.join(root, index % 2 ? 'gallery' : 'editor', String(index).padStart(4, '0'));
    fs.writeFileSync(file, Buffer.alloc(bytes, index % 251));
    const time = new Date(1_700_000_000_000 + index * 1_000);
    fs.utimesSync(file, time, time);
  }
}

function bytesIn(root) {
  let total = 0;
  for (const variant of ['editor', 'gallery']) {
    const directory = path.join(root, variant);
    if (!fs.existsSync(directory)) continue;
    for (const name of fs.readdirSync(directory))
      total += fs.statSync(path.join(directory, name)).size;
  }
  return total;
}

(async () => {
  const { ThumbnailCachePruner } = await import(
    pathToFileURL(path.join(runtime, 'main', 'thumbnail-cache-prune.js')).href
  );

  for (const requests of [32, 64, 1000]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `batch-studio-prune-${requests}-`));
    seed(root, requests, 4);
    const pruner = new ThumbnailCachePruner(64, 60_000, 1);
    for (let index = 0; index < requests; index++) pruner.schedule(root, () => false);
    await pruner.waitForIdleForTests(root);
    const metrics = pruner.snapshot(root);
    assert.equal(metrics.requests, requests);
    assert.equal(metrics.runs, 1, `${requests} burst requests must coalesce to one prune`);
    assert.equal(metrics.coalesced, requests - 1);
    assert.ok(bytesIn(root) <= 64, `${requests} files must prune back to the configured limit`);
    assert.equal(
      JSON.stringify(metrics).includes(root),
      false,
      'metrics must not contain cache paths',
    );
  }

  const parallelRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-prune-parallel-'));
  seed(parallelRoot, 64, 8);
  const parallel = new ThumbnailCachePruner(80, 60_000, 1);
  await Promise.all([
    parallel.pruneNowForTests(parallelRoot),
    parallel.pruneNowForTests(parallelRoot),
    parallel.pruneNowForTests(parallelRoot),
  ]);
  assert.equal(parallel.snapshot(parallelRoot).runs, 1, 'parallel prune calls must share one job');

  const protectedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-prune-protected-'));
  seed(protectedRoot, 3, 60);
  const protectedPath = path.join(protectedRoot, 'editor', '0000');
  const protectedPruner = new ThumbnailCachePruner(60, 60_000, 1);
  await protectedPruner.pruneNowForTests(
    protectedRoot,
    (file) => path.resolve(file) === path.resolve(protectedPath),
  );
  assert.equal(fs.existsSync(protectedPath), true, 'active cache files must never be pruned');
  assert.ok(protectedPruner.snapshot(protectedRoot).protectedSkips >= 1);
  assert.ok(bytesIn(protectedRoot) <= 60);

  const retryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-prune-eperm-'));
  seed(retryRoot, 3, 60);
  let failuresLeft = 3;
  const retryPruner = new ThumbnailCachePruner(60, 60_000, 1, async (file) => {
    if (failuresLeft-- > 0) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    fs.rmSync(file, { force: true });
  });
  retryPruner.schedule(retryRoot, () => false);
  await retryPruner.waitForIdleForTests(retryRoot);
  const retryMetrics = retryPruner.snapshot(retryRoot);
  assert.equal(retryMetrics.runs, 2, 'a locked cache must receive one delayed retry');
  assert.equal(retryMetrics.deleteFailures, 3);
  assert.ok(bytesIn(retryRoot) <= 60, 'successful retry must converge back to the limit');

  console.log('Thumbnail cache prune serialization, protection, scale and retry tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
