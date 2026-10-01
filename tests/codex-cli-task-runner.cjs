const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-codex-cli-runner-'));
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

(async () => {
  const [{ CodexCliTaskRunner }, { AgentSessionStateStore }] = await Promise.all([
    import(pathToFileURL(path.join(runtime, 'main', 'codex-cli-task-runner.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-session-state.js')).href),
  ]);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-runner-userdata-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-runner-project-'));
  fs.writeFileSync(path.join(root, 'story.md'), '# Story\nReference', 'utf8');
  fs.writeFileSync(
    path.join(root, 'prompt_plan.json'),
    JSON.stringify({
      schemaVersion: 2,
      triggerWordsMode: 'selected',
      common: { positive: {}, negative: {}, triggerWords: [] },
      rootLoras: [],
      branches: [],
    }),
    'utf8',
  );

  const waits = new Map();
  const starts = [];
  const resumes = [];
  const stops = [];
  let sequence = 0;
  const adapter = {
    provider: 'codex',
    capabilities: {
      structuredEvents: true,
      sessionResume: true,
      fileWorkspace: true,
      modelSelection: true,
      reasoningEffort: true,
    },
    async checkAvailability() {
      return { provider: 'codex', state: 'available', version: '0.155.1', message: null };
    },
    async getModels() {
      return {
        models: [
          {
            id: 'gpt-6-sol',
            displayName: 'GPT-6-Sol',
            supportedReasoningEfforts: ['low', 'medium', 'high'],
          },
        ],
        selection: { model: 'gpt-6-sol', reasoningEffort: 'medium' },
      };
    },
    async startTask(request, onEvent) {
      const turn = {
        provider: 'codex',
        sessionId: 'codex-session-1',
        turnId: 'codex-runner-turn-' + ++sequence,
      };
      starts.push({ request, turn });
      waits.set(turn.turnId, deferred());
      onEvent({ type: 'session.started', at: 1, sessionId: turn.sessionId });
      onEvent({ type: 'turn.started', at: 1, turnId: turn.turnId });
      return turn;
    },
    async resumeTask(sessionId, request, onEvent) {
      const turn = {
        provider: 'codex',
        sessionId,
        turnId: 'codex-runner-turn-' + ++sequence,
      };
      resumes.push({ sessionId, request, turn });
      waits.set(turn.turnId, deferred());
      onEvent({ type: 'session.started', at: 2, sessionId });
      onEvent({ type: 'turn.started', at: 2, turnId: turn.turnId });
      return turn;
    },
    async waitForCompletion(turnId) {
      await waits.get(turnId).promise;
    },
    async stop(turnId) {
      stops.push(turnId);
      waits
        .get(turnId)
        ?.reject(Object.assign(new Error('cancelled'), { name: 'AgentTurnCancelledError' }));
    },
    async shutdown() {},
  };

  const sessions = new AgentSessionStateStore(userData);
  const events = [];
  const artifacts = [];
  const imports = [];
  const buildTask = async (_root, stage, extra) => ({
    stage,
    title: stage,
    prompt: stage === 'story-initial' ? 'Discuss story. ' + extra : 'Build artifact. ' + extra,
    attachments: [
      {
        name: 'story.md',
        path: path.join(root, 'story.md'),
        purpose: 'Story reference',
        exists: true,
      },
    ],
  });
  const importArtifact = async (projectRoot, provider, stage, sourceId, raw, notify) => {
    imports.push({ projectRoot, provider, stage, sourceId, raw });
    const event = {
      provider,
      root: projectRoot,
      stage,
      fileName: stage === 'caption' ? 'caption_content.json' : 'prompt_plan.json',
      sourceId,
      phase: 'imported',
    };
    notify?.(event);
    return event;
  };

  const runner = new CodexCliTaskRunner({
    userDataPath: userData,
    adapter,
    sessions,
    onEvent: (context, event) => events.push({ context, event }),
    onArtifact: (event) => artifacts.push(event),
    buildTask,
    importArtifact,
    resolveModel: async () => ({ model: 'gpt-6-sol', reasoningEffort: 'high' }),
  });

  const first = await runner.run(root, 'prompt-plan', 'prompt-plan', 'condition');
  assert.equal(starts.length, 1);
  assert.equal(resumes.length, 0);
  assert.equal(runner.isBusy(root, 'prompt-plan'), true);
  assert.equal(starts[0].request.model.model, 'gpt-6-sol');
  assert.equal(starts[0].request.model.reasoningEffort, 'high');
  assert.ok(starts[0].request.workspace);
  assert.match(starts[0].request.prompt, /input\/1-story\.md/);
  assert.match(starts[0].request.prompt, /## Batch Studio向け成果物出力契約/);
  assert.equal(artifacts.at(-1).phase, 'waiting');

  await assert.rejects(runner.run(root, 'prompt-plan', 'prompt-plan', ''), /回答生成中/);

  fs.writeFileSync(starts[0].request.workspace.outputPath, '{"schemaVersion":2}', 'utf8');
  waits.get(first.turnId).resolve();
  await waitUntil(() => imports.length === 1, 'Codex artifact was not imported');
  await waitUntil(
    () => !runner.isBusy(root, 'prompt-plan'),
    'Codex artifact run did not release busy state',
  );
  assert.equal(imports[0].provider, 'codex');
  assert.equal(imports[0].sourceId, first.sessionId + '/' + first.turnId);

  const second = await runner.run(root, 'prompt-plan', 'prompt-plan-fix', 'fix');
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].sessionId, first.sessionId);
  await runner.stop(root, 'prompt-plan');
  await waitUntil(
    () => !runner.isBusy(root, 'prompt-plan'),
    'Cancelled Codex run did not release busy state',
  );
  assert.deepEqual(stops, [second.turnId]);
  assert.equal(artifacts.at(-1).phase, 'failed');

  const story = await runner.run(root, 'story', 'story-initial', 'alternatives');
  const storyStart = starts.at(-1);
  assert.equal(storyStart.turn.turnId, story.turnId);
  assert.ok(storyStart.request.workspace);
  assert.equal('outputPath' in storyStart.request.workspace, false);
  assert.match(storyStart.request.prompt, /input\/1-story\.md/);
  const conversationDirectory = storyStart.request.workspace.directory;
  waits.get(story.turnId).resolve();
  await waitUntil(() => !runner.isBusy(root, 'story'), 'Codex discussion did not finish');
  await waitUntil(
    () => !fs.existsSync(conversationDirectory),
    'Codex conversation workspace was not cleaned up',
  );

  assert.ok(
    events.some(
      (entry) =>
        entry.context.stage === 'story' &&
        entry.context.taskStage === 'story-initial' &&
        entry.event.type === 'turn.started',
    ),
  );

  const realRunner = new CodexCliTaskRunner({
    userDataPath: userData,
    adapter,
    sessions: new AgentSessionStateStore(
      fs.mkdtempSync(path.join(os.tmpdir(), 'codex-patch-state-')),
    ),
    onEvent: () => {},
    onArtifact: () => {},
    importArtifact,
    resolveModel: async () => ({ model: 'gpt-6-sol', reasoningEffort: 'medium' }),
  });
  const patch = await realRunner.run(root, 'prompt-plan', 'prompt-plan-patch', 'remove bad tag');
  const patchStart = starts.at(-1);
  assert.match(patchStart.request.prompt, /baseSha256/);
  assert.match(patchStart.request.prompt, /input\/1-prompt_plan\.json/);
  assert.match(patchStart.request.prompt, /remove bad tag/);
  assert.equal(patchStart.request.workspace.fileName, 'prompt_plan_patch.json');
  fs.writeFileSync(
    patchStart.request.workspace.outputPath,
    JSON.stringify({ schemaVersion: 1, baseSha256: 'test', operations: [] }),
    'utf8',
  );
  waits.get(patch.turnId).resolve();
  await waitUntil(() => !realRunner.isBusy(root, 'prompt-plan'), 'Codex patch run did not finish');

  console.log(
    'Codex CLI task runner session, workspace, cancellation, artifact and Prompt Plan patch tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
