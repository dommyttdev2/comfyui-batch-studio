const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-studio-remote-model-staging-'));
const compiled = path.join(runtime, 'compiled');
const tscBin = path.join(repo, 'node_modules', 'typescript', 'bin', 'tsc');
execFileSync(
  process.execPath,
  [tscBin, '-p', path.join(repo, 'tsconfig.electron.json'), '--outDir', compiled],
  { cwd: repo, stdio: 'inherit' },
);
const load = (relative) => import(pathToFileURL(path.join(compiled, 'main', relative)).href);
const writeJson = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
};
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');

(async () => {
  try {
    const [{ RemoteModelStager }, { RemoteWorkerRequestError }, placement, worker] =
      await Promise.all([
        load('remote-model-stager.js'),
        load('remote-worker.js'),
        load('model-placement-paths.js'),
        load('remote-worker-source.js'),
      ]);

    assert.equal(
      placement.remoteModelRelativePath('illustrious', 'checkpoint', 'base.safetensors'),
      'checkpoints/base.safetensors',
    );
    assert.equal(
      placement.remoteModelRelativePath('illustrious', 'lora', 'folder/character.safetensors'),
      'loras/folder/character.safetensors',
    );
    assert.equal(
      placement.remoteModelRelativePath('anima', 'diffusion_model', 'anima.safetensors'),
      'diffusion_models/anima.safetensors',
    );
    assert.equal(
      placement.remoteModelRelativePath('anima', 'text_encoder', 'qwen.safetensors'),
      'text_encoders/qwen.safetensors',
    );
    assert.equal(
      placement.remoteModelRelativePath('anima', 'vae', 'vae.safetensors'),
      'vae/vae.safetensors',
    );
    assert.equal(
      placement.joinR2ModelKey('/models/', 'checkpoints/base.safetensors'),
      'models/checkpoints/base.safetensors',
    );

    const project = path.join(runtime, 'project');
    fs.mkdirSync(project, { recursive: true });
    writeJson(path.join(project, 'models.json'), {
      schemaVersion: 1,
      catalog: { schemaVersion: 1, generation: 1, generatedAt: '2026-09-11T00:00:00Z' },
      checkpoint: {
        ref: 'checkpoint.main',
        modelId: 1,
        modelName: 'Base',
        versionId: 2,
        versionName: 'v1',
        fileId: 3,
        fileName: 'base.safetensors',
        modelUrl: 'https://example.com/base',
        trainedWords: [],
        reason: 'test',
      },
      loras: [],
    });
    writeJson(path.join(project, 'project_meta.json'), {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      settings: { executionTarget: 'remote', r2Bucket: 'models-bucket', r2ModelPrefix: '' },
    });
    const runId = '00000000-0000-4000-8000-000000000050';
    writeJson(path.join(project, 'execution_runs', runId + '.json'), {
      schemaVersion: 1,
      runId,
      projectId: 'p50',
      executionTarget: 'remote',
      remote: { provider: 'vastai', instanceId: 50 },
      lifecycle: 'RUNNING',
      phase: 'REMOTE_ENVIRONMENT_CHECKING',
      controls: {
        scheduling: 'ACTIVE',
        interrupt: 'IDLE',
        stopSchedulingRequestedAt: null,
        forceInterruptRequestedAt: null,
      },
      current: { branchId: null, leafId: null, promptId: null },
      progress: { overall: { completed: 0, total: 1 }, branches: [], models: [] },
      promptIds: [],
      evidence: [],
      error: null,
      errorHistory: [],
      snapshot: {
        projectId: 'p50',
        target: 'remote',
        remote: { provider: 'vastai', instanceId: 50 },
        preflight: {
          state: 'READY',
          plannedImages: 1,
          targetImages: 1,
          blocking: [],
          warnings: [],
          sections: [],
        },
        workflow: {
          uiPath: 'x',
          apiPath: 'y',
          uiSha256: 'u',
          apiSha256: 'a',
          workflowIdentity: 'w',
        },
        plan: { sha256: 'p', branches: [] },
        runIdentity: 'run-identity-50',
      },
      resume: {
        attempts: 0,
        lastAttemptAt: null,
        lastValidatedEvidenceIds: [],
        lastIgnoredEvidenceIds: [],
        lastDecisionPhase: null,
      },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });
    const payload = Buffer.from('remote-model-payload');
    const expectedSha = sha(payload);
    let metadata = {
      key: 'models/checkpoints/base.safetensors',
      size: payload.length,
      sha256: expectedSha,
      etag: 'etag-v1',
    };
    let urlCalls = 0,
      stageCalls = 0,
      inspectValid = false,
      indexSyncCalls = 0,
      resolveCalls = 0;
    const fakeR2 = {
      syncObjectIndex: async () => {
        indexSyncCalls++;
      },
      resolveModelObjectKey: async (_bucket, relativePath, prefix) => {
        resolveCalls++;
        assert.equal(relativePath, 'checkpoints/base.safetensors');
        assert.equal(prefix, '');
        return 'models/checkpoints/base.safetensors';
      },
      objectMetadata: async (_bucket, key) => ({ ...metadata, key }),
      downloadInfo: async (_bucket, key, expiresIn) => {
        urlCalls++;
        assert.equal(key, 'models/checkpoints/base.safetensors');
        assert.ok(expiresIn >= 21600);
        return {
          key,
          url:
            urlCalls === 1
              ? 'https://r2.invalid/expired?X-Amz-Signature=SECRET'
              : 'https://r2.invalid/fresh?X-Amz-Signature=SECRET2',
          public: false,
          expiresIn,
          fileName: 'base.safetensors',
          commands: { url: '', curl: '', wget: '', aria2c: '' },
        };
      },
    };
    const fakeRemote = {
      requestWorker: async (_root, _run, op, payloadReq = {}) => {
        if (op === 'model_environment') return { response: { ok: true }, events: [] };
        if (op === 'inspect_model')
          return {
            response: inspectValid
              ? {
                  exists: true,
                  valid: true,
                  size: payload.length,
                  sha256: expectedSha,
                  reason: 'valid',
                }
              : { exists: false, valid: false, size: 0, sha256: null, reason: 'missing' },
            events: [],
          };
        if (op === 'stage_model') {
          stageCalls++;
          assert.match(payloadReq.url, /X-Amz-Signature=/);
          if (stageCalls === 1)
            throw new RemoteWorkerRequestError(
              'MODEL_DOWNLOAD_HTTP_403',
              'Remote model download returned HTTP 403.',
            );
          inspectValid = true;
          return {
            response: {
              exists: true,
              valid: true,
              size: payload.length,
              sha256: expectedSha,
              reason: 'downloaded',
              reused: false,
            },
            events: [
              {
                type: 'progress',
                stage: 'model_downloading',
                transferredBytes: payload.length,
                totalBytes: payload.length,
              },
            ],
          };
        }
        throw new Error('unexpected op ' + op);
      },
    };
    const stager = new RemoteModelStager(fakeR2, fakeRemote);
    await stager.stage(project, runId);
    assert.equal(
      indexSyncCalls,
      1,
      'R2 object index must be refreshed before resolving model keys',
    );
    assert.equal(resolveCalls, 1, 'stager must resolve the actual R2 object key');
    assert.equal(urlCalls, 2, 'expired URL must be reissued');
    assert.equal(stageCalls, 2);
    let persisted = fs.readFileSync(path.join(project, 'execution_runs', runId + '.json'), 'utf8');
    assert.doesNotMatch(
      persisted,
      /X-Amz-Signature|expired\?|fresh\?/,
      'signed URL must never be persisted',
    );
    let run = JSON.parse(persisted);
    assert.equal(run.phase, 'REMOTE_MODELS_READY');
    assert.equal(run.progress.models[0].state, 'ready');
    assert.equal(run.progress.models[0].sha256, expectedSha);
    assert.ok(run.evidence.some((e) => e.kind === 'MODEL_VERIFIED'));
    assert.ok(run.evidence.some((e) => e.kind === 'MODELS_VERIFIED'));

    const previousUrlCalls = urlCalls;
    await stager.stage(project, runId);
    run = JSON.parse(
      fs.readFileSync(path.join(project, 'execution_runs', runId + '.json'), 'utf8'),
    );
    assert.equal(
      urlCalls,
      previousUrlCalls,
      'valid remote file with evidence must not be downloaded again',
    );
    assert.equal(run.progress.models[0].state, 'skipped');
    assert.equal(run.progress.models[0].reused, true);

    metadata = { ...metadata, etag: 'etag-v2' };
    await assert.rejects(() => stager.stage(project, runId), /R2_MODEL_CHANGED_DURING_RUN/);

    // Without R2 checksum metadata, size alone must never authorize a Remote reuse.
    // A multipart ETag is an object version marker, not a model SHA-256.
    const unverifiedProject = path.join(runtime, 'unverified-source');
    fs.mkdirSync(unverifiedProject, { recursive: true });
    fs.copyFileSync(path.join(project, 'models.json'), path.join(unverifiedProject, 'models.json'));
    fs.copyFileSync(
      path.join(project, 'project_meta.json'),
      path.join(unverifiedProject, 'project_meta.json'),
    );
    const unverifiedRun = {
      ...run,
      evidence: [],
      phase: 'REMOTE_ENVIRONMENT_CHECKING',
      progress: { ...run.progress, models: [] },
      snapshot: { ...run.snapshot, runIdentity: 'unverified-source-run' },
    };
    writeJson(path.join(unverifiedProject, 'execution_runs', runId + '.json'), unverifiedRun);
    const mismatchedSha = sha(Buffer.alloc(payload.length, 42));
    assert.notEqual(mismatchedSha, expectedSha);
    let sourceMetadata = { ...metadata, sha256: null, etag: 'multipart-etag-4' };
    let sourceInspectSha = mismatchedSha;
    let sourceInspectCalls = 0;
    let sourceStageCalls = 0;
    const sourceR2 = {
      syncObjectIndex: async () => {},
      resolveModelObjectKey: async () => 'models/checkpoints/base.safetensors',
      objectMetadata: async () => ({ ...sourceMetadata }),
      downloadInfo: async () => ({
        key: 'models/checkpoints/base.safetensors',
        url: 'https://r2.invalid/source?X-Amz-Signature=SOURCE',
      }),
    };
    const sourceRemote = {
      requestWorker: async (_root, _run, op, payloadReq = {}) => {
        if (op === 'model_environment') return { response: { ok: true }, events: [] };
        if (op === 'inspect_model') {
          sourceInspectCalls++;
          return {
            response: {
              exists: true,
              valid: !payloadReq.expectedSha256 || payloadReq.expectedSha256 === sourceInspectSha,
              size: payload.length,
              sha256: sourceInspectSha,
              reason: 'valid',
            },
            events: [],
          };
        }
        if (op === 'stage_model') {
          sourceStageCalls++;
          assert.equal(payloadReq.forceDownload, true, 'missing source hash requires R2 download');
          assert.equal(payloadReq.expectedSha256, null);
          sourceInspectSha = expectedSha;
          return {
            response: {
              exists: true,
              valid: true,
              reused: false,
              size: payload.length,
              sha256: expectedSha,
              reason: 'downloaded',
            },
            events: [],
          };
        }
        throw new Error('unexpected source op ' + op);
      },
    };
    const sourceStager = new RemoteModelStager(sourceR2, sourceRemote);
    await sourceStager.stage(unverifiedProject, runId);
    assert.equal(sourceStageCalls, 1, 'wrong same-size Remote file must not be reused');
    let sourceRun = JSON.parse(
      fs.readFileSync(path.join(unverifiedProject, 'execution_runs', runId + '.json'), 'utf8'),
    );
    assert.equal(sourceRun.progress.models[0].sha256, expectedSha);
    assert.equal(
      sourceRun.evidence.find((e) => e.kind === 'MODEL_VERIFIED').data.sourceVerified,
      true,
    );
    await sourceStager.stage(unverifiedProject, runId);
    assert.equal(
      sourceStageCalls,
      1,
      'matching source-bound evidence may reuse verified Remote model',
    );
    assert.ok(sourceInspectCalls >= 2);
    sourceMetadata = { ...sourceMetadata, etag: 'changed-multipart-etag-5' };
    await assert.rejects(
      () => sourceStager.stage(unverifiedProject, runId),
      /R2_MODEL_CHANGED_DURING_RUN/,
    );

    const parallelProject = path.join(runtime, 'parallel-project');
    fs.mkdirSync(parallelProject, { recursive: true });
    const parallelLoras = Array.from({ length: 5 }, (_, index) => ({
      ref: 'lora.' + (index + 1),
      modelId: 10 + index,
      modelName: 'LoRA ' + (index + 1),
      versionId: 20 + index,
      versionName: 'v1',
      fileId: 30 + index,
      fileName: 'lora-' + (index + 1) + '.safetensors',
      modelUrl: 'https://example.com/lora-' + (index + 1),
      trainedWords: [],
      reason: 'parallel test',
    }));
    writeJson(path.join(parallelProject, 'models.json'), {
      schemaVersion: 1,
      catalog: { schemaVersion: 1, generation: 1, generatedAt: '2026-09-13T00:00:00Z' },
      checkpoint: {
        ref: 'checkpoint.parallel',
        modelId: 101,
        modelName: 'Parallel Base',
        versionId: 102,
        versionName: 'v1',
        fileId: 103,
        fileName: 'parallel-base.safetensors',
        modelUrl: 'https://example.com/parallel-base',
        trainedWords: [],
        reason: 'parallel test',
      },
      loras: parallelLoras,
    });
    writeJson(path.join(parallelProject, 'project_meta.json'), {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      settings: { executionTarget: 'remote', r2Bucket: 'models-bucket', r2ModelPrefix: '' },
    });
    const parallelRunId = '00000000-0000-4000-8000-000000000051';
    writeJson(path.join(parallelProject, 'execution_runs', parallelRunId + '.json'), {
      schemaVersion: 1,
      runId: parallelRunId,
      projectId: 'p51',
      executionTarget: 'remote',
      remote: { provider: 'vastai', instanceId: 51 },
      lifecycle: 'RUNNING',
      phase: 'REMOTE_ENVIRONMENT_CHECKING',
      controls: {
        scheduling: 'ACTIVE',
        interrupt: 'IDLE',
        stopSchedulingRequestedAt: null,
        forceInterruptRequestedAt: null,
      },
      current: { branchId: null, leafId: null, promptId: null },
      progress: { overall: { completed: 0, total: 1 }, branches: [], models: [] },
      promptIds: [],
      evidence: [],
      error: null,
      errorHistory: [],
      snapshot: {
        projectId: 'p51',
        target: 'remote',
        remote: { provider: 'vastai', instanceId: 51 },
        preflight: {
          state: 'READY',
          plannedImages: 1,
          targetImages: 1,
          blocking: [],
          warnings: [],
          sections: [],
        },
        workflow: {
          uiPath: 'x',
          apiPath: 'y',
          uiSha256: 'u',
          apiSha256: 'a',
          workflowIdentity: 'w',
        },
        plan: { sha256: 'p', branches: [] },
        runIdentity: 'run-identity-51',
      },
      resume: {
        attempts: 0,
        lastAttemptAt: null,
        lastValidatedEvidenceIds: [],
        lastIgnoredEvidenceIds: [],
        lastDecisionPhase: null,
      },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    });
    let activeDownloads = 0,
      maxActiveDownloads = 0,
      parallelStageCalls = 0;
    const parallelR2 = {
      syncObjectIndex: async () => {},
      resolveModelObjectKey: async (_bucket, relativePath) => 'models/' + relativePath,
      objectMetadata: async (_bucket, key) => ({
        key,
        size: payload.length,
        sha256: expectedSha,
        etag: 'etag-' + key,
      }),
      downloadInfo: async (_bucket, key, expiresIn) => ({
        key,
        url: 'https://r2.invalid/' + encodeURIComponent(key) + '?X-Amz-Signature=PARALLEL',
        public: false,
        expiresIn,
        fileName: path.basename(key),
        commands: { url: '', curl: '', wget: '', aria2c: '' },
      }),
    };
    const parallelRemote = {
      requestWorker: async (_root, _run, op, payloadReq = {}) => {
        if (op === 'model_environment') return { response: { ok: true }, events: [] };
        if (op === 'inspect_model')
          return {
            response: { exists: false, valid: false, size: 0, sha256: null, reason: 'missing' },
            events: [],
          };
        if (op === 'stage_model') {
          parallelStageCalls++;
          activeDownloads++;
          maxActiveDownloads = Math.max(maxActiveDownloads, activeDownloads);
          await new Promise((resolve) => setTimeout(resolve, 40));
          activeDownloads--;
          return {
            response: {
              exists: true,
              valid: true,
              size: payload.length,
              sha256: expectedSha,
              reason: 'downloaded',
              reused: false,
            },
            events: [
              {
                type: 'progress',
                stage: 'model_downloading',
                transferredBytes: payload.length,
                totalBytes: payload.length,
              },
            ],
          };
        }
        throw new Error('unexpected op ' + op);
      },
    };
    await new RemoteModelStager(parallelR2, parallelRemote).stage(parallelProject, parallelRunId);
    const parallelRun = JSON.parse(
      fs.readFileSync(
        path.join(parallelProject, 'execution_runs', parallelRunId + '.json'),
        'utf8',
      ),
    );
    assert.equal(parallelStageCalls, 6, 'all required models must be staged');
    assert.equal(
      maxActiveDownloads,
      4,
      'remote model staging must run up to four model downloads concurrently',
    );
    assert.equal(parallelRun.phase, 'REMOTE_MODELS_READY');
    assert.ok(parallelRun.progress.models.every((model) => model.state === 'ready'));
    assert.equal(parallelRun.evidence.filter((e) => e.kind === 'MODEL_VERIFIED').length, 6);

    if (process.platform !== 'win32') {
      const workerPath = path.join(runtime, 'worker.py'),
        modelsRoot = path.join(runtime, 'remote-comfy', 'models'),
        runRoot = path.join(runtime, 'worker-run');
      fs.mkdirSync(path.join(modelsRoot, 'checkpoints'), { recursive: true });
      fs.mkdirSync(runRoot, { recursive: true });
      fs.writeFileSync(workerPath, worker.REMOTE_WORKER_FILE);
      const pythonTest = String.raw`
import hashlib,importlib.util,os,sys
worker_path=sys.argv[1]; model_root=sys.argv[2]
spec=importlib.util.spec_from_file_location("batch_worker",worker_path); w=importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
payload=b"worker-model-payload"
class Result:
 def __init__(self,code=0,out="",err=""): self.returncode=code; self.stdout=out; self.stderr=err
w.shutil.which=lambda name: "/fake/aria2c" if name=="aria2c" else None
calls=[]
def successful_run(args,cwd=None,env=None,input=None,text=True,capture_output=True):
 assert args[0]=="aria2c"
 assert all("X-Amz-Signature" not in a for a in args), "signed URL must not appear in process argv"
 assert input and "X-Amz-Signature=" in input, "signed URL must be supplied through stdin"
 assert not any(a.startswith("--out=") for a in args), "aria2 ignores global --out in input-file mode"
 input_lines=input.splitlines()
 assert len(input_lines)==2 and input_lines[0]==url, "only the signed URL and one per-URI option are expected"
 assert input_lines[1].startswith(" out="), "the output file must be specified as a per-URI aria2 option"
 out_name=input_lines[1].strip().split("=",1)[1]
 assert out_name==os.path.basename(target)+".part", "aria2 must download to the temporary file"
 out_dir=next(a for a in args if a.startswith("--dir=")).split("=",1)[1]
 open(os.path.join(out_dir,out_name),"wb").write(payload)
 calls.append((args,input))
 return Result()
w.subprocess.run=successful_run
target=os.path.join(model_root,"checkpoints","model.safetensors")
expected=hashlib.sha256(payload).hexdigest()
url="https://example.invalid/model?X-Amz-Signature=SECRET"
result=w.download_model(model_root,{"path":"checkpoints/model.safetensors","url":url,"expectedSize":len(payload),"expectedSha256":expected})
assert result["valid"] and open(target,"rb").read()==payload and not os.path.exists(target+".part")
open(target,"wb").write(b"x"*len(payload))
result=w.download_model(model_root,{"path":"checkpoints/model.safetensors","url":url,"expectedSize":len(payload),"forceDownload":True})
assert result["valid"] and not result["reused"] and open(target,"rb").read()==payload
os.unlink(target)
try:
 w.download_model(model_root,{"path":"checkpoints/model.safetensors","url":url,"expectedSize":len(payload),"expectedSha256":"0"*64})
 raise AssertionError("hash mismatch must fail")
except w.WorkerError as e:
 assert e.code=="MODEL_SHA256_MISMATCH"
assert not os.path.exists(target)
def expired_run(args,cwd=None,env=None,input=None,text=True,capture_output=True):
 return Result(22,"","HTTP status=403")
w.subprocess.run=expired_run
try:
 w.download_model(model_root,{"path":"checkpoints/model.safetensors","url":url,"expectedSize":len(payload)})
 raise AssertionError("expired URL must fail")
except w.WorkerError as e:
 assert e.code=="MODEL_DOWNLOAD_HTTP_403"
assert not os.path.exists(target)
print("worker aria2 staging regression passed")
  `;
      const py = spawnSync('python', ['-c', pythonTest, workerPath, modelsRoot], {
        encoding: 'utf8',
      });
      assert.equal(py.status, 0, py.stderr || py.stdout);
      } else {
      console.log('Remote model worker aria2 integration skipped on Windows; covered by Linux CI.');
    }
    console.log('Remote model staging tests passed.');
  } finally {
    fs.rmSync(runtime, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
