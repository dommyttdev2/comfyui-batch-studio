const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-assistant-pane-'));
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
const pane = source('src/renderer/AssistantPane.tsx');
const app = source('src/renderer/App.tsx');
const main = source('src/main/main.ts');
const ipc = source('src/shared/ipc.ts');
const preload = source('src/preload/index.cjs');

for (const channel of [
  'ASSISTANT_SET_CONTEXT',
  'ASSISTANT_CONTEXT',
  'ASSISTANT_CONTEXT_CHANGED',
  'ASSISTANT_SNAPSHOT',
  'ASSISTANT_SEND',
  'ASSISTANT_STOP_TURN',
  'ASSISTANT_NEW_CONVERSATION',
  'ASSISTANT_RESTORE_CONVERSATION',
  'ASSISTANT_MODELS',
  'ASSISTANT_SELECT_MODEL',
]) {
  matchCode(ipc, new RegExp(channel + ':'), `missing common assistant IPC: ${channel}`);
}
for (const api of [
  /assistant\.snapshot\(\)/,
  /assistant\.send\(text\)/,
  /assistant\.stopTurn\(\)/,
  /assistant\.newConversation\(\)/,
  /assistant\.restoreConversation\(sessionId\)/,
  /assistant\.selectModel\(selection\)/,
  /assistant\.onEvent/,
]) {
  matchCode(pane, api, 'AssistantPane must use the common assistant API');
}
matchCode(
  pane,
  /snapshot\?\.capabilities\?\.modelSelection/,
  'Model controls must be gated by provider capabilities',
);
matchCode(
  pane,
  /snapshot\.capabilities\.reasoningEffort/,
  'Reasoning controls must be gated by provider capabilities',
);
matchCode(
  pane,
  /工程成果物の生成・修正・再実行は左側の工程から操作します/,
  'The right pane must keep task controls on the left side',
);
doesNotMatchCode(
  pane,
  /codex\.sendTask|grokTask|selectStageTask/,
  'Provider-specific task controls must not reappear in AssistantPane',
);
matchCode(
  app,
  /assistant\.setContext\(project\.rootPath, context\)/,
  'Project navigation must select the common AssistantPane context',
);
matchCode(
  main,
  /loadRenderer\(assistantView, 'assistant-pane'\)/,
  'The right local view must render AssistantPane',
);
matchCode(
  main,
  /assistantView: WebContentsView/,
  'Project windows must own one provider-neutral AssistantPane view',
);
doesNotMatchCode(
  main,
  /grokView|grokLoadingView|codexView/,
  'Legacy provider views must be removed',
);
matchCode(
  preload,
  /onContext: \(listener\)[\s\S]*ASSISTANT_CONTEXT_CHANGED/,
  'AssistantPane context changes must be exposed through preload',
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

function fakeAdapter(provider, sessionId) {
  let sequence = 0;
  const starts = [];
  const resumes = [];
  const stops = [];
  const active = new Map();
  const adapter = {
    provider,
    capabilities: {
      structuredEvents: true,
      sessionResume: true,
      fileWorkspace: true,
      modelSelection: true,
      reasoningEffort: true,
    },
    async checkAvailability() {
      return { provider, state: 'available', version: 'test', message: null };
    },
    async getModels() {
      return {
        models: [
          {
            id: provider + '-model',
            displayName: provider + ' model',
            supportedReasoningEfforts: ['low', 'high'],
          },
        ],
        selection: { model: provider + '-model', reasoningEffort: 'high' },
      };
    },
    async startTask(request, onEvent) {
      const turn = { provider, sessionId, turnId: provider + '-turn-' + ++sequence };
      const gate = deferred();
      active.set(turn.turnId, { gate, onEvent });
      starts.push({ request, turn });
      onEvent({ type: 'session.started', at: 1, sessionId });
      onEvent({ type: 'turn.started', at: 2, turnId: turn.turnId });
      return turn;
    },
    async resumeTask(requestedSessionId, request, onEvent) {
      assert.equal(requestedSessionId, sessionId);
      const turn = { provider, sessionId, turnId: provider + '-turn-' + ++sequence };
      const gate = deferred();
      active.set(turn.turnId, { gate, onEvent });
      resumes.push({ requestedSessionId, request, turn });
      onEvent({ type: 'session.started', at: 3, sessionId });
      onEvent({ type: 'turn.started', at: 4, turnId: turn.turnId });
      return turn;
    },
    async waitForCompletion(turnId) {
      await active.get(turnId).gate.promise;
    },
    async stop(turnId) {
      stops.push(turnId);
      const run = active.get(turnId);
      run.onEvent({ type: 'turn.cancelled', at: 9, turnId });
      run.gate.reject(new Error('cancelled'));
    },
    async shutdown() {},
  };
  return { adapter, starts, resumes, stops, active };
}

(async () => {
  const [
    { AgentConversationRunner },
    { AgentConversationStore },
    { AgentSessionStateStore },
    { AgentModelSelectionStore },
  ] = await Promise.all([
    import(pathToFileURL(path.join(runtime, 'main', 'agent-conversation-runner.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-conversation-store.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-session-state.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-model-selection.js')).href),
  ]);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-pane-userdata-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-pane-project-'));
  const sessions = new AgentSessionStateStore(userData);
  const conversations = new AgentConversationStore(userData);
  const selections = new AgentModelSelectionStore(userData);
  const grok = fakeAdapter('grok', '11111111-1111-4111-8111-111111111111');
  const codex = fakeAdapter('codex', 'codex-session-1');
  const events = [];
  const models = [];

  const runner = new AgentConversationRunner({
    userDataPath: userData,
    sessions,
    conversations,
    adapter: (provider) => (provider === 'grok' ? grok.adapter : codex.adapter),
    model: async (_root, stage, provider) => {
      models.push({ stage, provider });
      return { model: provider + '-model', reasoningEffort: 'high' };
    },
    onEvent: (provider, context, taskStage, event) =>
      events.push({ provider, context, taskStage, event }),
  });

  const first = await runner.send(root, 'story', 'grok', 'first message');
  assert.equal(grok.starts.length, 1);
  assert.equal(grok.resumes.length, 0);
  assert.equal(runner.isBusy(root, 'story', 'grok'), true);
  assert.equal(grok.starts[0].request.model.model, 'grok-model');
  assert.ok(grok.starts[0].request.workspace, 'Grok chat must use an isolated workspace');
  const grokWorkspace = grok.starts[0].request.workspace.directory;
  assert.equal(fs.existsSync(grokWorkspace), true);

  const firstRun = grok.active.get(first.turnId);
  firstRun.onEvent({ type: 'message.delta', at: 5, text: 'hello ' });
  firstRun.onEvent({ type: 'message.delta', at: 6, text: 'world' });
  firstRun.onEvent({ type: 'message.completed', at: 7, text: 'hello world' });
  firstRun.onEvent({ type: 'turn.completed', at: 8, turnId: first.turnId });
  firstRun.gate.resolve();

  await waitUntil(() => !runner.isBusy(root, 'story', 'grok'), 'Grok conversation did not finish');
  await waitUntil(
    () => !fs.existsSync(grokWorkspace),
    'Grok conversation workspace was not cleaned up',
  );
  await waitUntil(
    async () => (await conversations.messages(root, 'story', 'grok', first.sessionId)).length === 2,
    'Grok conversation history was not persisted',
  );
  assert.deepEqual(
    (await conversations.messages(root, 'story', 'grok', first.sessionId)).map((message) => [
      message.role,
      message.text,
    ]),
    [
      ['user', 'first message'],
      ['assistant', 'hello world'],
    ],
  );

  const second = await runner.send(root, 'story', 'grok', 'second message');
  assert.equal(grok.resumes.length, 1);
  assert.equal(grok.resumes[0].requestedSessionId, first.sessionId);
  assert.equal(second.sessionId, first.sessionId);
  await runner.stop(root, 'story', 'grok');
  await waitUntil(
    () => !runner.isBusy(root, 'story', 'grok'),
    'Cancelled Grok conversation did not release busy state',
  );
  assert.deepEqual(grok.stops, [second.turnId]);

  const codexTurn = await runner.send(root, 'story', 'codex', 'codex message');
  assert.equal(codex.starts.length, 1);
  assert.equal(codex.starts[0].request.workspace, undefined);
  assert.equal(
    (await sessions.get(root, 'story', 'grok')).activeSessionId,
    first.sessionId,
    'Provider sessions must remain isolated',
  );
  assert.equal((await sessions.get(root, 'story', 'codex')).activeSessionId, codexTurn.sessionId);
  const codexRun = codex.active.get(codexTurn.turnId);
  codexRun.onEvent({ type: 'activity', at: 10, label: 'thinking', detail: 'safe summary' });
  codexRun.onEvent({ type: 'tool.started', at: 11, name: 'read_file' });
  codexRun.onEvent({ type: 'tool.completed', at: 12, name: 'read_file', success: true });
  codexRun.onEvent({ type: 'message.completed', at: 13, text: 'codex answer' });
  codexRun.onEvent({ type: 'turn.completed', at: 14, turnId: codexTurn.turnId });
  codexRun.gate.resolve();
  await waitUntil(
    () => !runner.isBusy(root, 'story', 'codex'),
    'Codex conversation did not finish',
  );

  assert.ok(
    events.some(
      (entry) =>
        entry.provider === 'codex' &&
        entry.context.stage === 'story' &&
        entry.taskStage === 'story-initial' &&
        entry.event.type === 'tool.completed',
    ),
    'Common AgentEvent stream must preserve provider/context/task stage',
  );

  await sessions.remember(root, 'story', 'grok', 'older-grok-session');
  await sessions.activate(root, 'story', 'grok', first.sessionId);
  assert.equal((await sessions.get(root, 'story', 'grok')).activeSessionId, first.sessionId);
  await assert.rejects(
    sessions.activate(root, 'story', 'grok', 'unknown-session'),
    /not part of this stage/,
  );

  await selections.remember(root, 'story', 'grok', {
    model: 'grok-model',
    reasoningEffort: 'high',
  });
  await selections.remember(root, 'story', 'codex', {
    model: 'codex-model',
    reasoningEffort: 'low',
  });
  assert.deepEqual(await selections.get(root, 'story', 'grok'), {
    model: 'grok-model',
    reasoningEffort: 'high',
  });
  assert.deepEqual(await selections.get(root, 'story', 'codex'), {
    model: 'codex-model',
    reasoningEffort: 'low',
  });
  assert.ok(models.some((entry) => entry.provider === 'grok'));
  assert.ok(models.some((entry) => entry.provider === 'codex'));

  console.log(
    'Common AssistantPane UI contract, conversation history, resume, cancellation, events and model persistence tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
