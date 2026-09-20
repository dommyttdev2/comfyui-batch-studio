const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-picker-generation-'));
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    compiled,
  ],
  { cwd: repo, stdio: 'inherit' },
);
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

(async () => {
  const { MarketplacePickerGeneration } = await import(
    pathToFileURL(path.join(compiled, 'shared', 'marketplace-picker-generation.js')).href
  );
  const gate = new MarketplacePickerGeneration();
  const baseline = { path: 'original', crop: 1 };
  let preview = baseline;
  let persisted = baseline;
  const fakeRead = (pending, sessionId, token, next) =>
    pending.promise.then(() => {
      if (!gate.isPreviewCurrent(sessionId, token)) return;
      preview = next;
    });
  gate.begin('first');
  const pendingA = deferred();
  const a = gate.preview('first');
  const readA = fakeRead(pendingA, 'first', a, { path: 'A', crop: 2 });
  const pendingB = deferred();
  const b = gate.preview('first');
  const readB = fakeRead(pendingB, 'first', b, { path: 'B', crop: 3 });
  pendingB.resolve();
  await readB;
  pendingA.resolve();
  await readA;
  assert.deepEqual(preview, { path: 'B', crop: 3 }, 'late A cannot overwrite newer B');

  const pendingCancel = deferred();
  const cancelPreview = gate.preview('first');
  const cancelledRead = fakeRead(pendingCancel, 'first', cancelPreview, {
    path: 'cancelled',
    crop: 4,
  });
  const cancelToken = gate.cancel('first');
  assert.notEqual(cancelToken, null);
  preview = baseline;
  pendingCancel.resolve();
  await cancelledRead;
  assert.deepEqual(preview, baseline, 'late preview must not reapply a cancelled image');
  assert.equal(gate.preview('first'), null, 'cancelled session cannot start new previews');

  gate.begin('second');
  const pendingCommit = deferred();
  const oldPreview = gate.preview('second');
  const committedRead = fakeRead(pendingCommit, 'second', oldPreview, {
    path: 'old-preview',
    crop: 5,
  });
  const committed = gate.commit('second');
  assert.notEqual(committed, null);
  persisted = { path: 'committed', crop: 6 };
  pendingCommit.resolve();
  await committedRead;
  assert.notDeepEqual(preview, { path: 'old-preview', crop: 5 });
  assert.deepEqual(persisted, { path: 'committed', crop: 6 });
  assert.equal(gate.cancel('second'), null, 'late cancel must not revert a committed selection');

  gate.begin('third');
  const pendingRestore = deferred();
  const restoreToken = gate.cancel('third');
  const restore = pendingRestore.promise.then(() => {
    if (gate.isCurrent(restoreToken)) preview = baseline;
  });
  gate.begin('fourth');
  preview = { path: 'fourth', crop: 7 };
  pendingRestore.resolve();
  await restore;
  assert.deepEqual(
    preview,
    { path: 'fourth', crop: 7 },
    'late restore cannot override a new session',
  );
  assert.equal(gate.preview('third'), null);
  assert.notEqual(gate.preview('fourth'), null);

  const source = fs.readFileSync(path.join(repo, 'src/renderer/MarketplaceImageStage.tsx'), 'utf8');
  assert.match(
    source,
    /const nextSource = await window\.batchStudio\.finalArtifact\.readImage[\s\S]*if \(!isCurrent\(\)\) return null/,
  );
  assert.match(
    source,
    /const nextImage = await loadBrowserImage\(nextSource\);\s*if \(!isCurrent\(\)\) return null/,
  );
  assert.match(source, /pickerGenerationRef\.current\.cancel\(session\.sessionId\)/);
  assert.match(source, /pickerGenerationRef\.current\.commit\(selection\.sessionId\)/);
  assert.match(source, /pickerGenerationRef\.current\.isPreviewCurrent/);
  assert.match(source, /pickerSessionRef\.current \|\| pickerOpeningRef\.current/);
  console.log('Marketplace picker asynchronous generation tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
