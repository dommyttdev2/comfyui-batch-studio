const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-chat-state-'));
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

(async () => {
  const { CodexChatStateStore } = await import(
    pathToFileURL(path.join(runtime, 'main', 'codex-chat-state.js')).href
  );
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-user-data-'));
  const a = path.join(home, 'project-a');
  const b = path.join(home, 'project-b');
  const store = new CodexChatStateStore(home);
  await Promise.all([
    store.remember(a, 'story', 'story-1'),
    store.remember(a, 'models', 'models-1'),
    store.remember(b, 'story', 'story-b'),
  ]);
  await store.remember(a, 'story', 'story-2');
  assert.deepEqual(await store.get(a, 'story'), {
    activeThreadId: 'story-2',
    threadIds: ['story-2', 'story-1'],
  });
  assert.equal((await store.get(a, 'models')).activeThreadId, 'models-1');
  assert.equal((await store.get(b, 'story')).activeThreadId, 'story-b');
  assert.equal((await store.get(b, 'models')).activeThreadId, null);
  await store.clearActive(a, 'story');
  assert.deepEqual(await new CodexChatStateStore(home).get(a, 'story'), {
    activeThreadId: null,
    threadIds: ['story-2', 'story-1'],
  });
  await store.remember(a, 'story', 'story-1');
  assert.deepEqual(await new CodexChatStateStore(home).get(a, 'story'), {
    activeThreadId: 'story-1',
    threadIds: ['story-1', 'story-2'],
  });
  console.log('Per-project and per-stage Codex chat persistence tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
