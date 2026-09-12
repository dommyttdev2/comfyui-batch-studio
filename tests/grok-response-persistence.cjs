const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-response-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);

(async () => {
  const artifacts = await import(
    pathToFileURL(path.join(runtime, 'main', 'artifact-service.js')).href
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-grok-response-project-'));
  fs.mkdirSync(path.join(root, '._batch_studio', 'drafts'), { recursive: true });
  fs.mkdirSync(path.join(root, '._batch_studio', 'history'), { recursive: true });

  const rawInitial = 'Grok preface\n```markdown\n# Story\nraw body\n```\nGrok suffix';
  await artifacts.importGrok(root, 'story', rawInitial);
  const initialDir = path.join(root, '._batch_studio', 'grok-responses', 'story-finalize');
  const initialFiles = fs.readdirSync(initialDir);
  assert.equal(initialFiles.length, 1, 'initial story import must save one raw response');
  assert.equal(
    fs.readFileSync(path.join(initialDir, initialFiles[0]), 'utf8'),
    rawInitial,
    'raw response must be preserved byte-for-byte as text',
  );

  await artifacts.confirmArtifact(root, 'story');
  const rawFix = '修正版の生回答\n改行もそのまま保存する';
  await artifacts.importGrok(root, 'story', rawFix);
  const fixDir = path.join(root, '._batch_studio', 'grok-responses', 'story-fix');
  const fixFiles = fs.readdirSync(fixDir);
  assert.equal(
    fixFiles.length,
    1,
    'story fix import must be stored separately from initial/finalize history',
  );
  assert.equal(
    fs.readFileSync(path.join(fixDir, fixFiles[0]), 'utf8'),
    rawFix,
    'fix raw response must be preserved exactly',
  );

  const rawRetry = 'another raw response';
  await artifacts.importGrok(root, 'story', rawRetry);
  const retryFiles = fs.readdirSync(fixDir);
  assert.equal(
    retryFiles.length,
    2,
    'repeated imports must create history entries instead of overwriting',
  );
  assert.equal(new Set(retryFiles).size, 2, 'raw response history filenames must be unique');

  console.log('Grok raw response persistence tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
