const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-remote-artifact-'));
const compiled=path.join(runtime,'compiled');
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',compiled],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(compiled,'main',relative)).href);
const callWorker=(workerPath,runDir,comfyRoot,req)=>new Promise((resolve,reject)=>{
  const child=spawn('python',[workerPath,'--root',runDir,'--comfy-root',comfyRoot],{stdio:['pipe','pipe','pipe']});
  let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
  child.on('error',reject);child.on('close',code=>resolve({code,stderr,lines:stdout.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse)}));
  child.stdin.end(JSON.stringify(req)+'\n');
});
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');

(async()=>{
  const {REMOTE_WORKER_FILE,REMOTE_WORKER_VERSION}=await load('remote-worker-source.js');
  assert.equal(REMOTE_WORKER_VERSION,'9');
  const workerPath=path.join(runtime,'worker.py');fs.writeFileSync(workerPath,REMOTE_WORKER_FILE);
  const runId='11111111-1111-4111-8111-111111111111',runDir=path.join(runtime,'run'),comfyRoot=path.join(runtime,'ComfyUI');
  const outputPrefix='BatchStudio/test/'+runId,outputDir=path.join(comfyRoot,'output',...outputPrefix.split('/'));
  fs.mkdirSync(path.join(outputDir,'branch-a'),{recursive:true});
  fs.writeFileSync(path.join(outputDir,'branch-a','a.png'),Buffer.from('artifact-a'));
  fs.writeFileSync(path.join(outputDir,'branch-a','b.png'),Buffer.from('artifact-b'));
  fs.mkdirSync(runDir,{recursive:true});
  fs.writeFileSync(path.join(runDir,'state.json'),JSON.stringify({version:1,runId,status:'completed',artifact:{outputPrefix}}));

  let result=await callWorker(workerPath,runDir,comfyRoot,{requestId:'package',op:'package_artifacts',runId,expectedCount:2});
  assert.equal(result.code,0,result.stderr);
  const packaged=result.lines.at(-1).result;
  assert.equal(packaged.artifactCount,2);assert.match(packaged.package.sha256,/^[0-9a-f]{64}$/);assert.match(packaged.manifestSha256,/^[0-9a-f]{64}$/);
  const packagePath=path.join(runDir,'artifacts',runId+'.zip');
  assert.equal(fs.existsSync(packagePath),true);assert.equal(packaged.package.size,fs.statSync(packagePath).size);
  assert.equal(packaged.package.sha256,sha(fs.readFileSync(packagePath)));
  const zipEntries=execFileSync('python',['-c','import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps(sorted(z.namelist())))',packagePath],{encoding:'utf8'}).trim();
  assert.deepEqual(JSON.parse(zipEntries),['artifacts/branch-a/a.png','artifacts/branch-a/b.png','manifest.json']);

  result=await callWorker(workerPath,runDir,comfyRoot,{requestId:'bad-count',op:'package_artifacts',runId,expectedCount:3});
  assert.equal(result.code,2);assert.equal(result.lines.at(-1).error.code,'REMOTE_ARTIFACT_COUNT_MISMATCH');

  let uploaded=Buffer.alloc(0),seenHeaders={};
  const server=http.createServer(async(req,res)=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);uploaded=Buffer.concat(chunks);seenHeaders=req.headers;res.writeHead(200,{ETag:'"part-etag"'});res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/upload?X-Amz-Signature=secret';
    result=await callWorker(workerPath,runDir,comfyRoot,{requestId:'upload',op:'upload_artifact_package',url,headers:{'content-type':'application/zip','x-amz-meta-sha256':packaged.package.sha256},offset:0,length:packaged.package.size});
    assert.equal(result.code,0,result.stderr);assert.equal(result.lines.at(-1).result.etag,'"part-etag"');
    assert.equal(sha(uploaded),packaged.package.sha256);assert.equal(seenHeaders['x-amz-meta-sha256'],packaged.package.sha256);
  }finally{server.close();}

  result=await callWorker(workerPath,runDir,comfyRoot,{requestId:'cleanup',op:'cleanup_artifacts'});
  assert.equal(result.code,0,result.stderr);assert.equal(fs.existsSync(path.join(runDir,'artifacts')),false);assert.equal(fs.existsSync(outputDir),false);

  const managerSource=fs.readFileSync(path.join(repo,'src/main/r2-manager.ts'),'utf8');
  const executionSource=fs.readFileSync(path.join(repo,'src/main/remote-execution.ts'),'utf8');
  assert.match(managerSource,/R2_SINGLE_PUT_LIMIT=FIVE_GIB-5\*MIB/,'single PUT boundary must account for R2 practical limit');
  assert.match(managerSource,/CreateMultipartUploadCommand/);assert.match(managerSource,/executionMultipartPartUrl/);assert.match(managerSource,/CompleteMultipartUploadCommand/);
  assert.match(executionSource,/\.part/,'local download must use a .part file');
  assert.match(executionSource,/\.putUrlInfo\(bucket,key,900,'application\/zip'\)/,'single PUT must reuse the existing R2 PUT URL generator');
  assert.doesNotMatch(executionSource,/executionPutUrl/,'single PUT must not use a separate E2E presigner');
  assert.match(executionSource,/REMOTE_ARTIFACT_HASH_MISMATCH/,'local SHA-256 mismatch must fail the run');
  assert.match(executionSource,/CLEANUP_COMPLETED/,'cleanup must be resumable evidence');
  assert.match(executionSource,/objectExists\(bucket,key\)/,'cleanup retry must treat an already-deleted R2 object as complete');
  assert.match(executionSource,/local&&uploaded/,'resume after local verification must not require re-uploading an already-cleaned R2 object');
  assert.doesNotMatch(executionSource,/scp/i,'artifact recovery must not use SCP');

  console.log('Remote artifact retrieval tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
