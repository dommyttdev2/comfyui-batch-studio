const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repo = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(repo, 'src/main/main.ts'), 'utf8');
const pane = fs.readFileSync(path.join(repo, 'src/renderer/CodexPane.tsx'), 'utf8');

const snapshot = main.slice(
  main.indexOf('async function codexSnapshot('),
  main.indexOf('async function codexAccount('),
);
const send = main.slice(
  main.indexOf('async function codexSend('),
  main.indexOf('const codexTaskContexts:'),
);
const rendererSend = pane.slice(
  pane.indexOf('const send = async'),
  pane.indexOf('const selectChat'),
);

assert.ok(
  snapshot.includes('readCodexHistory('),
  'Saved history must remain readable',
);
assert.ok(
  !snapshot.includes("'thread/resume'"),
  'Viewing history must never resume an unpersisted thread',
);
assert.match(
  snapshot,
  /if \(busy\)\s*return/,
  'Snapshot must bypass disk reads during an active turn',
);
assert.match(
  snapshot,
  /historyUnavailable: true/,
  'Unpersisted or missing rollouts should show a recoverable state',
);
assert.match(
  snapshot,
  /setTimeout\(resolve, 250\)/,
  'Recently finished turns should have time to persist',
);
assert.ok(
  send.indexOf('codexBusy.has(threadId)') < send.indexOf("server.request('thread/resume'"),
  'A running turn must not be resumed by a second send',
);
assert.match(
  send,
  /\.\.\.\(await store\.get\(context\.root, context\.stage\)\)/,
  'Send must return thread IDs without reading rollout history',
);
assert.ok(
  !rendererSend.includes('codex.snapshot('),
  'Immediately after turn/start the renderer must not request a saved rollout',
);
assert.match(
  rendererSend,
  /setSnapshot\(\(previous\)/,
  'Thread selection must update from send metadata',
);
assert.match(pane, /履歴を再読み込み/, 'A missing rollout must provide a non-destructive retry');
console.log('Codex first-turn snapshot race regression tests passed.');
