const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-cli-runner-'));
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
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(message);
}

(async () => {
  const [{ GrokCliTaskRunner }, { AgentSessionStateStore }, { artifactFileOutputRules }] =
    await Promise.all([
      import(pathToFileURL(path.join(runtime, 'main', 'grok-cli-task-runner.js')).href),
      import(pathToFileURL(path.join(runtime, 'main', 'agent-session-state.js')).href),
      import(pathToFileURL(path.join(runtime, 'main', 'grok-context.js')).href),
    ]);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-runner-userdata-'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-runner-project-'));
  const storyPath = path.join(root, 'story.md');
  fs.writeFileSync(storyPath, '# Story\nReference body', 'utf8');

  const waits = new Map();
  const starts = [];
  const resumes = [];
  const stops = [];
  let turnSequence = 0;
  const adapter = {
    provider: 'grok',
    capabilities: {
      structuredEvents: true,
      sessionResume: true,
      fileWorkspace: true,
      modelSelection: true,
      reasoningEffort: true,
    },
    async checkAvailability() {
      return { provider: 'grok', state: 'available', version: '0.2.120', message: null };
    },
    async getModels() {
      return {
        models: [{ id: 'grok-4.6', displayName: 'grok-4.6' }],
        selection: { model: 'grok-4.6', reasoningEffort: 'high' },
      };
    },
    async startTask(request, onEvent) {
      const turn = {
        provider: 'grok',
        sessionId: '11111111-1111-4111-8111-111111111111',
        turnId: 'runner-turn-' + ++turnSequence,
      };
      starts.push({ request, turn });
      waits.set(turn.turnId, deferred());
      onEvent({ type: 'session.started', at: 1, sessionId: turn.sessionId });
      onEvent({ type: 'turn.started', at: 1, turnId: turn.turnId });
      return turn;
    },
    async resumeTask(sessionId, request, onEvent) {
      const turn = {
        provider: 'grok',
        sessionId,
        turnId: 'runner-turn-' + ++turnSequence,
      };
      resumes.push({ sessionId, request, turn });
      waits.set(turn.turnId, deferred());
      onEvent({ type: 'session.started', at: 2, sessionId });
      onEvent({ type: 'turn.started', at: 2, turnId: turn.turnId });
      return turn;
    },
    async waitForCompletion(turnId) {
      const gate = waits.get(turnId);
      if (!gate) throw new Error('missing wait gate');
      await gate.promise;
    },
    async stop(turnId) {
      stops.push(turnId);
      waits.get(turnId)?.reject(new Error('cancelled'));
    },
    async shutdown() {},
  };

  const sessions = new AgentSessionStateStore(userData);
  const events = [];
  const artifacts = [];
  const imports = [];
  const buildTask = async (_root, stage, extra) => ({
    stage,
    title: 'Prompt Plan',
    prompt: 'Build prompt plan. ' + extra + '\n\n' + artifactFileOutputRules('prompt_plan.json'),
    attachments: [
      {
        name: 'story.md',
        path: storyPath,
        purpose: 'story reference',
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
      fileName: 'prompt_plan.json',
      sourceId,
      phase: 'imported',
    };
    notify?.(event);
    return event;
  };

  const runner = new GrokCliTaskRunner({
    userDataPath: userData,
    adapter,
    sessions,
    onEvent: (context, event) => events.push({ context, event }),
    onArtifact: (event) => artifacts.push(event),
    buildTask,
    importArtifact,
  });

  const first = await runner.run(root, 'prompt-plan', 'prompt-plan', 'extra condition');
  assert.equal(starts.length, 1);
  assert.equal(resumes.length, 0);
  assert.equal(runner.isBusy(root, 'prompt-plan'), true);
  assert.equal(starts[0].request.model.model, 'grok-4.6');
  assert.equal(starts[0].request.model.reasoningEffort, 'high');
  assert.ok(starts[0].request.workspace);
  assert.match(starts[0].request.prompt, /## Batch Studio向け成果物出力契約/);
  assert.match(starts[0].request.prompt, /input\/1-story\.md/);
  assert.equal(
    starts[0].request.prompt.includes(artifactFileOutputRules('prompt_plan.json')),
    false,
    'Web return contract must be replaced by the shared file workspace contract',
  );
  assert.equal(
    fs.readFileSync(path.join(starts[0].request.workspace.inputDirectory, '1-story.md'), 'utf8'),
    '# Story\nReference body',
  );
  assert.equal(artifacts.at(-1).phase, 'waiting');

  await assert.rejects(
    runner.run(root, 'prompt-plan', 'prompt-plan', ''),
    /回答生成中/,
    'A project/stage may have only one active Grok CLI turn',
  );

  fs.writeFileSync(starts[0].request.workspace.outputPath, '{"schemaVersion":2}', 'utf8');
  waits.get(first.turnId).resolve();
  await waitUntil(() => imports.length === 1, 'first artifact was not imported');
  await waitUntil(
    () => !runner.isBusy(root, 'prompt-plan'),
    'first run did not release busy state',
  );

  assert.equal(imports[0].raw, '{"schemaVersion":2}');
  assert.equal(imports[0].provider, 'grok');
  assert.equal(imports[0].sourceId, first.sessionId + '/' + first.turnId);
  assert.equal(artifacts.at(-1).phase, 'imported');

  const stored = await sessions.get(root, 'prompt-plan', 'grok');
  assert.equal(stored.activeSessionId, first.sessionId);

  const second = await runner.run(root, 'prompt-plan', 'prompt-plan-fix', 'fix it');
  assert.equal(resumes.length, 1);
  assert.equal(resumes[0].sessionId, first.sessionId);
  assert.equal(second.sessionId, first.sessionId);
  await runner.stop(root, 'prompt-plan');
  assert.deepEqual(stops, [second.turnId]);
  await waitUntil(
    () => !runner.isBusy(root, 'prompt-plan'),
    'cancelled run did not release busy state',
  );
  assert.equal(artifacts.at(-1).phase, 'failed');

  assert.equal(
    events.every((entry) => entry.context.root === root && entry.context.stage === 'prompt-plan'),
    true,
  );

  console.log(
    'Grok CLI runner common session, workspace, resume, stop and artifact import tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
