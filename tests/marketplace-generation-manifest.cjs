const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const build = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-marketplace-manifest-build-'));
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    build,
  ],
  { cwd: repo, stdio: 'inherit' },
);

(async () => {
  const core = await import(
    pathToFileURL(path.join(build, 'main', 'marketplace-generation-manifest.js')).href
  );
  const { cleanupTrackedOutput } = await import(
    pathToFileURL(path.join(build, 'main', 'tracked-output-cleanup.js')).href
  );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-marketplace-manifest-'));
  const sourcePath = path.join(root, 'source.png');
  fs.writeFileSync(sourcePath, Buffer.from('first-source-bytes'));
  const targets = [
    {
      id: 'fanza.package',
      service: 'FANZA',
      imageType: 'package',
      label: 'FANZA',
      width: 560,
      height: 420,
      fileName: 'package',
    },
    {
      id: 'fanza.thumbnail',
      service: 'FANZA',
      imageType: 'thumbnail',
      label: 'FANZA',
      width: 100,
      height: 100,
      fileName: 'thumbnail',
    },
    {
      id: 'dlsite.package',
      service: 'DLsite',
      imageType: 'package',
      label: 'DLsite',
      width: 560,
      height: 420,
      fileName: 'package',
    },
    {
      id: 'dlsite.thumbnail',
      service: 'DLsite',
      imageType: 'thumbnail',
      label: 'DLsite',
      width: 300,
      height: 300,
      fileName: 'thumbnail',
    },
  ];
  const state = {
    schemaVersion: 1,
    sourceImagePath: sourcePath,
    mode: 'marketplace',
    activeTargetId: targets[0].id,
    format: 'jpeg',
    targets: Object.fromEntries(
      targets.map((target) => [target.id, { crop: { x: 2, y: 3, width: 420, height: 315 } }]),
    ),
    custom: { width: 1024, height: 1024, lockAspect: true, crop: null },
  };
  const outputDirectory = path.join(root, 'marketplace');
  const outputs = targets.map((target, index) => {
    const relativePath = target.service + '/' + target.fileName + '.jpg';
    const bytes = Buffer.from('image-generation-one-' + index);
    const outputPath = path.join(outputDirectory, ...relativePath.split('/'));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, bytes);
    return {
      targetId: target.id,
      relativePath,
      size: bytes.length,
      sha256: core.sha256Bytes(bytes),
    };
  });
  const source = await core.fingerprintMarketplaceSource(sourcePath);
  const manifest = {
    schemaVersion: 1,
    generationId: '11111111-1111-4111-8111-111111111111',
    generatedAt: new Date().toISOString(),
    source,
    format: state.format,
    inputSignature: core.marketplaceInputSignature(state, targets),
    outputs,
  };
  const validate = (s = state, t = targets, src = source) =>
    core.validateMarketplaceGeneration(manifest, s, t, src);
  assert.doesNotThrow(() => validate());
  for (const [index, target] of targets.entries()) {
    const entry = await core.verifiedMarketplaceOutput(
      outputDirectory,
      outputs[index],
      target,
      'jpg',
    );
    assert.equal(entry.relativePath, outputs[index].relativePath);
  }
  const stale = /再生成してください/;
  const changedCrop = structuredClone(state);
  changedCrop.targets['fanza.package'].crop.x++;
  assert.throws(() => validate(changedCrop), stale);
  const changedPath = structuredClone(state);
  changedPath.sourceImagePath = path.join(root, 'replacement.png');
  assert.throws(() => validate(changedPath), stale);
  const changedFormat = structuredClone(state);
  changedFormat.format = 'png';
  assert.throws(() => validate(changedFormat), stale);
  const changedTarget = structuredClone(targets);
  changedTarget[0].width = 600;
  assert.throws(() => validate(state, changedTarget), stale);
  const changedCatalog = structuredClone(targets);
  changedCatalog[0].fileName = 'package-new';
  assert.throws(() => validate(state, changedCatalog), stale);
  const outputFile = path.join(outputDirectory, ...outputs[0].relativePath.split('/'));
  fs.writeFileSync(outputFile, Buffer.from('altered-output'));
  await assert.rejects(
    () => core.verifiedMarketplaceOutput(outputDirectory, outputs[0], targets[0], 'jpg'),
    stale,
  );
  fs.unlinkSync(outputFile);
  await assert.rejects(
    () => core.verifiedMarketplaceOutput(outputDirectory, outputs[0], targets[0], 'jpg'),
    stale,
  );
  const before = fs.statSync(sourcePath);
  fs.writeFileSync(sourcePath, Buffer.from('other-source-bytes'));
  fs.utimesSync(sourcePath, before.atime, before.mtime);
  const replaced = await core.fingerprintMarketplaceSource(sourcePath);
  assert.notEqual(replaced.sha256, source.sha256);
  assert.throws(() => validate(state, targets, replaced), stale);

  const service = fs.readFileSync(path.join(repo, 'src/main/marketplace-image-service.ts'), 'utf8');
  assert.match(service, /validateMarketplaceGeneration\(manifest, state, targets, source\)/);
  assert.match(service, /verifiedMarketplaceOutput\(/);
  assert.match(service, /storedZip\(entries\)/);
  assert.match(service, /writeJsonAtomic\(generationManifestPath\(outputDirectory\), manifest\)/);
  const tracked = path.join(root, 'tracked-old.png');
  const original = Buffer.from('generated-output');
  fs.writeFileSync(tracked, original);
  const identity = { size: original.length, sha256: core.sha256Bytes(original) };
  assert.equal(await cleanupTrackedOutput(tracked, identity), null);
  assert.equal(fs.existsSync(tracked), false);
  fs.writeFileSync(tracked, Buffer.from('manual-edited-file'));
  assert.match(await cleanupTrackedOutput(tracked, identity), /手動変更/);
  assert.equal(fs.existsSync(tracked), true);
  assert.equal(await cleanupTrackedOutput(path.join(root, 'missing-old.png'), identity), null);

  console.log('Marketplace generation manifest tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
