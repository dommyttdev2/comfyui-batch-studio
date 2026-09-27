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
  const { buildGrokTask } = await import(
    pathToFileURL(path.join(runtime, 'main', 'grok-context.js')).href
  );

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
    title: stage === 'story-initial' ? 'Story discussion' : 'Prompt Plan',
    prompt:
      stage === 'story-initial'
        ? 'Discuss the story using project_brief.json. ' + extra
        : 'Build prompt plan. ' + extra + '\n\n' + artifactFileOutputRules('prompt_plan.json'),
    attachments: [
      {
        name: stage === 'story-initial' ? 'project_brief.json' : 'story.md',
        path: storyPath,
        purpose: stage === 'story-initial' ? 'brief reference' : 'story reference',
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

  const storyTurn = await runner.run(root, 'story', 'story-initial', 'consider alternatives');
  const storyStart = starts.at(-1);
  assert.equal(storyStart.turn.turnId, storyTurn.turnId);
  assert.ok(storyStart.request.workspace, 'Discussion turn must also use an isolated workspace');
  assert.equal(
    'outputPath' in storyStart.request.workspace,
    false,
    'Conversation workspace must not masquerade as an artifact workspace',
  );
  assert.match(storyStart.request.prompt, /input\/1-project_brief\.json/);
  assert.match(storyStart.request.prompt, /input\/ から参照/);
  const conversationDirectory = storyStart.request.workspace.directory;
  assert.equal(fs.existsSync(conversationDirectory), true);
  waits.get(storyTurn.turnId).resolve();
  await waitUntil(() => !runner.isBusy(root, 'story'), 'story discussion did not finish');
  await waitUntil(
    () => !fs.existsSync(conversationDirectory),
    'isolated conversation workspace was not cleaned up',
  );

  assert.equal(
    events.some((entry) => entry.context.root === root && entry.context.stage === 'prompt-plan'),
    true,
  );
  assert.equal(
    events.some((entry) => entry.context.root === root && entry.context.stage === 'story'),
    true,
  );

  // Compare the real Grok Web task builder with the CLI transport. The semantic
  // task body must stay identical; only attachment delivery and artifact return
  // mechanics are allowed to differ.
  const parityRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grok-cli-parity-project-'));
  fs.writeFileSync(
    path.join(parityRoot, 'project_brief.json'),
    JSON.stringify({ schemaVersion: 1 }),
    'utf8',
  );
  const parityRunner = new GrokCliTaskRunner({
    userDataPath: userData,
    adapter,
    sessions,
    onEvent: () => {},
    onArtifact: () => {},
    importArtifact,
  });

  const webDiscussion = await buildGrokTask(
    parityRoot,
    'story-initial',
    'same discussion condition',
  );
  const discussionTurn = await parityRunner.run(
    parityRoot,
    'story',
    'story-initial',
    'same discussion condition',
  );
  const discussionRequest = starts.at(-1).request;
  assert.equal(
    discussionRequest.prompt.startsWith(webDiscussion.prompt),
    true,
    'CLI discussion must preserve the current Grok Web semantic prompt',
  );
  assert.match(discussionRequest.prompt, /input\/1-project_brief\.json/);
  waits.get(discussionTurn.turnId).resolve();
  await waitUntil(() => !parityRunner.isBusy(parityRoot, 'story'), 'parity discussion did not finish');

  const webFinalize = await buildGrokTask(parityRoot, 'story-finalize', '');
  const finalizeSemanticPrompt = webFinalize.prompt
    .replace(artifactFileOutputRules('story.md'), '')
    .trim();
  const finalizeTurn = await parityRunner.run(parityRoot, 'story', 'story-finalize', '');
  const finalizeRequest = resumes.at(-1).request;
  assert.equal(
    finalizeRequest.prompt.startsWith(finalizeSemanticPrompt),
    true,
    'CLI artifact task must preserve the current Grok Web semantic prompt',
  );
  assert.equal(
    finalizeRequest.prompt.includes('ダウンロード可能な添付ファイル'),
    false,
    'CLI artifact task must replace only the Web attachment return contract',
  );
  assert.match(finalizeRequest.prompt, /## Batch Studio向け成果物出力契約/);
  fs.writeFileSync(finalizeRequest.workspace.outputPath, '# Story\nCLI parity output', 'utf8');
  waits.get(finalizeTurn.turnId).resolve();
  await waitUntil(() => !parityRunner.isBusy(parityRoot, 'story'), 'parity finalize did not finish');

  console.log(
    'Grok CLI runner common session, workspace, resume, artifact import and Web-flow parity tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
