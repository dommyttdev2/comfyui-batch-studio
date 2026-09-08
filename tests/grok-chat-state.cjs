const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-chat-state-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(process.execPath, [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime], {
  cwd: repo,
  stdio: 'inherit'
});

(async () => {
  const { GrokChatStateStore } = await import(pathToFileURL(path.join(runtime, 'main', 'grok-chat-state.js')).href);
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-user-data-'));
  const projectA = path.join(userData, 'project-a');
  const projectB = path.join(userData, 'project-b');
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });

  const first = new GrokChatStateStore(userData);
  await first.remember(projectA, 'story', 'https://grok.com/c/story-a');
  await first.remember(projectA, 'models', 'https://grok.com/c/models-a');
  await first.remember(projectA, 'prompt-plan', 'https://grok.com/c/plan-a');
  await first.remember(projectB, 'story', 'https://grok.com/c/story-b');

  assert.equal(await first.get(projectA, 'story'), 'https://grok.com/c/story-a');
  assert.equal(await first.get(projectA, 'models'), 'https://grok.com/c/models-a');
  assert.equal(await first.get(projectA, 'prompt-plan'), 'https://grok.com/c/plan-a');
  assert.equal(await first.get(projectB, 'story'), 'https://grok.com/c/story-b');
  assert.equal(await first.get(projectB, 'models'), null, 'stages must not share chat state');

  const afterRestart = new GrokChatStateStore(userData);
  assert.equal(await afterRestart.get(projectA, 'story'), 'https://grok.com/c/story-a', 'chat URL must survive restart');
  assert.equal(await afterRestart.get(projectA, 'models'), 'https://grok.com/c/models-a');
  assert.equal(await afterRestart.get(projectB, 'story'), 'https://grok.com/c/story-b', 'projects must remain isolated');

  console.log('Per-project Grok chat persistence tests passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
