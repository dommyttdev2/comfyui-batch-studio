const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-ui-state-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);

(async () => {
  const { UiStateStore } = await load('ui-state.js');
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-ui-state-'));
  const projectA = path.join(userData, 'project-a');
  const projectB = path.join(userData, 'project-b');
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });
  const store = new UiStateStore(userData);

  await store.rememberProject(projectA);
  assert.equal(await store.lastProjectPath(), path.resolve(projectA));
  assert.equal(await store.lastProjectDirectoryPath(), path.resolve(projectA));
  assert.deepEqual(await store.recentProjectPaths(), [path.resolve(projectA)]);

  await store.rememberProject(projectB);
  await store.rememberProject(projectA);
  assert.equal(await store.lastProjectDirectoryPath(), path.resolve(projectA));
  assert.deepEqual(await store.recentProjectPaths(), [
    path.resolve(projectA),
    path.resolve(projectB),
  ]);

  await store.clearProject();
  assert.equal(await store.lastProjectPath(), null);
  assert.equal(await store.lastProjectDirectoryPath(), path.resolve(projectA));
  assert.deepEqual(await store.recentProjectPaths(), [
    path.resolve(projectA),
    path.resolve(projectB),
  ]);

  await store.removeRecentProject(projectA);
  assert.deepEqual(await store.recentProjectPaths(), [path.resolve(projectB)]);
  assert.equal(fs.existsSync(projectA), true, '履歴削除でプロジェクト実体を削除してはいけない');
  assert.equal(
    await store.lastProjectDirectoryPath(),
    path.resolve(projectA),
    '履歴削除後も前回フォルダを保持する',
  );

  fs.rmSync(projectB, { recursive: true, force: true });
  assert.deepEqual(await store.recentProjectPaths(), []);
  fs.rmSync(projectA, { recursive: true, force: true });
  assert.equal(await store.lastProjectDirectoryPath(), null);
  console.log('UI state tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
