const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-r2-parity-'));
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', runtime],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(runtime, relative)).href);

(async () => {
  const managerUtils = await load('shared/r2-manager-utils.js');
  const downloadUtils = await load('shared/r2-download-utils.js');

  assert.equal(
    managerUtils.normalizeR2ObjectKey(' /models\\loras//character.safetensors '),
    'models/loras/character.safetensors',
  );
  assert.throws(() => managerUtils.normalizeR2ObjectKey('models/../bad.safetensors'), /\.\./u);
  assert.throws(() => managerUtils.normalizeR2ObjectKey('models/'), /ファイル名/);
  assert.throws(
    () => managerUtils.normalizeR2ObjectKey(`${'あ'.repeat(400)}/x.safetensors`),
    /1,024バイト/,
  );

  assert.equal(
    managerUtils.normalizeR2PutObjectKey(' /uploads\\incoming//model.safetensors '),
    'uploads/incoming/model.safetensors',
  );
  assert.throws(() => managerUtils.normalizeR2PutObjectKey('uploads/../bad.bin'), /\.\./u);
  assert.throws(
    () => managerUtils.normalizeR2PutObjectKey('uploads/'),
    /アップロード先.*ファイル名/u,
  );
  assert.equal(managerUtils.normalizeR2PresignedExpiresIn(3600), 3600);
  assert.equal(managerUtils.normalizeR2PresignedExpiresIn(604800), 604800);
  assert.throws(() => managerUtils.normalizeR2PresignedExpiresIn(0), /1秒～7日/u);
  assert.throws(() => managerUtils.normalizeR2PresignedExpiresIn(604801), /1秒～7日/u);
  assert.equal(managerUtils.normalizeR2PutContentType(' image/png '), 'image/png');
  assert.equal(managerUtils.normalizeR2PutContentType(''), null);
  assert.throws(
    () => managerUtils.normalizeR2PutContentType('image/png\nX-Test: bad'),
    /Content-Type/u,
  );

  assert.equal(managerUtils.normalizeBatchTemplateName('  Favorites  '), 'Favorites');
  assert.throws(() => managerUtils.normalizeBatchTemplateName(''), /テンプレート名/);
  assert.throws(() => managerUtils.normalizeBatchTemplateName('x'.repeat(101)), /100文字/);
  const normalized = managerUtils.normalizeBatchTemplateObjects([
    { key: 'models/a.bin', name: 'ignored', size: 10 },
  ]);
  assert.deepEqual(normalized, [{ key: 'models/a.bin', name: 'a.bin', size: 10 }]);
  assert.throws(
    () =>
      managerUtils.normalizeBatchTemplateObjects([
        { key: 'a.bin', size: 1 },
        { key: 'a.bin', size: 1 },
      ]),
    /Object Key/,
  );

  assert.equal(downloadUtils.normalizeAria2Connections(99), 16);
  assert.equal(downloadUtils.normalizeAria2ConcurrentDownloads(0), 1);
  assert.equal(
    downloadUtils.buildAria2Command(
      [{ url: 'https://example.test/a' }, { url: 'https://example.test/b' }],
      8,
      4,
    ),
    "aria2c --allow-overwrite=false --auto-file-renaming=false -j4 -x8 -Z 'https://example.test/a' 'https://example.test/b'",
  );
  assert.equal(downloadUtils.formatBatchTotalSize(1.5 * 1024 ** 3), '1.50 GB');

  const managerSource = fs.readFileSync(path.join(repo, 'src/main/r2-manager.ts'), 'utf8');
  const indexSource = fs.readFileSync(path.join(repo, 'src/main/r2-object-index.ts'), 'utf8');
  const mainSource = fs.readFileSync(path.join(repo, 'src/main/main.ts'), 'utf8');
  const preloadSource = fs.readFileSync(path.join(repo, 'src/preload/index.cjs'), 'utf8');
  const rendererSource = fs.readFileSync(
    path.join(repo, 'src/renderer/R2ManagerStage.tsx'),
    'utf8',
  );
  matchCode(
    managerSource,
    /UPLOAD_CONCURRENCY=3/,
    'multipart upload must keep three concurrent workers',
  );
  matchCode(
    managerSource,
    /this\.syncIndex\(\)/,
    'R2 mutations must refresh the local object index',
  );
  matchCode(managerSource, /kind:'move'/, 'moves must be represented as transfer jobs');
  matchCode(
    managerSource,
    /UploadPartCopyCommand/,
    'large moves must retain multipart copy support',
  );
  matchCode(managerSource, /putUrlInfo\(/, 'manager must expose presigned PUT URL generation');
  matchCode(
    managerSource,
    /async objectExists\(bucket:string,key:string\)/,
    'manager keeps a live R2 object existence probe',
  );
  matchCode(
    managerSource,
    /async syncObjectIndex\(\)/,
    'remote model staging must be able to refresh the R2 index',
  );
  matchCode(
    managerSource,
    /resolveModelObjectKey/,
    'remote model staging must resolve actual R2 object keys',
  );
  matchCode(
    managerSource,
    /new PutObjectCommand\(\{Bucket:bucket,Key:key/,
    'PUT URL must sign a PutObject request for the requested key',
  );
  matchCode(
    managerSource,
    /requestChecksumCalculation:'WHEN_REQUIRED'/,
    'R2 presigned streaming PUT must not sign an implicit empty-body checksum',
  );
  doesNotMatchCode(
    managerSource,
    /headers:\{'content-type':contentType,'x-amz-meta-sha256':digest\}/,
    'hoisted metadata must not also be sent as a duplicate HTTP header',
  );
  matchCode(
    managerSource,
    /ContentType:contentType/,
    'PUT URL must support an optional signed Content-Type restriction',
  );
  matchCode(mainSource, /R2_PUT_URL_INFO/, 'main process must register PUT URL IPC');
  matchCode(
    mainSource,
    /await r2Index\(\)\.sync\(\)/,
    'model availability must refresh R2 index before checking placement',
  );
  matchCode(
    mainSource,
    /r2Index\(\)\.resolveModelKey\(bucket,fileName,prefix\)/,
    'model availability must resolve actual nested R2 model keys',
  );
  matchCode(indexSource, /resolveModelKey/, 'R2 index must expose nested model key resolution');
  matchCode(preloadSource, /putUrlInfo:/, 'preload bridge must expose PUT URL generation');
  matchCode(rendererSource, /一時PUT URL生成/, 'R2 File Manager must expose the PUT URL action');
  matchCode(
    rendererSource,
    /Content-Typeを指定した場合/,
    'UI must explain signed Content-Type behavior',
  );
  matchCode(
    indexSource,
    /syncQueues/,
    'index syncs from multiple manager instances must be serialized',
  );

  console.log('R2 File Manager parity tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
