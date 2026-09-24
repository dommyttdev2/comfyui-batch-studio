const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-picker-gate-'));
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules/typescript/bin/tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    runtime,
  ],
  { cwd: repo, stdio: 'inherit' },
);

(async () => {
  const { PickerSelectionGate } = await import(
    pathToFileURL(path.join(runtime, 'main/picker-selection-gate.js')).href
  );
  const gate = new PickerSelectionGate(100);
  const first = gate.beginPreview('A');
  assert.throws(() => gate.beginCommit('A'), /プレビュー/);
  const second = gate.beginPreview('B');
  await assert.rejects(first, /新しい画像/);
  assert.equal(gate.previewResult('A', true), false, 'late A must not replace B');
  assert.equal(gate.previewResult('B', true), true);
  await second;
  assert.equal(gate.phase, 'preview-ready');
  assert.throws(() => gate.beginCommit('A'), /同じ画像/);
  const commit = gate.beginCommit('B');
  assert.throws(() => gate.beginCommit('B'), /プレビュー/);
  assert.equal(gate.commitResult('B', false, 'save failed'), true);
  await assert.rejects(commit, /save failed/);
  assert.equal(gate.phase, 'preview-ready', 'failed save permits retry without closing');
  const retry = gate.beginCommit('B');
  assert.equal(gate.commitResult('B', true), true);
  await retry;
  assert.equal(gate.phase, 'committed');

  const cancelled = new PickerSelectionGate();
  const pending = cancelled.beginPreview('C');
  cancelled.cancel();
  await assert.rejects(pending, /キャンセル/);
  assert.equal(cancelled.previewResult('C', true), false);
  const timed = new PickerSelectionGate(1);
  await assert.rejects(timed.beginPreview('D'), /応答がありません/);
  assert.equal(timed.phase, 'idle');
  console.log('Picker selection handshake tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
