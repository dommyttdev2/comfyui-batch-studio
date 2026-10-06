const assert = require('node:assert/strict');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const load = (name) =>
  import(pathToFileURL(path.resolve(__dirname, '../dist-core/domain', name + '.js')).href);
const run = {
  id: 'run1',
  target: 'remote',
  lifecycle: 'PAUSED',
  phase: 'EXECUTING',
  recovery: 'known',
  finalization: 'pending',
};
test('remote resources remain read-only until billing is confirmed stopped', async () => {
  const { blocksProjectEdit } = await load('execution-policy');
  assert.equal(blocksProjectEdit(run), true);
  assert.equal(blocksProjectEdit({ ...run, finalization: 'stopped' }), false);
});
test('remote uncertainty requires reconciliation and browser leave does not stop it', async () => {
  const { planRunStop, leaveProject } = await load('execution-policy');
  assert.throws(() => planRunStop({ ...run, recovery: 'uncertain' }), {
    code: 'RUNTIME_UNCERTAIN',
  });
  assert.deepEqual(leaveProject(), { runtimeContinues: true });
});
test('empty, invalid and stale artifacts cannot be confirmed', async () => {
  const { assertConfirmable } = await load('artifact-policy');
  for (const artifact of [
    undefined,
    { content: '', status: 'draft', validation: { valid: true } },
    { content: 'draft', status: 'draft', validation: { valid: false } },
    { content: 'draft', status: 'stale', validation: { valid: true } },
  ])
    assert.throws(() => assertConfirmable(artifact), { code: 'INVALID_ARTIFACT' });
});
test('changed revision invalidates confirmation even when price fingerprint matches', async () => {
  const { assertConfirmation } = await load('confirmation-policy');
  const token = {
    userId: 'u',
    sessionId: 's',
    projectId: 'p',
    operation: 'rent-instance',
    targetId: 't',
    fingerprint: 'same',
    revision: 1,
    expiresAt: 100,
  };
  assert.throws(() => assertConfirmation(token, { ...token, revision: 2, now: 50 }), {
    code: 'TARGET_CHANGED',
  });
});
test('image memory budget is checked without a decoder allocation', async () => {
  const { assertRenderSize } = await load('image-policy');
  assert.throws(
    () =>
      assertRenderSize({
        sourceWidth: 10000,
        sourceHeight: 10000,
        cropWidth: 10000,
        cropHeight: 10000,
        outputWidth: 10000,
        outputHeight: 10000,
      }),
    { code: 'INVALID_INPUT' },
  );
});
