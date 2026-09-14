const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-template-eol-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
};
const sha256 = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

(async () => {
  const { compileWorkflow } = await load('compiler.js');
  const { scanProject } = await load('project-scan.js');
  const sourceTemplate = path.join(repo, 'templates/default-scene-batch/template.json');
  const manifestPath = path.join(repo, 'templates/default-scene-batch/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const lfTemplate = fs.readFileSync(sourceTemplate, 'utf8').replace(/\r\n?/g, '\n');
  const crlfTemplate = lfTemplate.replace(/\n/g, '\r\n');

  assert.equal(sha256(lfTemplate), manifest.template.sha256);
  assert.notEqual(
    sha256(crlfTemplate),
    manifest.template.sha256,
    'test fixture must reproduce the Windows CRLF hash mismatch',
  );

  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-template-eol-parent-'));
  const root = path.join(parent, 'project-folder', 'project');
  fs.mkdirSync(root, { recursive: true });
  const crlfTemplatePath = path.join(parent, 'template-crlf.json');
  fs.writeFileSync(crlfTemplatePath, crlfTemplate, 'utf8');

  writeJson(path.join(root, 'project_brief.json'), {
    project: { id: 'template-eol-test', title: 'Template EOL test' },
  });
  writeJson(path.join(root, 'project_meta.json'), {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    settings: {
      templatePath: crlfTemplatePath,
      manifestPath,
    },
  });
  writeJson(path.join(root, 'models.json'), {
    schemaVersion: 1,
    catalog: { schemaVersion: 1, generation: 1, generatedAt: '2026-09-15T00:00:00Z' },
    checkpoint: {
      ref: 'checkpoint.main',
      modelId: 1,
      modelName: 'Checkpoint',
      versionId: 2,
      versionName: 'v1',
      fileId: 3,
      fileName: 'checkpoint.safetensors',
      modelUrl: 'https://example.com/models/1',
      trainedWords: [],
      reason: 'test',
    },
    loras: [],
  });
  writeJson(path.join(root, 'prompt_plan.json'), {
    schemaVersion: 1,
    common: { positive: 'quality', negative: 'bad' },
    rootLoras: [],
    branches: [
      {
        id: 'b01',
        label: 'Branch 1',
        loras: [],
        leaves: [{ id: 'leaf-1', name: 'Leaf 1', positive: 'subject', negative: 'bad' }],
      },
    ],
  });

  const result = await compileWorkflow(root);
  assert.equal(result.validation.valid, true);
  assert.equal(fs.existsSync(result.outputPath), true);

  const summary = await scanProject(root);
  assert.equal(
    summary.artifacts.find((artifact) => artifact.key === 'workflow')?.state,
    'generated',
    'CRLF template must not make the generated workflow stale during preflight artifact scanning',
  );
  console.log('Workflow template CRLF SHA-256 regression test passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
