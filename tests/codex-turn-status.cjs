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
const main = source('src/main/main.ts') + source('src/main/ipc-registration.ts');
const pane = source('src/renderer/CodexPane.tsx');
const ipc = source('src/shared/ipc.ts');
const preload = source('src/preload/index.cjs');
const types = source('src/shared/types.ts');
assert.match(ipc, /CODEX_STOP_TURN: 'codex:stop-turn'/);
assert.match(preload, /stopTurn: \(\) => ipcRenderer\.invoke\(I\.CODEX_STOP_TURN\)/);
assert.match(types, /stopTurn: \(\) => Promise<CodexSnapshot>/);
assert.match(main, /handleIpc\(IPC\.CODEX_STOP_TURN/);
assert.match(main, /server\.request\('turn\/interrupt', \{ threadId, turnId \}\)/);
assert.match(main, /codexTurnStartRequests\.set\(threadId, turnIdRequest\)/);
assert.match(main, /codexActiveTurnIds\.get\(threadId\)/);
assert.match(main, /if \(!codexBusy\.has\(threadId\)\) return;/);
assert.match(
  main,
  /if \(notification\.method === 'turn\/completed' && typeof threadId === 'string'\) \{/,
);
assert.match(main, /codexBusy\.delete\(threadId\)/);
assert.match(
  main,
  /if \(turn\?\.status !== 'completed'\)/,
  'Interrupted artifact turns must not import incomplete files',
);
assert.match(pane, /window\.batchStudio\.codex\.stopTurn\(\)/);
assert.match(pane, /現在の生成を中止/);
assert.match(pane, /disabled=\{stopping\}/);
assert.match(pane, /if \(event\.method === 'turn\/completed'\) \{[\s\S]*setStopping\(false\)/);
assert.match(main, /codexTurnMonitor\.notification\(threadId, notification\)/);
assert.match(main, /codexTurnMonitor\.fromRead\(saved\.activeThreadId, read\)/);
assert.match(main, /codexTurnMonitor\.disconnected\(\)/);
assert.match(main, /model: settings\.selection\.model/);
assert.match(main, /effort: settings\.selection\.effort/);
assert.match(main, /server\.request\('model\/list'/);
assert.match(pane, /Codexモデル/);
assert.match(pane, /Codex推論強度/);
assert.match(pane, /経過時間:/);
assert.match(main, /safeCodexActivityEvent\(notification\.method, notification\.params\)/);
assert.match(main, /summary: 'auto'/, 'Each Codex turn should request a reasoning summary');
assert.match(main, /activity: codexActivityFromHistory\(read\)/);
assert.match(
  pane,
  /updateCodexActivity\(previous, value\)/,
  'Codex pane must render work progress independently of final answer streaming',
);
assert.match(pane, /思考要約・作業状況/);

assert.match(pane, /phaseLabel\[turnStatus\.phase\]/);
assert.match(
  pane,
  /const taskSendDisabledReason = loading[\s\S]*!account\?\.authenticated[\s\S]*modelLoading[\s\S]*!modelSettings/,
  'Disabled task send must explain its precise prerequisite rather than fail silently',
);
assert.match(
  pane,
  /title=\{taskSendDisabledReason \?\?/,
  'Disabled buttons must explain the reason',
);
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
  const { readCodexHistory } = await import(
    pathToFileURL(path.join(runtime, 'main', 'codex-thread-history.js')).href
  );

  const {
    emptyCodexActivity,
    safeCodexActivityEvent,
    updateCodexActivity,
    codexActivityFromHistory,
  } = await import(pathToFileURL(path.join(runtime, 'shared', 'codex-activity.js')).href);
  const notification = (method, params) => safeCodexActivityEvent(method, params);
  const art = 'private-unique-artifact-payload';
  assert.equal(
    notification('item/agentMessage/delta', { turnId: 't1', itemId: 'answer', delta: art }),
    null,
    'Artifact answer streaming must not be mixed into work activity',
  );
  assert.equal(
    notification('item/reasoning/textDelta', { turnId: 't1', itemId: 'r1', delta: art }),
    null,
    'Never display raw reasoning even if a model supplies it',
  );
  assert.equal(
    notification('item/started', {
      turnId: 't1',
      item: { id: 'a', type: 'agentMessage', text: art },
    }),
    null,
    'Never forward full assistant output items as activity',
  );
  let activity = emptyCodexActivity();
  const apply = (method, params) => {
    const event = notification(method, { threadId: 'thread1', ...params });
    assert.ok(event, `Recognized activity event: ${method}`);
    activity = updateCodexActivity(activity, event);
  };
  apply('turn/started', { turnId: 't1' });
  apply('item/started', {
    turnId: 't1',
    item: { type: 'reasoning', id: 'r1', content: [art], status: 'inProgress' },
  });
  apply('item/reasoning/summaryTextDelta', {
    turnId: 't1',
    itemId: 'r1',
    summaryIndex: 0,
    delta: '検討中',
  });
  apply('item/reasoning/summaryPartAdded', { turnId: 't1', itemId: 'r1', summaryIndex: 1 });
  apply('item/reasoning/summaryTextDelta', {
    turnId: 't1',
    itemId: 'r1',
    summaryIndex: 1,
    delta: '次の手順',
  });
  assert.match(activity.items[0].summary, /検討中[\s\S]*次の手順/);
  apply('item/started', {
    turnId: 't1',
    item: { type: 'commandExecution', id: 'cmd', command: 'npm test', status: 'inProgress' },
  });
  apply('item/commandExecution/outputDelta', {
    turnId: 't1',
    itemId: 'cmd',
    delta: 'ok',
  });
  apply('item/completed', {
    turnId: 't1',
    item: {
      type: 'commandExecution',
      id: 'cmd',
      command: 'npm test',
      status: 'completed',
      aggregatedOutput: 'all tests passed',
      arguments: art,
    },
  });
  assert.equal(activity.items[1].title, 'npm test');
  assert.equal(activity.items[1].output, 'all tests passed');
  assert.equal(activity.items[1].status, 'completed');
  assert.ok(
    !JSON.stringify(activity).includes(art),
    'No arbitrary tool arguments or raw reasoning',
  );
  const wrongTurn = notification('item/plan/delta', {
    turnId: 'another-turn',
    itemId: 'plan',
    delta: 'wrong',
  });
  assert.deepEqual(updateCodexActivity(activity, wrongTurn), activity);
  apply('turn/started', { turnId: 't2' });
  assert.equal(activity.items.length, 0, 'New turn must clear the previous activity');
  assert.equal(activity.turnId, 't2');
  const restoredActivity = codexActivityFromHistory({
    thread: {
      turns: [
        {
          id: 't3',
          items: [
            {
              id: 'r',
              type: 'reasoning',
              summary: [{ text: 'Persisted summary' }],
              content: [art],
            },
            { id: 'c', type: 'commandExecution', command: 'git status', status: 'completed' },
            { id: 'answer', type: 'agentMessage', text: art },
          ],
        },
      ],
    },
  });
  assert.equal(restoredActivity.turnId, 't3');
  assert.equal(restoredActivity.items[0].summary, 'Persisted summary');
  assert.equal(restoredActivity.items[1].title, 'git status');
  assert.ok(!JSON.stringify(restoredActivity).includes(art));
  assert.ok(!restoredActivity.items.some((entry) => entry.kind === 'agentMessage'));

  const legacyTurn = { id: 'legacy', status: 'completed', items: [{ type: 'userMessage' }] };
  let legacyCalls = 0;
  const legacyHistory = await readCodexHistory(async (method, params) => {
    legacyCalls++;
    assert.equal(method, 'thread/read');
    assert.equal(params.includeTurns, true);
    return { thread: { turns: [legacyTurn] } };
  }, 'legacy-thread');
  assert.equal(legacyCalls, 1, 'Legacy history must not require paging');
  assert.deepEqual(legacyHistory.thread.turns, [legacyTurn]);

  const newest = {
    id: 'third',
    status: 'completed',
    items: [{ type: 'agentMessage', text: 'ok' }],
  };
  const middle = { id: 'second', status: 'completed', items: [{ type: 'userMessage' }] };
  const oldest = { id: 'first', status: 'completed', items: [{ type: 'userMessage' }] };
  const pagedCalls = [];
  const pagedHistory = await readCodexHistory(async (method, params) => {
    pagedCalls.push({ method, params });
    if (method === 'thread/read')
      throw new Error('paginated threads do not support thread/read(includeTurns=true)');
    assert.equal(method, 'thread/turns/list');
    assert.equal(params.threadId, 'paged-thread');
    assert.equal(params.itemsView, 'full', 'Artifact capture requires complete turn items');
    assert.equal(params.sortDirection, 'desc');
    return params.cursor === null
      ? { data: [newest, middle], nextCursor: 'older' }
      : { data: [oldest], nextCursor: null };
  }, 'paged-thread');
  assert.deepEqual(pagedHistory.thread.turns, [oldest, middle, newest]);
  assert.equal(pagedCalls.length, 3);
  assert.equal(pagedCalls[2].params.cursor, 'older');

  const metadataHistory = await readCodexHistory(async (method) => {
    if (method === 'thread/read') return { thread: { historyMode: 'paginated', turns: [] } };
    return { data: [newest], nextCursor: null };
  }, 'metadata-thread');
  assert.deepEqual(metadataHistory.thread.turns, [newest]);

  await assert.rejects(
    () =>
      readCodexHistory(async (method) => {
        if (method === 'thread/read') throw new Error('permission denied');
        return { data: [], nextCursor: null };
      }, 'denied'),
    /permission denied/,
    'Unrelated read errors must not be swallowed by the paginated fallback',
  );
  await assert.rejects(
    () =>
      readCodexHistory(async (method) => {
        if (method === 'thread/read')
          throw new Error('paginated threads do not support thread/read(includeTurns=true)');
        return { data: [], nextCursor: 'same' };
      }, 'invalid-cursor'),
    /ページ送りが停止/,
    'Repeated cursors must not loop forever or silently truncate conversation history',
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
