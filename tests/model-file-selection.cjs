const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-model-file-runtime-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, relative)).href);

(async () => {
  const [
    { mergeModelFileCandidates, modelFileDirectory, r2ModelDirectoryPrefix },
    { listLocalModelFiles },
    { AppSettingsStore },
  ] = await Promise.all([
    load('shared/model-file-selection.js'),
    load('main/model-file-sources.js'),
    load('main/app-settings.js'),
  ]);

  assert.equal(modelFileDirectory('text_encoder'), 'text_encoders');
  assert.equal(modelFileDirectory('vae'), 'vae');
  assert.equal(r2ModelDirectoryPrefix('models', 'text_encoder'), 'models/text_encoders/');
  assert.equal(r2ModelDirectoryPrefix('models/', 'vae'), 'models/vae/');
  assert.equal(r2ModelDirectoryPrefix('', 'vae'), 'vae/');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-comfyui-'));
  const textRoot = path.join(root, 'models', 'text_encoders', 'vendor');
  const vaeRoot = path.join(root, 'models', 'vae');
  fs.mkdirSync(textRoot, { recursive: true });
  fs.mkdirSync(vaeRoot, { recursive: true });
  fs.writeFileSync(path.join(textRoot, 't5xxl.safetensors'), 'text');
  fs.writeFileSync(path.join(vaeRoot, 'ae.safetensors'), 'vae');

  const text = await listLocalModelFiles(path.join(root, 'models'), 'text_encoder');
  assert.equal(text.exists, true);
  assert.equal(text.files.length, 1);
  assert.equal(text.files[0].fileName, 'vendor/t5xxl.safetensors');
  const vae = await listLocalModelFiles(path.join(root, 'models'), 'vae');
  assert.equal(vae.exists, true);
  assert.equal(vae.files[0].fileName, 'ae.safetensors');

  const merged = mergeModelFileCandidates(
    [
      {
        fileName: 'vendor/t5xxl.safetensors',
        path: 'C:/ComfyUI/models/text_encoders/vendor/t5xxl.safetensors',
        size: 100,
      },
    ],
    [
      {
        fileName: 'vendor/t5xxl.safetensors',
        key: 'models/text_encoders/vendor/t5xxl.safetensors',
        size: 100,
      },
      {
        fileName: 'remote-only.safetensors',
        key: 'models/text_encoders/remote-only.safetensors',
        size: 200,
      },
    ],
  );
  const both = merged.find((x) => x.fileName === 'vendor/t5xxl.safetensors');
  assert.ok(both);
  assert.equal(both.local, true);
  assert.equal(both.r2, true);
  assert.equal(both.localPath.includes('t5xxl.safetensors'), true);
  assert.equal(both.r2Key, 'models/text_encoders/vendor/t5xxl.safetensors');
  const remoteOnly = merged.find((x) => x.fileName === 'remote-only.safetensors');
  assert.ok(remoteOnly);
  assert.equal(remoteOnly.local, false);
  assert.equal(remoteOnly.r2, true);

  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-settings-'));
  const store = new AppSettingsStore(userData);
  const status = await store.save({ comfyUiInstallPath: root });
  assert.equal(status.modelsPath, path.join(root, 'models'));
  assert.equal(status.modelFiles.text_encoders.files[0].fileName, 'vendor/t5xxl.safetensors');
  assert.equal(status.modelFiles.vae.files[0].fileName, 'ae.safetensors');

  console.log('Anima Text Encoder/VAE local/R2 model file selection tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
