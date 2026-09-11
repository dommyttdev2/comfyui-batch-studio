const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-r2-parity-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,relative)).href);

(async()=>{
  const managerUtils=await load('shared/r2-manager-utils.js');
  const downloadUtils=await load('shared/r2-download-utils.js');

  assert.equal(managerUtils.normalizeR2ObjectKey(' /models\\loras//character.safetensors '),'models/loras/character.safetensors');
  assert.throws(()=>managerUtils.normalizeR2ObjectKey('models/../bad.safetensors'),/\.\./u);
  assert.throws(()=>managerUtils.normalizeR2ObjectKey('models/'),/ファイル名/);
  assert.throws(()=>managerUtils.normalizeR2ObjectKey(`${'あ'.repeat(400)}/x.safetensors`),/1,024バイト/);

  assert.equal(managerUtils.normalizeR2PutObjectKey(' /uploads\\incoming//model.safetensors '),'uploads/incoming/model.safetensors');
  assert.throws(()=>managerUtils.normalizeR2PutObjectKey('uploads/../bad.bin'),/\.\./u);
  assert.throws(()=>managerUtils.normalizeR2PutObjectKey('uploads/'),/アップロード先.*ファイル名/u);
  assert.equal(managerUtils.normalizeR2PresignedExpiresIn(3600),3600);
  assert.equal(managerUtils.normalizeR2PresignedExpiresIn(604800),604800);
  assert.throws(()=>managerUtils.normalizeR2PresignedExpiresIn(0),/1秒～7日/u);
  assert.throws(()=>managerUtils.normalizeR2PresignedExpiresIn(604801),/1秒～7日/u);
  assert.equal(managerUtils.normalizeR2PutContentType(' image/png '),'image/png');
  assert.equal(managerUtils.normalizeR2PutContentType(''),null);
  assert.throws(()=>managerUtils.normalizeR2PutContentType('image/png\nX-Test: bad'),/Content-Type/u);

  assert.equal(managerUtils.normalizeBatchTemplateName('  Favorites  '),'Favorites');
  assert.throws(()=>managerUtils.normalizeBatchTemplateName(''),/テンプレート名/);
  assert.throws(()=>managerUtils.normalizeBatchTemplateName('x'.repeat(101)),/100文字/);
  const normalized=managerUtils.normalizeBatchTemplateObjects([{key:'models/a.bin',name:'ignored',size:10}]);
  assert.deepEqual(normalized,[{key:'models/a.bin',name:'a.bin',size:10}]);
  assert.throws(()=>managerUtils.normalizeBatchTemplateObjects([{key:'a.bin',size:1},{key:'a.bin',size:1}]),/Object Key/);

  assert.equal(downloadUtils.normalizeAria2Connections(99),16);
  assert.equal(downloadUtils.normalizeAria2ConcurrentDownloads(0),1);
  assert.equal(
    downloadUtils.buildAria2Command([{url:'https://example.test/a'},{url:'https://example.test/b'}],8,4),
    "aria2c --allow-overwrite=false --auto-file-renaming=false -j4 -x8 -Z 'https://example.test/a' 'https://example.test/b'",
  );
  assert.equal(downloadUtils.formatBatchTotalSize(1.5*1024**3),'1.50 GB');

  const managerSource=fs.readFileSync(path.join(repo,'src/main/r2-manager.ts'),'utf8');
  const indexSource=fs.readFileSync(path.join(repo,'src/main/r2-object-index.ts'),'utf8');
  const mainSource=fs.readFileSync(path.join(repo,'src/main/main.ts'),'utf8');
  const preloadSource=fs.readFileSync(path.join(repo,'src/preload/index.cjs'),'utf8');
  const rendererSource=fs.readFileSync(path.join(repo,'src/renderer/R2ManagerStage.tsx'),'utf8');
  assert.match(managerSource,/UPLOAD_CONCURRENCY=3/,'multipart upload must keep three concurrent workers');
  assert.match(managerSource,/this\.syncIndex\(\)/,'R2 mutations must refresh the local object index');
  assert.match(managerSource,/kind:'move'/,'moves must be represented as transfer jobs');
  assert.match(managerSource,/UploadPartCopyCommand/,'large moves must retain multipart copy support');
  assert.match(managerSource,/putUrlInfo\(/,'manager must expose presigned PUT URL generation');
  assert.match(managerSource,/async objectExists\(bucket:string,key:string\)/,'preflight must have a live R2 object existence probe');
  assert.match(managerSource,/new PutObjectCommand\(\{Bucket:bucket,Key:key/,'PUT URL must sign a PutObject request for the requested key');
  assert.match(managerSource,/ContentType:contentType/,'PUT URL must support an optional signed Content-Type restriction');
  assert.match(mainSource,/R2_PUT_URL_INFO/,'main process must register PUT URL IPC');
  assert.match(mainSource,/r2\(\)\.objectExists\(bucket,key\)/,'model availability must use live R2 HEAD checks for exact model keys');
  assert.match(mainSource,/refreshedIndex\?\?=r2Index\(\)\.sync\(\)/,'basename-only lookup must refresh the R2 index before fallback search');
  assert.match(preloadSource,/putUrlInfo:/,'preload bridge must expose PUT URL generation');
  assert.match(rendererSource,/一時PUT URL生成/,'R2 File Manager must expose the PUT URL action');
  assert.match(rendererSource,/Content-Typeを指定した場合/,'UI must explain signed Content-Type behavior');
  assert.match(indexSource,/syncQueues/,'index syncs from multiple manager instances must be serialized');

  console.log('R2 File Manager parity tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
