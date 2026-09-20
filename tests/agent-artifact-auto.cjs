const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-auto-artifact-'));
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
const source = (name) => fs.readFileSync(path.join(repo, name), 'utf8');
const main = source('src/main/main.ts');
const pane = source('src/renderer/CodexPane.tsx');
assert.match(main, /codexPendingArtifacts\.has\(threadId\).*item\/agentMessage\/delta/);
assert.match(main, /codexTaskFileForTurn\(turn\)/);
assert.match(main, /collectCodexArtifact\(threadId, pending, notification\.params\)/);
assert.match(pane, /codex\.retryArtifact\(\)/);
assert.match(
  source('src/main/grok-auto-artifact-watcher.ts'),
  /MutationObserver|observeGrokArtifact/,
);
assert.match(source('src/renderer/GrokStages.tsx'), /autoArtifact\.armGrok/);

(async () => {
  const { importAutoArtifact, latestAutoArtifact, expectedArtifact } = await import(
    pathToFileURL(path.join(runtime, 'main', 'agent-artifact-import.js')).href
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-auto-artifact-project-'));
  const draft = path.join(root, '._batch_studio', 'drafts', 'story.md');
  assert.equal(expectedArtifact('story-initial'), null);
  assert.equal(expectedArtifact('models'), 'model_loras.json');
  assert.equal(expectedArtifact('caption'), 'caption_content.json');

  const raw = '# Story\n\nA complete story.';
  const first = await importAutoArtifact(root, 'codex', 'story-finalize', 'thread-1/turn-1', raw);
  assert.equal(first.phase, 'imported');
  assert.equal(fs.readFileSync(first.filePath, 'utf8'), raw + '\n');
  assert.equal(fs.readFileSync(draft, 'utf8'), raw + '\n');
  const duplicate = await importAutoArtifact(
    root,
    'codex',
    'story-finalize',
    'thread-1/turn-1',
    raw,
  );
  assert.equal(duplicate.phase, 'duplicate');
  const invalid = await importAutoArtifact(root, 'grok', 'story-fix', 'chat-1/code-1', '    ');
  assert.equal(invalid.phase, 'invalid');
  assert.equal(fs.readFileSync(draft, 'utf8'), raw + '\n', 'invalid auto-import must retain draft');
  const recovered = await latestAutoArtifact(root, 'codex', 'story-finalize', 'thread-1/');
  assert.equal(recovered.filePath, first.filePath);

  const caption = JSON.stringify({
    schemaVersion: 1,
    title: { ja: '作品', en: 'Work' },
    description: { ja: ['短い説明'], en: ['Short description'] },
  });
  const captionFirst = await importAutoArtifact(root, 'grok', 'caption', 'chat-2/file-1', caption);
  assert.equal(captionFirst.phase, 'imported');
  const captionDraft = path.join(root, '._batch_studio', 'drafts', 'caption_content.json');
  const original = fs.readFileSync(captionDraft, 'utf8');
  const invalidCaption = await importAutoArtifact(
    root,
    'codex',
    'caption',
    'thread-2/turn-1',
    JSON.stringify({ schemaVersion: 1, title: { ja: 'missing en' } }),
  );
  assert.equal(invalidCaption.phase, 'invalid');
  assert.equal(fs.readFileSync(captionDraft, 'utf8'), original);
  console.log(
    'Shared Grok/Codex artifact auto-import, file output, deduplication and draft preservation passed.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
