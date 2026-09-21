const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-turn-status-'));
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    runtime,
  ],
  { cwd: repo, stdio: 'inherit' },
);
const source = (file) => fs.readFileSync(path.join(repo, file), 'utf8');
const main = source('src/main/main.ts');
const pane = source('src/renderer/CodexPane.tsx');
assert.match(main, /codexTurnMonitor\.notification\(threadId, notification\)/);
assert.match(main, /codexTurnMonitor\.fromRead\(saved\.activeThreadId, read\)/);
assert.match(main, /codexTurnMonitor\.disconnected\(\)/);
assert.match(main, /model: settings\.selection\.model/);
assert.match(main, /effort: settings\.selection\.effort/);
assert.match(main, /server\.request\('model\/list'/);
assert.match(pane, /Codexモデル/);
assert.match(pane, /Codex推論強度/);
assert.match(pane, /経過時間:/);
assert.match(pane, /phaseLabel\[turnStatus\.phase\]/);
assert.match(
  pane,
  /const taskSendDisabledReason = loading[\s\S]*!account\?\.authenticated[\s\S]*modelLoading[\s\S]*!modelSettings/,
  'Disabled task send must explain its precise prerequisite rather than fail silently',
);
assert.match(pane, /title=\{taskSendDisabledReason \?\?/, 'Disabled buttons must explain the reason');
assert.match(pane, /モデル一覧を再取得/, 'Model discovery failures must be recoverable');
assert.match(
  pane,
  /if \(status\.authenticated\) return refreshModels\(key\)/,
  'Successful login must refresh the model list without changing stages',
);
assert.match(
  pane,
  /if \(status\.authenticated\) await refreshModels\(key\)/,
  'Initial model discovery must run after the authentication check',
);


(async () => {
  const { CodexTurnMonitor, statusFromThreadRead } = await import(
    pathToFileURL(path.join(runtime, 'main', 'codex-turn-monitor.js')).href
  );
  const { CodexModelSelectionStore } = await import(
    pathToFileURL(path.join(runtime, 'main', 'codex-model-selection.js')).href
  );
  const monitor = new CodexTurnMonitor();
  const id = 'thread-one';
  assert.equal(monitor.get(id), null);
  assert.equal(monitor.sending(id).phase, 'sending');
  assert.equal(
    monitor.notification(id, { method: 'turn/started', params: {} }).phase,
    'processing',
  );
  assert.equal(
    monitor.notification(id, { method: 'item/agentMessage/delta', params: { delta: 'Hello' } })
      .phase,
    'streaming',
  );
  const completed = monitor.notification(id, {
    method: 'turn/completed',
    params: { turn: { status: 'completed' } },
  });
  assert.equal(completed.phase, 'completed');
  assert.equal(completed.finishedAt >= completed.startedAt, true);
  assert.equal(monitor.get(id).phase, 'completed');

  assert.equal(
    monitor.notification('thread-fail', {
      method: 'turn/completed',
      params: { turn: { status: 'failed', error: { message: 'Model unavailable' } } },
    }).phase,
    'failed',
  );
  assert.equal(monitor.get('thread-fail').error, 'Model unavailable');
  assert.equal(
    monitor.notification('thread-interrupt', {
      method: 'turn/completed',
      params: { turn: { status: 'interrupted' } },
    }).phase,
    'interrupted',
  );
  assert.equal(
    monitor.notification('thread-unverified', {
      method: 'turn/completed',
      params: { turn: {} },
    }).phase,
    'unknown',
    'Unknown terminal results must never be represented as successful',
  );
  monitor.sending('thread-disconnect');
  monitor.disconnected();
  assert.equal(monitor.get('thread-disconnect').phase, 'unknown');
  assert.equal(monitor.get(id).phase, 'completed');

  assert.equal(
    statusFromThreadRead({ thread: { turns: [{ status: 'completed' }] } }).phase,
    'completed',
  );
  assert.equal(
    statusFromThreadRead({ thread: { turns: [{ status: 'inProgress' }] } }).phase,
    'unknown',
    'Persisted inProgress without a live connection is not proof of ongoing execution',
  );
  assert.equal(statusFromThreadRead({ thread: { turns: [] } }).phase, 'idle');

  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-model-settings-'));
  const selections = new CodexModelSelectionStore(folder);
  const root = path.join(folder, 'project-a');
  const other = path.join(folder, 'project-b');
  assert.equal(await selections.get(root, 'story'), null);
  await selections.remember(root, 'story', { model: 'model-a', effort: 'high' });
  await selections.remember(root, 'models', { model: 'model-a', effort: 'low' });
  await selections.remember(other, 'story', { model: 'model-b', effort: 'medium' });
  const restored = new CodexModelSelectionStore(folder);
  assert.deepEqual(await restored.get(root, 'story'), { model: 'model-a', effort: 'high' });
  assert.deepEqual(await restored.get(root, 'models'), { model: 'model-a', effort: 'low' });
  assert.deepEqual(await restored.get(other, 'story'), { model: 'model-b', effort: 'medium' });
  console.log('Codex turn status and model selection tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
