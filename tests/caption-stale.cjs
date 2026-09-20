const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-caption-stale-build-'));
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    compiled,
  ],
  { cwd: repo, stdio: 'inherit' },
);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};

(async () => {
  const caption = await import(
    pathToFileURL(path.join(compiled, 'main', 'caption-service.js')).href
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-caption-stale-project-'));
  const finalDir = path.join(root, 'final-output');
  fs.mkdirSync(finalDir);
  fs.writeFileSync(path.join(finalDir, 'a.png'), 'image-a');
  const brief = {
    schemaVersion: 1,
    project: { id: 'caption-stale-project', title: 'Test' },
    subject: { copyrightedCharacter: false, characterName: '', series: '' },
    audience: 'test',
    request: 'test',
    exclusions: '',
    assumptions: { adultCharacters: true, consensual: true },
    generation: { target_image_count: 2, modelFamily: 'Illustrious' },
    references: [],
  };
  const content = {
    schemaVersion: 1,
    title: { ja: 'テスト', en: 'Test' },
    description: { ja: ['説明'], en: ['Description'] },
  };
  const briefPath = path.join(root, 'project_brief.json');
  const draftPath = path.join(root, '._batch_studio', 'drafts', 'caption_content.json');
  const metaPath = path.join(root, 'project_meta.json');
  const captionPath = path.join(root, 'caption.txt');
  const buildPath = path.join(root, '._batch_studio', 'caption-build.json');
  writeJson(briefPath, brief);
  writeJson(draftPath, content);
  writeJson(metaPath, {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: { finalArtifactDirectory: finalDir },
  });
  assert.equal((await caption.getCaptionStatus(root)).state, 'ready');
  let status = await caption.generateCaption(root);
  assert.equal(status.state, 'generated');
  assert.equal(status.stale, false);
  assert.ok(status.build.renderInputSha256);
  assert.ok(status.build.outputSha256);

  brief.subject.copyrightedCharacter = true;
  writeJson(briefPath, brief);
  status = await caption.getCaptionStatus(root);
  assert.equal(status.state, 'stale', 'fan-work toggle must invalidate previous build');
  status = await caption.generateCaption(root);
  assert.equal(status.state, 'generated');
  assert.match(
    fs.readFileSync(captionPath, 'utf8'),
    /※二次創作です。公式とは無関係です。\n※AI生成作品です。/,
  );
  brief.subject.copyrightedCharacter = false;
  writeJson(briefPath, brief);
  assert.equal((await caption.getCaptionStatus(root)).state, 'stale');
  status = await caption.generateCaption(root);
  assert.equal(status.state, 'generated');
  assert.doesNotMatch(fs.readFileSync(captionPath, 'utf8'), /※二次創作です。/);

  fs.appendFileSync(captionPath, 'tampered\n');
  assert.equal((await caption.getCaptionStatus(root)).state, 'stale');
  status = await caption.generateCaption(root);
  assert.equal(status.state, 'generated');
  fs.unlinkSync(captionPath);
  status = await caption.getCaptionStatus(root);
  assert.equal(status.state, 'stale', 'missing built caption must not appear ready');

  status = await caption.generateCaption(root);
  assert.equal(status.state, 'generated');
  const legacy = JSON.parse(fs.readFileSync(buildPath, 'utf8'));
  delete legacy.renderInputSha256;
  delete legacy.outputSha256;
  writeJson(buildPath, legacy);
  assert.equal(
    (await caption.getCaptionStatus(root)).state,
    'stale',
    'legacy build must be regenerated',
  );
  status = await caption.generateCaption(root);
  assert.equal(status.state, 'generated');

  content.description.ja[0] = '変更後の説明';
  writeJson(draftPath, content);
  assert.equal((await caption.getCaptionStatus(root)).state, 'stale');
  await caption.generateCaption(root);
  fs.writeFileSync(path.join(finalDir, 'b.png'), 'image-b');
  assert.equal(
    (await caption.getCaptionStatus(root)).state,
    'stale',
    'count change invalidates caption',
  );
  await caption.generateCaption(root);
  const finalDir2 = path.join(root, 'other-final');
  fs.mkdirSync(finalDir2);
  fs.writeFileSync(path.join(finalDir2, 'c.png'), 'image-c');
  writeJson(metaPath, {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: { finalArtifactDirectory: finalDir2 },
  });
  assert.equal(
    (await caption.getCaptionStatus(root)).state,
    'stale',
    'directory change invalidates caption',
  );
  status = await caption.generateCaption(root);
  assert.equal(status.state, 'generated');
  console.log('Caption stale build and file integrity tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
