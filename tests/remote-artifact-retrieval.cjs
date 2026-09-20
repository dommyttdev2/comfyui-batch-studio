const assert = require('node:assert/strict');
const { matchCode, doesNotMatchCode } = require('./source-match.cjs');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-remote-artifact-'));
const compiled = path.join(runtime, 'compiled');
// Compiled service modules live outside the repository; link its installed
// runtime dependencies so ESM can resolve the R2 SDK during integration tests.
fs.symlinkSync(
  path.join(repo, 'node_modules'),
  path.join(runtime, 'node_modules'),
  process.platform === 'win32' ? 'junction' : 'dir',
);
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', compiled],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(compiled, 'main', relative)).href);
const callWorker = (workerPath, runDir, comfyRoot, req) =>
  new Promise((resolve, reject) => {
    const child = spawn('python', [workerPath, '--root', runDir, '--comfy-root', comfyRoot], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '',
      stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) =>
      resolve({
        code,
        stderr,
        lines: stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse),
      }),
    );
    child.stdin.end(JSON.stringify(req) + '\n');
  });
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  const { REMOTE_WORKER_FILE, REMOTE_WORKER_VERSION } = await load('remote-worker-source.js');
  assert.equal(REMOTE_WORKER_VERSION, '10');
  const workerPath = path.join(runtime, 'worker.py');
  fs.writeFileSync(workerPath, REMOTE_WORKER_FILE);
  const runId = '11111111-1111-4111-8111-111111111111',
    runDir = path.join(runtime, 'run'),
    comfyRoot = path.join(runtime, 'ComfyUI');
  const outputPrefix = 'BatchStudio/test/' + runId,
    outputDir = path.join(comfyRoot, 'output', ...outputPrefix.split('/'));
  const nested = path.join(outputDir, 'branch-a', runId + '_branch-a');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'a.png'), Buffer.from('artifact-a'));
  fs.writeFileSync(path.join(nested, 'b.png'), Buffer.from('artifact-b'));
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(
    path.join(runDir, 'state.json'),
    JSON.stringify({ version: 1, runId, status: 'completed', artifact: { outputPrefix } }),
  );

  let result = await callWorker(workerPath, runDir, comfyRoot, {
    requestId: 'package',
    op: 'package_artifacts',
    runId,
    expectedCount: 2,
    archiveFileName: '20260912_234512.zip',
  });
  assert.equal(result.code, 0, result.stderr);
  const packaged = result.lines.at(-1).result;
  assert.equal(packaged.artifactCount, 2);
  matchCode(packaged.package.sha256, /^[0-9a-f]{64}$/);
  matchCode(packaged.manifestSha256, /^[0-9a-f]{64}$/);
  const packagePath = path.join(runDir, 'artifacts', runId + '.zip');
  assert.equal(fs.existsSync(packagePath), true);
  assert.equal(packaged.package.size, fs.statSync(packagePath).size);
  assert.equal(packaged.package.sha256, sha(fs.readFileSync(packagePath)));
  const zipEntries = execFileSync(
    'python',
    [
      '-c',
      'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps(sorted(z.namelist())))',
      packagePath,
    ],
    { encoding: 'utf8' },
  ).trim();
  assert.deepEqual(
    JSON.parse(zipEntries),
    ['branch-a/a.png', 'branch-a/b.png'],
    'transport ZIP must contain only simplified artifact paths',
  );
  assert.equal(
    JSON.parse(zipEntries).includes('manifest.json'),
    false,
    'manifest.json must stay outside the ZIP',
  );
  const manifest = JSON.parse(packaged.manifestJson);
  assert.equal(manifest.version, 2);
  assert.equal(manifest.package.fileName, '20260912_234512.zip');
  assert.equal(manifest.package.size, packaged.package.size);
  assert.equal(manifest.package.sha256, packaged.package.sha256);
  assert.deepEqual(
    manifest.artifacts.map((x) => x.path),
    ['branch-a/a.png', 'branch-a/b.png'],
  );

  result = await callWorker(workerPath, runDir, comfyRoot, {
    requestId: 'bad-count',
    op: 'package_artifacts',
    runId,
    expectedCount: 3,
    archiveFileName: '20260912_234512.zip',
  });
  assert.equal(result.code, 2);
  assert.equal(result.lines.at(-1).error.code, 'REMOTE_ARTIFACT_COUNT_MISMATCH');

  let uploaded = Buffer.alloc(0),
    seenHeaders = {};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    uploaded = Buffer.concat(chunks);
    seenHeaders = req.headers;
    res.writeHead(200, { ETag: '"part-etag"' });
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/upload?X-Amz-Signature=secret';
    result = await callWorker(workerPath, runDir, comfyRoot, {
      requestId: 'upload',
      op: 'upload_artifact_package',
      url,
      headers: { 'content-type': 'application/zip', 'x-amz-meta-sha256': packaged.package.sha256 },
      offset: 0,
      length: packaged.package.size,
    });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.lines.at(-1).result.etag, '"part-etag"');
    assert.equal(sha(uploaded), packaged.package.sha256);
    assert.equal(seenHeaders['x-amz-meta-sha256'], packaged.package.sha256);
  } finally {
    server.close();
  }

  result = await callWorker(workerPath, runDir, comfyRoot, {
    requestId: 'cleanup',
    op: 'cleanup_artifacts',
  });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(runDir, 'artifacts')), false);
  assert.equal(fs.existsSync(outputDir), false);

  // Regression: Scene Prompt Tools stores .state and .lock sidecars alongside
  // generated images. They must not affect image counts, ZIP entries or manifest.
  const sidecarRunId = '22222222-2222-4222-8222-222222222222';
  const sidecarRunDir = path.join(runtime, 'sidecar-run');
  const sidecarOutputPrefix = 'BatchStudio/test/' + sidecarRunId;
  const sidecarOutputDir = path.join(comfyRoot, 'output', ...sidecarOutputPrefix.split('/'));
  const sidecarImageDir = path.join(sidecarOutputDir, 'branch-b', 'generated');
  fs.mkdirSync(sidecarImageDir, { recursive: true });
  fs.mkdirSync(sidecarRunDir, { recursive: true });
  for (let i = 0; i < 500; i++) {
    fs.writeFileSync(path.join(sidecarImageDir, String(i).padStart(3, '0') + '.png'), 'image');
  }
  for (let i = 0; i < 20; i++) {
    fs.writeFileSync(path.join(sidecarImageDir, i + '.state'), 'state');
    fs.writeFileSync(path.join(sidecarImageDir, i + '.lock'), 'lock');
  }
  fs.writeFileSync(
    path.join(sidecarRunDir, 'state.json'),
    JSON.stringify({
      version: 1,
      runId: sidecarRunId,
      status: 'completed',
      artifact: { outputPrefix: sidecarOutputPrefix },
    }),
  );
  const sidecarResult = await callWorker(workerPath, sidecarRunDir, comfyRoot, {
    requestId: 'sidecars',
    op: 'package_artifacts',
    runId: sidecarRunId,
    expectedCount: 500,
    archiveFileName: '20260912_234513.zip',
  });
  assert.equal(sidecarResult.code, 0, sidecarResult.stderr);
  const sidecarPackage = sidecarResult.lines.at(-1).result;
  assert.equal(sidecarPackage.artifactCount, 500);
  assert.equal(JSON.parse(sidecarPackage.manifestJson).artifacts.length, 500);
  const sidecarZip = path.join(sidecarRunDir, 'artifacts', sidecarRunId + '.zip');
  const sidecarZipEntries = JSON.parse(
    execFileSync(
      'python',
      [
        '-c',
        'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps(z.namelist()))',
        sidecarZip,
      ],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(sidecarZipEntries.length, 500);
  assert.ok(sidecarZipEntries.every((entry) => entry.endsWith('.png')));
  assert.equal(fs.existsSync(path.join(sidecarImageDir, '0.state')), true);
  assert.equal(fs.existsSync(path.join(sidecarImageDir, '0.lock')), true);

  const managerSource = fs.readFileSync(path.join(repo, 'src/main/r2-manager.ts'), 'utf8');
  const executionSource = fs.readFileSync(path.join(repo, 'src/main/remote-execution.ts'), 'utf8');
  const executionOutput = await load('execution-output.js');
  assert.equal(
    executionOutput.executionArchiveTimestampJst('2026-09-12T14:45:12.000Z'),
    '20260912_234512',
  );
  assert.equal(
    executionOutput.executionArchiveTimestampJst('2026-09-12T23:30:45.000Z'),
    '20260913_083045',
    'JST timestamp must cross the UTC date boundary correctly',
  );
  matchCode(
    managerSource,
    /R2_SINGLE_PUT_LIMIT=FIVE_GIB-5\*MIB/,
    'single PUT boundary must account for R2 practical limit',
  );
  matchCode(managerSource, /CreateMultipartUploadCommand/);
  matchCode(managerSource, /executionMultipartPartUrl/);
  matchCode(managerSource, /CompleteMultipartUploadCommand/);
  matchCode(executionSource, /\.part/, 'local download must use a .part file');
  matchCode(
    executionSource,
    /path\.join\(base,'remote_output',runId\)/,
    'Remote outputs must be stored under <artifact project>/remote_output/<runId>',
  );
  matchCode(
    executionSource,
    /manifest\.json/,
    'manifest must be persisted beside the downloaded ZIP',
  );
  matchCode(
    executionSource,
    /executionArchiveTimestampJst/,
    'archive filename must use an explicit JST timestamp',
  );
  matchCode(
    executionSource,
    /\.putUrlInfo\(bucket,key,900,'application\/zip'\)/,
    'single PUT must reuse the existing R2 PUT URL generator',
  );
  doesNotMatchCode(
    executionSource,
    /executionPutUrl/,
    'single PUT must not use a separate E2E presigner',
  );
  matchCode(
    executionSource,
    /REMOTE_ARTIFACT_HASH_MISMATCH/,
    'local SHA-256 mismatch must fail the run',
  );
  matchCode(executionSource, /CLEANUP_COMPLETED/, 'cleanup must be resumable evidence');
  matchCode(
    executionSource,
    /objectExists\(bucket,key\)/,
    'cleanup retry must treat an already-deleted R2 object as complete',
  );
  matchCode(
    executionSource,
    /localMatches\(finalPath,pkg.size,pkg.sha256\)/,
    'resume must revalidate the local ZIP instead of trusting old transport evidence',
  );
  doesNotMatchCode(executionSource, /scp/i, 'artifact recovery must not use SCP');

  // Exercise the actual service recovery flow with durable Run evidence and a
  // deterministic R2/Remote mock. No live cloud resources are required.
  const { RemoteExecutionService } = await load('remote-execution.js');
  const execution = await load('execution-run.js');
  const recoveryRoot = path.join(runtime, 'recovery-project');
  const recoveredRunId = '22222222-2222-4222-8222-222222222222';
  const recoveredDir = path.join(recoveryRoot, 'remote_output', recoveredRunId);
  const recoveredZip = path.join(recoveredDir, '20260912_234512.zip');
  const recoveredManifest = path.join(recoveredDir, 'manifest.json');
  fs.mkdirSync(path.join(recoveryRoot, 'execution_runs'), { recursive: true });
  fs.mkdirSync(recoveredDir, { recursive: true });
  fs.writeFileSync(
    path.join(recoveryRoot, 'project_meta.json'),
    JSON.stringify({ schemaVersion: 1, settings: { r2Bucket: 'test-bucket' } }),
  );
  const packagedBytes = uploaded;
  assert.equal(sha(packagedBytes), packaged.package.sha256);
  const runState = {
    schemaVersion: 1,
    runId: recoveredRunId,
    projectId: 'test',
    executionTarget: 'remote',
    lifecycle: 'RUNNING',
    phase: 'ARTIFACTS_COLLECTING',
    controls: { scheduling: 'ACTIVE', interrupt: 'IDLE' },
    current: { branchId: null, leafId: null, promptId: null },
    progress: { overall: { completed: 2, total: 2 }, branches: [] },
    snapshot: { runIdentity: 'artifact-recovery-fixture' },
    evidence: [],
    error: null,
    errorHistory: [],
    completedAt: null,
  };
  fs.writeFileSync(
    path.join(recoveryRoot, 'execution_runs', recoveredRunId + '.json'),
    JSON.stringify(runState),
  );
  const artifactKey = 'batch-studio/executions/test/' + recoveredRunId + '/artifacts.zip';
  const expectedManifest = packaged.manifestJson;
  await execution.recordExecutionEvidence(recoveryRoot, recoveredRunId, {
    kind: 'PACKAGE_VERIFIED',
    scope: 'remote-package',
    data: {
      artifactCount: 2,
      size: packaged.package.size,
      sha256: packaged.package.sha256,
      manifestSha256: packaged.manifestSha256,
      manifestJson: expectedManifest,
      archiveFileName: '20260912_234512.zip',
      outputPrefix,
    },
  });
  await execution.recordExecutionEvidence(recoveryRoot, recoveredRunId, {
    kind: 'R2_OBJECT_VERIFIED',
    scope: 'remote-package',
    data: { bucket: 'test-bucket', key: artifactKey, size: packaged.package.size },
  });
  await execution.recordExecutionEvidence(recoveryRoot, recoveredRunId, {
    kind: 'LOCAL_FILE_VERIFIED',
    scope: 'remote-package',
    data: {
      path: recoveredZip,
      manifestPath: recoveredManifest,
      size: packaged.package.size,
      sha256: packaged.package.sha256,
    },
  });
  await execution.recordExecutionEvidence(recoveryRoot, recoveredRunId, {
    kind: 'CLEANUP_COMPLETED',
    scope: 'remote-artifacts',
    data: { remote: true, r2: true },
  });

  let r2Object = null;
  const operations = { downloads: 0, deletes: 0, remoteCleanups: 0, uploads: 0 };
  const remoteMock = {
    requestWorker: async (_root, _id, operation) => {
      if (operation === 'cleanup_artifacts') {
        operations.remoteCleanups++;
        return { response: { ok: true } };
      }
      if (operation === 'upload_artifact_package') {
        operations.uploads++;
        throw new Error('Remote package has been deleted');
      }
      throw new Error('Unexpected Remote operation: ' + operation);
    },
  };
  const r2Mock = {
    objectExists: async (bucket, key) => {
      assert.equal(bucket, 'test-bucket');
      assert.equal(key, artifactKey);
      return r2Object !== null;
    },
    objectMetadata: async () => {
      if (!r2Object) throw new Error('R2 object missing');
      return { size: r2Object.length, sha256: sha(r2Object) };
    },
    downloadExecutionObject: async (_bucket, _key, dest) => {
      operations.downloads++;
      if (!r2Object) throw new Error('Do not download a missing R2 object');
      fs.writeFileSync(dest, r2Object);
    },
    deleteExecutionObject: async (_bucket, key) => {
      assert.equal(key, artifactKey, 'cleanup must only delete this Run object');
      operations.deletes++;
      r2Object = null;
    },
    putUrlInfo: async () => ({ url: 'https://example.invalid/package', contentType: null }),
  };
  const service = new RemoteExecutionService(remoteMock, r2Mock);
  fs.writeFileSync(recoveredZip, packagedBytes);
  fs.writeFileSync(recoveredManifest, expectedManifest);

  // Previous cleanup removed R2 and Remote packages; intact local ZIP must
  // complete with zero network operations.
  await service.collectArtifacts(recoveryRoot, recoveredRunId);
  assert.equal(
    (await execution.getExecutionRun(recoveryRoot, recoveredRunId)).lifecycle,
    'COMPLETED',
  );
  assert.deepEqual(operations, { downloads: 0, deletes: 0, remoteCleanups: 0, uploads: 0 });

  // A corrupt ZIP must be replaced from surviving R2 bytes, even when old
  // CLEANUP_COMPLETED and LOCAL_FILE_VERIFIED evidence are still present.
  fs.writeFileSync(recoveredZip, 'damaged');
  r2Object = Buffer.from(packagedBytes);
  await service.collectArtifacts(recoveryRoot, recoveredRunId);
  assert.equal(sha(fs.readFileSync(recoveredZip)), packaged.package.sha256);
  assert.equal(operations.downloads, 1);
  assert.equal(operations.deletes, 1, 'recovered transport object must be cleaned again');
  assert.equal(operations.remoteCleanups, 0, 'already-cleaned Remote host must not be required');

  // With both transport copies gone, recovery must report a dedicated error
  // without blindly downloading a missing R2 key or deleting the local file.
  fs.writeFileSync(recoveredZip, 'damaged again');
  await assert.rejects(
    () => service.collectArtifacts(recoveryRoot, recoveredRunId),
    (error) => error.code === 'REMOTE_ARTIFACT_RECOVERY_UNAVAILABLE',
  );
  assert.equal(operations.downloads, 1);
  assert.equal(fs.readFileSync(recoveredZip, 'utf8'), 'damaged again');
  await assert.rejects(
    () =>
      service.cleanup(
        recoveryRoot,
        recoveredRunId,
        'test-bucket',
        'another-run/artifacts.zip',
        true,
      ),
    (error) => error.code === 'REMOTE_ARTIFACT_CLEANUP_SCOPE_INVALID',
  );

  console.log('Remote artifact retrieval tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
