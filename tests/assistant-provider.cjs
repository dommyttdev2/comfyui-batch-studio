const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { matchCode } = require('./source-match.cjs');

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
  read('src/renderer/App.tsx'),
  /codex\.getProvider\(\)/,
  'App must load the project-specific choice before opening a stage',
);
matchCode(
  read('src/renderer/App.tsx'),
  /codex\.setProvider\(provider\)/,
  'Switching agents must persist the selected provider',
);
matchCode(
  read('src/main/main.ts'),
  /assistantProviderState\.resolve\(/,
  'Existing project agent selection must be restored',
);
matchCode(
  read('src/main/main.ts'),
  /grokHistory\s*&&\s*!codexHistory/,
  'Old Grok projects must retain their Grok chat when switching the global default',
);
matchCode(
  read('src/main/main.ts'),
  /codexHistory\s*&&\s*!grokHistory/,
  'Old Codex projects must retain their Codex chat when switching the global default',
);

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
    'Legacy Grok history must take precedence over a changed default',
  );
  assert.equal(
    await store.resolve(projectCodex, 'grok', async () => 'codex'),
    'codex',
    'Legacy Codex history must take precedence over a changed default',
  );
  await store.remember(projectA, 'codex');
  await store.remember(projectB, 'grok');
  assert.equal(
    await store.resolve(projectA, 'grok', async () => 'grok'),
    'codex',
    'An explicit project choice must override the global setting and old chats',
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
  await assert.rejects(() => store.remember(projectA, 'invalid'), /Invalid assistant provider/);
  console.log(
    'Assistant provider default, legacy migration, switching and persistence tests passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
