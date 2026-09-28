const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-assistant-provider-runtime-'));
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

const read = (relative) => fs.readFileSync(path.join(repo, relative), 'utf8');
matchCode(
  read('src/main/app-settings.ts'),
  /schemaVersion:\s*8/,
  'Agent default settings must migrate with a new schema',
);
matchCode(
  read('src/renderer/EnvironmentSettings.tsx'),
  /使用するチャットエージェント/,
  'Environment settings must expose the chat agent choice',
);
matchCode(
  read('src/renderer/EnvironmentSettings.tsx'),
  /<details className="environment-advanced-settings">/,
  'Advanced compatibility and connection overrides must not clutter everyday settings',
);
matchCode(
  read('src/renderer/EnvironmentSettings.tsx'),
  /<h3>Remote 実行設定<\/h3>/,
  'Remote execution configuration must have a separate section',
);
matchCode(
  read('src/renderer/App.tsx'),
  /getAssistantProvider\(context\)/,
  'App must load the project-specific choice before opening a stage',
);
matchCode(
  read('src/renderer/App.tsx'),
  /setAssistantProvider\(provider, contextStage\)/,
  'Switching agents must persist the selected provider',
);
matchCode(
  read('src/main/main.ts'),
  /assistantProviderState\.resolve\(/,
  'Existing project agent selection must be restored',
);

matchCode(
  read('src/renderer/App.tsx'),
  /\[project\?\.rootPath, stage, providerRestoreRevision\]/,
  'Returning to a stage or retrying must reload its own last selected agent',
);
matchCode(
  read('src/renderer/App.tsx'),
  /paneProviderRoot !== providerKey[\s\S]*この工程のAIエージェントを復元中/,
  "Do not render a stage with another stage's agent before restoration",
);
matchCode(
  read('src/main/main.ts'),
  /assistantProviderState\.resolve\(root, defaultProvider, async \(\) => \{[\s\S]*?\}, stage\)/,
  'The project-level fallback must resolve into a stage-specific provider',
);
matchCode(
  read('src/main/main.ts'),
  /assistantProviderState\.remember\(root, provider, stage\)/,
  'The explicit agent switch must be persisted for only the active stage',
);
matchCode(
  read('src/main/main.ts'),
  /assistantSelectionGeneration !== generation/,
  "Out-of-order restores must not select the previous stage's provider",
);
assert.ok(
  read('src/main/main.ts').includes(
    'ipcMain.handle(IPC.ASSISTANT_GET_PROVIDER, getAssistantProvider)',
  ),
  'Provider selection must work independently of the Codex IPC namespace',
);
assert.ok(
  read('src/main/main.ts').includes(
    'ipcMain.handle(IPC.ASSISTANT_SET_PROVIDER, setAssistantProvider)',
  ),
  'Switching between Grok and Codex must use the shared assistant IPC',
);
assert.ok(
  read('src/preload/index.cjs').includes(
    'getProvider: (stage) => ipcRenderer.invoke(I.ASSISTANT_GET_PROVIDER, stage)',
  ),
  'Grok must not require a Codex-specific API just to load its selection',
);
doesNotMatchCode(
  read('src/renderer/App.tsx'),
  /window\.batchStudio\.codex|window\.batchStudio\.grok/,
  'App must use only the provider-neutral assistant preload API',
);
doesNotMatchCode(
  read('src/main/main.ts'),
  /IPC\.CODEX_|IPC\.GROK_SET_/,
  'Main process must not retain provider-specific pane IPC aliases',
);
const ipc = read('src/shared/ipc.ts');
const preload = read('src/preload/index.cjs');
const main = read('src/main/main.ts');
const stages = read('src/renderer/GrokStages.tsx');
const pane = read('src/renderer/AssistantPane.tsx');
matchCode(
  ipc,
  /AGENT_TASK_START:/,
  'Provider-neutral stage execution must have a shared start IPC channel',
);
matchCode(
  ipc,
  /AGENT_TASK_STOP:/,
  'Provider-neutral stage execution must have a shared stop IPC channel',
);
matchCode(
  preload,
  /startTask: \(root, stage, extra\)/,
  'Project steps must start their exact task through the shared assistant API',
);
matchCode(
  stages,
  /assistant\.startTask\(project\.rootPath, stage, extra\)/,
  'Every AI step must launch its exact stage from the left pane',
);
matchCode(
  stages,
  /assistant\.stopTask\(project\.rootPath, stage\)/,
  'Every AI step must expose shared left-pane cancellation',
);
doesNotMatchCode(
  stages,
  /codex\.selectStageTask\(project\.rootPath, stage\)/,
  'Stage UI must not require Codex right-pane selection before execution',
);
matchCode(
  main,
  /contextStageForTask\(stage as GrokTask\['stage'\]\)/,
  'A shared AI task must resolve to its exact project context stage',
);
doesNotMatchCode(
  pane,
  /selectStageTask|sendTask|grokTask/,
  'The common AssistantPane must not contain provider-specific task controls',
);
for (const expected of [
  "'story-initial'",
  "'story-finalize'",
  "'story-fix'",
  "'models'",
  "'models-fix'",
  "'prompt-plan'",
  "'prompt-plan-fix'",
  "'caption'",
]) {
  matchCode(main, new RegExp(expected), `Codex stage mapping must include ${expected}`);
}

(async () => {
  const { AssistantProviderStore } = await import(
    pathToFileURL(path.join(runtime, 'main', 'assistant-provider-state.js')).href
  );
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-assistant-provider-'));
  const projectA = path.join(userData, 'project-a');
  const projectB = path.join(userData, 'project-b');
  const projectLegacy = path.join(userData, 'legacy');
  const projectCodex = path.join(userData, 'codex');
  const store = new AssistantProviderStore(userData);

  assert.equal(await store.get(projectA), null, 'No prior choice should be stored');
  assert.equal(
    await store.resolve(projectA, 'grok', async () => null),
    'grok',
    'New projects must use the configured default',
  );
  assert.equal(
    await store.resolve(projectB, 'codex', async () => null),
    'codex',
    'Different new projects may start with a different global default',
  );
  assert.equal(
    await store.resolve(projectLegacy, 'codex', async () => 'grok'),
    'grok',
    'A migration callback may preserve a prior Grok preference',
  );
  assert.equal(
    await store.resolve(projectCodex, 'grok', async () => 'codex'),
    'codex',
    'A migration callback may preserve a prior Codex preference',
  );
  await store.remember(projectA, 'codex');
  await store.remember(projectB, 'grok');
  assert.equal(
    await store.resolve(projectA, 'grok', async () => 'grok'),
    'codex',
    'An explicit project choice must override the global setting and inferred history',
  );
  const afterRestart = new AssistantProviderStore(userData);
  assert.equal(await afterRestart.get(projectA), 'codex', 'Project choice must survive restart');
  assert.equal(await afterRestart.get(projectB), 'grok', 'Projects must remain isolated');
  assert.equal(await afterRestart.get(projectLegacy), 'grok');
  assert.equal(await afterRestart.get(projectCodex), 'codex');
  await Promise.all([
    store.remember(projectA, 'grok'),
    store.remember(projectB, 'codex'),
    store.remember(projectA, 'codex'),
  ]);
  assert.equal(await afterRestart.get(projectA), 'codex', 'Last explicit choice must be retained');
  assert.equal(
    await afterRestart.get(projectB),
    'codex',
    'Concurrent writes must not drop projects',
  );
  // Each planning stage remembers its own last opened agent, including after
  // moving through non-AI stages and reopening the project.
  await store.remember(projectA, 'grok', 'story');
  await store.remember(projectA, 'codex', 'models');
  await store.remember(projectA, 'grok', 'prompt-plan');
  await store.remember(projectA, 'codex', 'caption');
  assert.equal(await store.get(projectA, 'story'), 'grok');
  assert.equal(await store.get(projectA, 'models'), 'codex');
  assert.equal(await store.get(projectA, 'prompt-plan'), 'grok');
  assert.equal(await store.get(projectA, 'caption'), 'codex');
  await store.remember(projectA, 'codex', 'story');
  assert.equal(await store.get(projectA, 'story'), 'codex');
  assert.equal(await store.get(projectA, 'models'), 'codex');
  assert.equal(await store.get(projectA, 'prompt-plan'), 'grok');
  assert.equal(await store.get(projectA, 'caption'), 'codex');
  assert.equal(await afterRestart.get(projectA, 'prompt-plan'), 'grok');
  assert.equal(await afterRestart.get(projectA, 'caption'), 'codex');
  assert.equal(await afterRestart.get(projectB, 'story'), 'codex');
  await assert.rejects(
    () => store.remember(projectA, 'grok', 'unknown'),
    /Invalid assistant stage/,
  );

  const legacyRoot = path.join(userData, 'project-old-version');
  const oldState = {
    schemaVersion: 1,
    projects: { [legacyRoot]: 'codex' },
  };
  const legacyDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-legacy-agent-'));
  fs.writeFileSync(
    path.join(legacyDirectory, 'assistant-provider-state.json'),
    JSON.stringify(oldState),
  );
  const migrated = new AssistantProviderStore(legacyDirectory);
  assert.equal(await migrated.get(legacyRoot, 'story'), 'codex');
  await migrated.resolve(legacyRoot, 'grok', async () => null, 'story');
  await migrated.remember(legacyRoot, 'grok', 'caption');
  assert.equal(await migrated.get(legacyRoot, 'story'), 'codex');
  assert.equal(await migrated.get(legacyRoot, 'caption'), 'grok');
  const migratedOnDisk = JSON.parse(
    fs.readFileSync(path.join(legacyDirectory, 'assistant-provider-state.json'), 'utf8'),
  );
  const migratedKey =
    process.platform === 'win32'
      ? path.resolve(legacyRoot).toLowerCase()
      : path.resolve(legacyRoot);
  assert.equal(migratedOnDisk.schemaVersion, 2);
  assert.equal(migratedOnDisk.projects[migratedKey].stages.story, 'codex');
  assert.equal(migratedOnDisk.projects[migratedKey].stages.caption, 'grok');

  const firstOpenRoot = path.join(userData, 'project-first-open');
  const firstProvider = await store.resolve(firstOpenRoot, 'grok', async () => null, 'models');
  assert.equal(firstProvider, 'grok');
  await store.remember(firstOpenRoot, 'codex', 'story');
  assert.equal(
    await store.resolve(firstOpenRoot, 'codex', async () => null, 'models'),
    'grok',
    'Opening another stage must not overwrite the first-open choice',
  );
  await assert.rejects(() => store.remember(projectA, 'invalid'), /Invalid assistant provider/);
  console.log(
    'Assistant provider default, legacy migration, switching and persistence tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
