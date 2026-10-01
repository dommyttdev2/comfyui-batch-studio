const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-agent-foundation-'));
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
assert.match(source('src/shared/ipc.ts'), /AGENT_EVENT: 'agent:event'/);
assert.match(source('src/preload/index.cjs'), /onEvent: \(listener\)[\s\S]*I\.AGENT_EVENT/);
assert.match(source('src/shared/types.ts'), /export type AgentEvent =/);
assert.match(source('src/main/agent-cli-adapter.ts'), /export interface AgentCliAdapter/);

(async () => {
  const { AgentSessionStateStore } = await import(
    pathToFileURL(path.join(runtime, 'main', 'agent-session-state.js')).href
  );
  const {
    prepareAgentWorkspace,
    agentWorkspaceOutputInstruction,
    rememberAgentWorkspace,
    findAgentWorkspace,
    readAgentWorkspaceOutput,
  } = await import(pathToFileURL(path.join(runtime, 'main', 'agent-workspace.js')).href);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-agent-user-data-'));
  const projectA = path.join(userData, 'project-a');
  const projectB = path.join(userData, 'project-b');
  fs.mkdirSync(projectA, { recursive: true });
  fs.mkdirSync(projectB, { recursive: true });

  const sessions = new AgentSessionStateStore(userData);
  await Promise.all([
    sessions.remember(projectA, 'story', 'grok', 'grok-story-1'),
    sessions.remember(projectA, 'story', 'codex', 'codex-story-1'),
    sessions.remember(projectA, 'models', 'grok', 'grok-models-1'),
    sessions.remember(projectB, 'story', 'grok', 'grok-story-b'),
  ]);
  await sessions.remember(projectA, 'story', 'grok', 'grok-story-2');

  assert.deepEqual(await sessions.get(projectA, 'story', 'grok'), {
    activeSessionId: 'grok-story-2',
    sessionIds: ['grok-story-2', 'grok-story-1'],
  });
  assert.deepEqual(await sessions.get(projectA, 'story', 'codex'), {
    activeSessionId: 'codex-story-1',
    sessionIds: ['codex-story-1'],
  });
  assert.equal((await sessions.get(projectA, 'models', 'grok')).activeSessionId, 'grok-models-1');
  assert.equal((await sessions.get(projectB, 'story', 'grok')).activeSessionId, 'grok-story-b');
  assert.equal((await sessions.get(projectB, 'story', 'codex')).activeSessionId, null);

  await sessions.clearActive(projectA, 'story', 'grok');
  assert.deepEqual(await new AgentSessionStateStore(userData).get(projectA, 'story', 'grok'), {
    activeSessionId: null,
    sessionIds: ['grok-story-2', 'grok-story-1'],
  });
  await assert.rejects(
    sessions.remember(projectA, 'story', 'grok', '   '),
    /Invalid agent session ID/,
  );

  const grokWorkspace = await prepareAgentWorkspace(userData, 'grok', 'prompt-plan', [
    { name: '../story.md', content: '# Story' },
    { name: 'models.json', content: '{"schemaVersion":3}' },
  ]);
  const codexWorkspace = await prepareAgentWorkspace(userData, 'codex', 'prompt-plan', [
    { name: 'story.md', content: '# Story' },
  ]);
  assert.ok(grokWorkspace.directory.includes(path.join('batch-studio-agent-workspaces', 'grok')));
  assert.ok(codexWorkspace.directory.includes(path.join('batch-studio-agent-workspaces', 'codex')));
  assert.notEqual(grokWorkspace.directory, codexWorkspace.directory);
  assert.deepEqual(fs.readdirSync(grokWorkspace.inputDirectory), ['1-story.md', '2-models.json']);
  assert.match(agentWorkspaceOutputInstruction(grokWorkspace), /output\/prompt_plan\.json/);
  assert.match(
    agentWorkspaceOutputInstruction(grokWorkspace),
    /input\/ 内の参照ファイルは読み取り専用/,
  );

  await assert.rejects(
    readAgentWorkspaceOutput(grokWorkspace),
    /output\/prompt_plan\.json を生成しませんでした/,
  );
  fs.writeFileSync(grokWorkspace.outputPath, '{"schemaVersion":2}');
  assert.equal(await readAgentWorkspaceOutput(grokWorkspace), '{"schemaVersion":2}');

  await rememberAgentWorkspace(projectA, grokWorkspace, 'grok-session-1', 'grok-turn-1');
  const restored = await findAgentWorkspace(
    projectA,
    userData,
    'grok',
    'grok-session-1',
    'grok-turn-1',
    'prompt-plan',
  );
  assert.equal(restored?.outputPath, grokWorkspace.outputPath);
  assert.equal(
    await findAgentWorkspace(
      projectA,
      userData,
      'codex',
      'grok-session-1',
      'grok-turn-1',
      'prompt-plan',
    ),
    null,
    'workspace records must remain provider-isolated',
  );
  assert.equal(
    await findAgentWorkspace(
      projectA,
      userData,
      'grok',
      'grok-session-1',
      'grok-turn-1',
      'caption',
    ),
    null,
    'workspace records must remain stage-isolated',
  );

  fs.unlinkSync(grokWorkspace.outputPath);
  if (process.platform === 'win32') {
    fs.symlinkSync(grokWorkspace.inputDirectory, grokWorkspace.outputPath, 'junction');
  } else {
    fs.symlinkSync(
      path.join(grokWorkspace.inputDirectory, '2-models.json'),
      grokWorkspace.outputPath,
    );
  }
  await assert.rejects(readAgentWorkspaceOutput(grokWorkspace), /通常のファイルではない/);

  console.log('Common agent session, workspace, event IPC and adapter contracts passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
