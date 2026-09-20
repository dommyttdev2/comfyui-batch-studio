const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-project-meta-build-'));
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

(async () => {
  const metaApi = await import(pathToFileURL(path.join(compiled, 'main', 'project-meta.js')).href);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-project-meta-project-'));
  await metaApi.initializeProjectMeta(root, { artifactOutputPath: 'original-output' });
  await assert.rejects(
    () => metaApi.initializeProjectMeta(root, { artifactOutputPath: 'replacement-output' }),
    /already exists/,
    'Project creation must not overwrite an existing metadata file',
  );

  // Race independent stage writes, including callers referring to the same root differently.
  const aliases = [
    root,
    path.join(root, '.'),
    process.platform === 'win32' ? root.toUpperCase() : path.join(root, 'subdir', '..'),
  ];
  await Promise.all(
    Array.from({ length: 60 }, (_, index) =>
      index % 2 === 0
        ? metaApi.saveProjectSettings(aliases[index % aliases.length], {
            r2Bucket: 'bucket-' + index,
          })
        : metaApi.saveWorkflowBuild(aliases[index % aliases.length], {
            workflowIdentity: 'build-' + index,
            outputPath: 'LoRA_project.json',
          }),
    ),
  );
  const saved = await metaApi.readProjectMeta(root);
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.settings.artifactOutputPath, 'original-output');
  assert.match(saved.settings.r2Bucket, /^bucket-\d+$/);
  assert.match(saved.workflowBuild.workflowIdentity, /^build-\d+$/);

  await Promise.all([
    metaApi.saveProjectSettings(root, { executionTarget: 'remote' }),
    metaApi.saveWorkflowBuild(path.join(root, '.'), { workflowIdentity: 'latest' }),
  ]);
  const last = await metaApi.readProjectMeta(root);
  assert.equal(last.settings.executionTarget, 'remote');
  assert.equal(last.workflowBuild.workflowIdentity, 'latest');
  const previous = fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8');
  await assert.rejects(
    () =>
      metaApi.updateProjectMeta(root, () => {
        throw new Error('injected failure');
      }),
    /injected failure/,
  );
  assert.equal(fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8'), previous);

  // A malformed file is not silently treated as a missing project and reset.
  fs.writeFileSync(path.join(root, 'project_meta.json'), '{damaged');
  await assert.rejects(() => metaApi.saveProjectSettings(root, { r2Bucket: 'new' }), {
    code: 'PERSISTED_JSON_CORRUPT',
  });
  assert.equal(fs.readFileSync(path.join(root, 'project_meta.json'), 'utf8'), '{damaged');
  console.log('Project metadata serialization tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
