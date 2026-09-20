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
assert.match(main, /codexPendingArtifacts\.has\(threadId\)[\s\S]*item\/agentMessage\/delta/);
assert.match(main, /codexTaskFileForTurn\(turn\)/);
assert.match(main, /collectCodexArtifact\(threadId, pending, notification\.params\)/);
assert.match(pane, /retryArtifact\(\)/);
assert.match(
  source('src/main/grok-auto-artifact-watcher.ts'),
  /MutationObserver|observeGrokArtifact/,
);
assert.match(source('src/renderer/GrokStages.tsx'), /autoArtifact\.armGrok/);

(async () => {
  const { importAutoArtifact, latestAutoArtifact, expectedArtifact, artifactFileContent } =
    await import(pathToFileURL(path.join(runtime, 'main', 'agent-artifact-import.js')).href);
  const { codexTaskFileForTurn, latestCompletedArtifactTurn } = await import(
    pathToFileURL(path.join(runtime, 'main', 'codex-artifact-turn.js')).href
  );
  const taskTurn = (fileName) => ({
    status: 'completed',
    items: [
      {
        type: 'userMessage',
        content: [
          {
            text: `## Codex向け出力契約\\n回答の最後に ${fileName} の完成した内容だけを出力してください。`,
          },
        ],
      },
      { type: 'agentMessage', text: '{"schemaVersion":1}' },
    ],
  });
  for (const fileName of [
    'story.md',
    'model_loras.json',
    'prompt_plan.json',
    'caption_content.json',
  ]) {
    assert.equal(codexTaskFileForTurn(taskTurn(fileName)), fileName);
  }
  assert.equal(
    codexTaskFileForTurn({
      items: [
        {
          type: 'userMessage',
          text: '## Codex向け出力契約\\nこれは対話用の検討依頼です。story.mdについて議論します。',
        },
      ],
    }),
    null,
  );
  assert.equal(
    codexTaskFileForTurn({
      items: [{ type: 'userMessage', text: 'caption_content.json を作ってください。' }],
    }),
    null,
  );
  assert.equal(
    codexTaskFileForTurn({
      items: [
        { type: 'userMessage', text: '通常の依頼' },
        { type: 'agentMessage', text: '回答の最後に caption_content.json' },
      ],
    }),
    null,
  );
  const captionTurn = taskTurn('caption_content.json');
  const otherTurn = taskTurn('prompt_plan.json');
  assert.equal(
    latestCompletedArtifactTurn(
      [
        captionTurn,
        otherTurn,
        { ...taskTurn('caption_content.json'), status: 'failed' },
        { status: 'completed', items: [] },
      ],
      'caption_content.json',
    ),
    captionTurn,
    'Retry must locate the latest completed task for the current stage even after later chat turns.',
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-auto-artifact-project-'));
  const draft = path.join(root, '._batch_studio', 'drafts', 'story.md');
  assert.equal(expectedArtifact('story-initial'), null);
  assert.equal(expectedArtifact('models'), 'model_loras.json');
  assert.equal(expectedArtifact('caption'), 'caption_content.json');
  assert.deepEqual(
    JSON.parse(
      artifactFileContent(
        'models',
        '```json\n{"schemaVersion":1,"loras":[]}\n```',
        JSON.stringify({ schemaVersion: 3, checkpoint: { id: 1 }, loras: [] }),
      ),
    ),
    { schemaVersion: 1, loras: [] },
    'The downloadable LoRA selection must not include merged user base models',
  );

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
