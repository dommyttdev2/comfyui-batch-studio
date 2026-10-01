const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-agent-phase7-'));
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
const grokRunner = source('src/main/grok-cli-task-runner.ts');
const codexRunner = source('src/main/codex-cli-task-runner.ts');
const codexAdapter = source('src/main/codex-cli-adapter.ts');
const grokAdapter = source('src/main/grok-cli-adapter.ts');
const codexAdapterTest = source('tests/codex-cli-adapter.cjs');
const grokAdapterTest = source('tests/grok-cli-adapter.cjs');

for (const stage of [
  'story-initial',
  'story-finalize',
  'story-fix',
  'models',
  'models-fix',
  'prompt-plan',
  'prompt-plan-fix',
  'prompt-plan-patch',
  'caption',
]) {
  assert.match(grokRunner + codexRunner, new RegExp("'" + stage + "'"), 'Missing task: ' + stage);
}
for (const adapter of [codexAdapter, grokAdapter]) {
  assert.match(adapter, /['"]missing['"]/);
  assert.match(adapter, /unauthenticated/);
}
for (const adapterTest of [codexAdapterTest, grokAdapterTest]) assert.match(adapterTest, /cancel/i);
assert.match(source('tests/model-downstream-reset.cjs'), /stale|reset/i);
assert.match(source('tests/caption-stale.cjs'), /stale/i);
assert.match(source('tests/multi-window.cjs'), /Project windows|projectWindows/);

(async () => {
  const [
    { AgentSessionStateStore },
    { AgentConversationStore },
    { AgentModelSelectionStore },
    { AssistantProviderStore },
    { prepareAgentWorkspace, readAgentWorkspaceOutput },
    { importAutoArtifact },
    { sanitizeAgentDiagnostic },
  ] = await Promise.all([
    import(pathToFileURL(path.join(runtime, 'main', 'agent-session-state.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-conversation-store.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-model-selection.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'assistant-provider-state.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-workspace.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-artifact-import.js')).href),
    import(pathToFileURL(path.join(runtime, 'main', 'agent-cli-diagnostic.js')).href),
  ]);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-agent-phase7-userdata-'));
  const projectA = path.join(userData, 'project-a');
  const projectB = path.join(userData, 'project-b');
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });

  const sessions = new AgentSessionStateStore(userData);
  const conversations = new AgentConversationStore(userData);
  const models = new AgentModelSelectionStore(userData);
  const providers = new AssistantProviderStore(userData);

  await sessions.remember(projectA, 'story', 'grok', 'grok-story-session');
  await sessions.remember(projectA, 'story', 'codex', 'codex-story-session');
  await sessions.remember(projectB, 'story', 'grok', 'grok-project-b-session');
  await conversations.upsert(projectA, 'story', 'grok', 'grok-story-session', {
    id: 'message-1',
    role: 'assistant',
    text: 'restored answer',
    at: 1,
  });
  await models.remember(projectA, 'story', 'grok', {
    model: 'grok-test-model',
    reasoningEffort: 'high',
  });
  await providers.remember(projectA, 'grok', 'story');
  await providers.remember(projectA, 'codex', 'models');

  // Simulate application restart by reconstructing every store from the same userData.
  const restoredSessions = new AgentSessionStateStore(userData);
  const restoredConversations = new AgentConversationStore(userData);
  const restoredModels = new AgentModelSelectionStore(userData);
  const restoredProviders = new AssistantProviderStore(userData);

  assert.equal(
    (await restoredSessions.get(projectA, 'story', 'grok')).activeSessionId,
    'grok-story-session',
  );
  assert.equal(
    (await restoredSessions.get(projectA, 'story', 'codex')).activeSessionId,
    'codex-story-session',
  );
  assert.equal(
    (await restoredSessions.get(projectB, 'story', 'grok')).activeSessionId,
    'grok-project-b-session',
  );
  assert.deepEqual(
    await restoredConversations.messages(projectA, 'story', 'grok', 'grok-story-session'),
    [{ id: 'message-1', role: 'assistant', text: 'restored answer', at: 1 }],
  );
  assert.deepEqual(await restoredModels.get(projectA, 'story', 'grok'), {
    model: 'grok-test-model',
    reasoningEffort: 'high',
  });
  assert.equal(await restoredProviders.get(projectA, 'story'), 'grok');
  assert.equal(await restoredProviders.get(projectA, 'models'), 'codex');
  assert.equal(await restoredProviders.get(projectB, 'story'), null);

  const workspace = await prepareAgentWorkspace(userData, 'grok', 'caption', []);
  await assert.rejects(
    readAgentWorkspaceOutput(workspace),
    /caption_content\.json を生成しませんでした/,
  );
  const invalid = await importAutoArtifact(projectA, 'grok', 'caption', 'session/invalid', '');
  assert.equal(invalid.phase, 'invalid');

  const secret = 'xai-phase7-never-log-this';
  const diagnostic = sanitizeAgentDiagnostic(
    'failure XAI_API_KEY=' + secret + ' Authorization: Bearer another-secret-token',
    { XAI_API_KEY: secret },
  );
  assert.doesNotMatch(diagnostic, /never-log-this|another-secret-token/);
  assert.match(diagnostic, /\[REDACTED\]/);

  console.log(
    'Phase 7 agent regression matrix: stages, restart restore, isolation, invalid artifacts and secret redaction passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
