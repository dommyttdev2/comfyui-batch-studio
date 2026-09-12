const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(repo, '.test-runtime-r2-index-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, 'main', relative)).href);

(async () => {
  try {
    const { R2ObjectIndex } = await load('r2-object-index.js');
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-r2-index-'));
    const file = path.join(userData, 'r2', 'object-index.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          schemaVersion: 1,
          syncedAt: '2026-09-08T00:00:00Z',
          buckets: {
            models: [
              {
                key: 'models/checkpoints/base.safetensors',
                name: 'base.safetensors',
                size: 100,
                etag: 'a',
                lastModified: null,
                storageClass: 'STANDARD',
              },
              {
                key: 'models/loras/deep/character.safetensors',
                name: 'character.safetensors',
                size: 200,
                etag: 'b',
                lastModified: null,
                storageClass: 'STANDARD',
              },
              {
                key: 'models/loras/pov/action.safetensors',
                name: 'action.safetensors',
                size: 210,
                etag: 'c',
                lastModified: null,
                storageClass: 'STANDARD',
              },
              {
                key: 'archive/checkpoints/legacy.safetensors',
                name: 'legacy.safetensors',
                size: 220,
                etag: 'd',
                lastModified: null,
                storageClass: 'STANDARD',
              },
              {
                key: 'archive/other.bin',
                name: 'other.bin',
                size: 300,
                etag: 'e',
                lastModified: null,
                storageClass: 'STANDARD',
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    const fakeConfig = {
      credentials: async () => {
        throw new Error('search must not access R2');
      },
    };
    const index = new R2ObjectIndex(fakeConfig, userData);
    const result = await index.search('models', 'character');
    assert.equal(result.objects.length, 1);
    assert.equal(result.objects[0].key, 'models/loras/deep/character.safetensors');
    assert.equal(await index.containsFile('models', 'character.safetensors', 'models/'), true);
    assert.equal(
      await index.containsFile('models', 'character.safetensors', 'models/checkpoints/'),
      false,
    );
    assert.equal(
      await index.resolveModelKey('models', 'checkpoints/base.safetensors', ''),
      'models/checkpoints/base.safetensors',
    );
    assert.equal(
      await index.resolveModelKey('models', 'loras/character.safetensors', ''),
      'models/loras/deep/character.safetensors',
      'nested LoRA folder must resolve by category + basename',
    );
    assert.equal(
      await index.resolveModelKey('models', 'loras/action.safetensors', 'models'),
      'models/loras/pov/action.safetensors',
      'configured prefix must scope nested model resolution',
    );
    assert.equal(
      await index.resolveModelKey('models', 'checkpoints/legacy.safetensors', ''),
      'archive/checkpoints/legacy.safetensors',
      'leading R2 folders before model category are allowed',
    );
    console.log('R2 object index tests passed.');
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
