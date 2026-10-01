const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-r2-parity-'));
// Compiled test modules live outside the repository. Make dependencies available
// from that location so the imported R2Manager can resolve the AWS SDK.
fs.symlinkSync(
  path.join(repo, 'node_modules'),
  path.join(runtime, 'node_modules'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
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
  const mainSource = [
    fs.readFileSync(path.join(repo, 'src/main/main.ts'), 'utf8'),
    fs.readFileSync(path.join(repo, 'src/main/ipc-registration.ts'), 'utf8'),
  ].join('\n');
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

  const { R2Manager } = await load('main/r2-manager.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-batch-templates-'));
  try {
    const first = new R2Manager({}, root);
    const second = new R2Manager({}, root);
    const objects = [{ key: 'models/a.bin', name: 'a.bin', size: 10 }];
    await Promise.all(
      Array.from({ length: 25 }, (_, n) =>
        (n % 2 ? first : second).saveTemplate({
          name: 'batch-' + n,
          bucket: 'models',
          objects,
        }),
      ),
    );
    const saved = await first.templates();
    assert.equal(saved.length, 25, 'concurrent batch template saves must retain every entry');
    assert.equal(new Set(saved.map((item) => item.id)).size, 25);
    const victim = saved.find((item) => item.name === 'batch-0');
    await Promise.all([
      second.deleteTemplate(victim.id),
      first.saveTemplate({ name: 'added-during-delete', bucket: 'models', objects }),
    ]);
    const after = await second.templates();
    assert.equal(after.length, 25);
    assert.equal(
      after.some((item) => item.id === victim.id),
      false,
    );
    assert.equal(
      after.some((item) => item.name === 'added-during-delete'),
      true,
    );
    assert.deepEqual(
      after,
      JSON.parse(fs.readFileSync(path.join(root, 'r2', 'batch-download-templates.json'), 'utf8'))
        .templates,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  {
    const {
      UploadPartCommand,
      CompleteMultipartUploadCommand,
      AbortMultipartUploadCommand,
    } = require('@aws-sdk/client-s3');
    const uploadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-single-flight-'));
    const file = path.join(uploadRoot, 'twenty-bytes.bin');
    fs.writeFileSync(file, Buffer.alloc(20, 0x41));
    const makeJob = (id) => ({
      id,
      kind: 'upload',
      bucket: 'models',
      key: id + '.bin',
      filePath: file,
      fileName: path.basename(file),
      size: 20,
      contentType: 'application/octet-stream',
      uploadId: 'multipart-' + id,
      partSize: 5,
      completedParts: {},
      status: 'paused',
      transferredBytes: 0,
      error: '',
      createdAt: new Date().toISOString(),
    });
    const original = [makeJob('duplicate'), makeJob('cancel'), makeJob('complete-race')];
    const statePath = path.join(uploadRoot, 'r2', 'uploads.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, jobs: original }));
    const manager = new R2Manager({}, uploadRoot);
    const calls = { parts: [], completes: [], aborts: [] },
      held = [],
      heldFor = new Set(['duplicate', 'cancel', 'complete-race']);
    manager.syncIndex = () => {};
    manager.clientFor = async () => ({
      send(command) {
        if (command instanceof UploadPartCommand) {
          const id = String(command.input.UploadId).replace('multipart-', '');
          calls.parts.push({ id, part: command.input.PartNumber });
          command.input.Body?.destroy?.();
          if (heldFor.has(id))
            return new Promise((resolve) => {
              held.push({ id, resolve, part: command.input.PartNumber });
            });
          return Promise.resolve({ ETag: 'etag-' + command.input.PartNumber });
        }
        if (command instanceof CompleteMultipartUploadCommand) {
          calls.completes.push(String(command.input.UploadId).replace('multipart-', ''));
          return Promise.resolve({});
        }
        if (command instanceof AbortMultipartUploadCommand) {
          calls.aborts.push(String(command.input.UploadId).replace('multipart-', ''));
          return Promise.resolve({});
        }
        throw new Error('Unexpected S3 command: ' + command.constructor.name);
      },
    });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!(await predicate())) {
        if (Date.now() > deadline) throw new Error('R2 test timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const status = async (id) => (await manager.uploads()).find((job) => job.id === id)?.status;
    try {
      const concurrent = await Promise.all([
        manager.resumeUpload('duplicate'),
        manager.resumeUpload('duplicate'),
        manager.resumeUpload('duplicate'),
      ]);
      assert.equal(concurrent.length, 3);
      await waitFor(() => held.filter((item) => item.id === 'duplicate').length === 3);
      assert.deepEqual(
        calls.parts.filter((item) => item.id === 'duplicate').map((item) => item.part),
        [1, 2, 3],
        'duplicate Resume calls must not create additional workers for the same parts',
      );
      let pauseSettled = false;
      const pause = manager.pauseUpload('duplicate').then((job) => {
        pauseSettled = true;
        return job;
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(pauseSettled, false, 'Pause must drain all in-flight UploadPart requests');
      heldFor.delete('duplicate');
      for (const item of held.filter((item) => item.id === 'duplicate'))
        item.resolve({ ETag: 'etag-' + item.part });
      const paused = await pause;
      assert.equal(paused.status, 'paused');
      assert.equal(await status('duplicate'), 'paused');
      assert.equal(calls.completes.includes('duplicate'), false);
      await manager.resumeUpload('duplicate');
      await waitFor(async () => (await status('duplicate')) === 'complete');
      assert.deepEqual(
        calls.parts.filter((item) => item.id === 'duplicate').map((item) => item.part),
        [1, 2, 3, 4],
        'Resume after Pause must not replay parts already acknowledged by the old generation',
      );
      assert.equal(calls.completes.filter((id) => id === 'duplicate').length, 1);

      await manager.resumeUpload('cancel');
      await waitFor(() => held.filter((item) => item.id === 'cancel').length === 3);
      const cancel = manager.cancelUpload('cancel');
      heldFor.delete('cancel');
      for (const item of held.filter((item) => item.id === 'cancel'))
        item.resolve({ ETag: 'etag-' + item.part });
      const cancelled = await cancel;
      assert.equal(cancelled.status, 'cancelled');
      assert.equal(await status('cancel'), 'cancelled');
      assert.equal(calls.aborts.filter((id) => id === 'cancel').length, 1);
      assert.equal(calls.completes.includes('cancel'), false);
      const beforeCancelResume = calls.parts.length;
      assert.equal((await manager.resumeUpload('cancel')).status, 'cancelled');
      assert.equal(calls.parts.length, beforeCancelResume, 'Cancel must prevent further S3 sends');

      await manager.resumeUpload('complete-race');
      await waitFor(() => held.filter((item) => item.id === 'complete-race').length === 3);
      const cancelBeforeComplete = manager.cancelUpload('complete-race');
      heldFor.delete('complete-race');
      for (const item of held.filter((item) => item.id === 'complete-race'))
        item.resolve({ ETag: 'etag-' + item.part });
      assert.equal((await cancelBeforeComplete).status, 'cancelled');
      assert.equal(calls.completes.includes('complete-race'), false);
      assert.equal(calls.aborts.filter((id) => id === 'complete-race').length, 1);
    } finally {
      fs.rmSync(uploadRoot, { recursive: true, force: true });
    }
  }

  {
    const {
      UploadPartCommand,
      CompleteMultipartUploadCommand,
      AbortMultipartUploadCommand,
    } = require('@aws-sdk/client-s3');
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'r2-source-integrity-'));
    const source = path.join(sourceRoot, 'source.bin'),
      statePath = path.join(sourceRoot, 'r2', 'uploads.json');
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const makeJob = (id) => ({
      id,
      bucket: 'models',
      key: id + '.bin',
      filePath: source,
      fileName: 'source.bin',
      size: 20,
      contentType: 'application/octet-stream',
      uploadId: 'upload-' + id,
      partSize: 5,
      completedParts: {},
      status: 'paused',
      transferredBytes: 0,
      error: '',
      createdAt: new Date().toISOString(),
    });
    const jobs = [
      makeJob('same-size'),
      makeJob('during-transfer'),
      makeJob('inode'),
      makeJob('shrink'),
    ];
    fs.writeFileSync(source, Buffer.alloc(20, 0x41));
    fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, jobs }));
    const manager = new R2Manager({}, sourceRoot);
    manager.syncIndex = () => {};
    const calls = { parts: [], completes: [], aborts: [] },
      held = [],
      delayFor = new Set(['same-size', 'during-transfer', 'inode', 'shrink']);
    manager.clientFor = async () => ({
      send(command) {
        if (command instanceof UploadPartCommand) {
          const id = String(command.input.UploadId).slice('upload-'.length);
          calls.parts.push({
            id,
            part: command.input.PartNumber,
            bytes: Buffer.from(command.input.Body),
          });
          if (delayFor.has(id))
            return new Promise((resolve) => {
              held.push({ id, part: command.input.PartNumber, resolve });
            });
          return Promise.resolve({ ETag: 'etag-' + command.input.PartNumber });
        }
        if (command instanceof CompleteMultipartUploadCommand) {
          calls.completes.push(String(command.input.UploadId).slice('upload-'.length));
          return Promise.resolve({});
        }
        if (command instanceof AbortMultipartUploadCommand) {
          calls.aborts.push(String(command.input.UploadId).slice('upload-'.length));
          return Promise.resolve({});
        }
        throw new Error('unexpected S3 command ' + command.constructor.name);
      },
    });
    const poll = async (condition) => {
      const deadline = Date.now() + 5000;
      while (!(await condition())) {
        if (Date.now() >= deadline) throw new Error('source integrity mock timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const state = async (id) => (await manager.uploads()).find((job) => job.id === id);
    const beginHeld = async (id) => {
      await manager.resumeUpload(id);
      await poll(() => held.filter((item) => item.id === id).length === 3);
    };
    const releaseHeld = (id) => {
      delayFor.delete(id);
      for (const item of held.filter((item) => item.id === id))
        item.resolve({ ETag: 'etag-' + item.part });
    };
    try {
      await beginHeld('same-size');
      const paused = manager.pauseUpload('same-size');
      releaseHeld('same-size');
      assert.equal((await paused).status, 'paused');
      const firstParts = calls.parts.filter((part) => part.id === 'same-size').length;
      fs.writeFileSync(source, Buffer.alloc(20, 0x42));
      await assert.rejects(() => manager.resumeUpload('same-size'), /R2_UPLOAD_SOURCE_CHANGED/);
      assert.equal(calls.parts.filter((part) => part.id === 'same-size').length, firstParts);
      assert.equal(calls.completes.includes('same-size'), false);

      fs.writeFileSync(source, Buffer.alloc(20, 0x41));
      // The following jobs snapshot their own stable source before the mutation.
      await beginHeld('during-transfer');
      fs.writeFileSync(source, Buffer.alloc(20, 0x43));
      releaseHeld('during-transfer');
      await poll(async () => (await state('during-transfer')).status === 'failed');
      assert.equal(calls.completes.includes('during-transfer'), false);
      assert.equal(calls.aborts.includes('during-transfer'), true);
      assert.match((await state('during-transfer')).error, /R2_UPLOAD_SOURCE_CHANGED/);

      fs.writeFileSync(source, Buffer.alloc(20, 0x41));
      await beginHeld('inode');
      const inodePaused = manager.pauseUpload('inode');
      releaseHeld('inode');
      await inodePaused;
      const replacement = path.join(sourceRoot, 'replacement.bin');
      fs.writeFileSync(replacement, Buffer.alloc(20, 0x41));
      fs.renameSync(replacement, source);
      await assert.rejects(() => manager.resumeUpload('inode'), /R2_UPLOAD_SOURCE_CHANGED/);
      assert.equal(calls.completes.includes('inode'), false);

      await beginHeld('shrink');
      fs.truncateSync(source, 11);
      releaseHeld('shrink');
      await poll(async () => (await state('shrink')).status === 'failed');
      assert.equal(calls.completes.includes('shrink'), false);
      assert.equal(calls.aborts.includes('shrink'), true);
      assert.ok(
        calls.parts
          .filter((part) => part.id === 'shrink')
          .every((part) => part.bytes.equals(Buffer.alloc(5, 0x41))),
        'S3 must receive only verified original Part bytes, never mixed source generations',
      );
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true });
    }
  }

  console.log('R2 File Manager parity tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
