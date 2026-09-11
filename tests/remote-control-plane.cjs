const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');
(async()=>{
 const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-remote-'));
 const hostKeys=await import(pathToFileURL(path.resolve('dist-electron/main/ssh-host-keys.js')));
 const worker=await import(pathToFileURL(path.resolve('dist-electron/main/remote-worker-source.js')));
 const store=new hostKeys.SshHostKeyStore(runtime),key=crypto.randomBytes(64),fp=hostKeys.sshHostKeyFingerprint(key);
 assert.equal((await store.check('gpu.example',22022,key)).status,'unknown');
 await store.trust('gpu.example',22022,key,'ssh-ed25519');
 assert.equal((await store.check('gpu.example',22022,key)).status,'trusted');
 const changed=await store.check('gpu.example',22022,crypto.randomBytes(64));assert.equal(changed.status,'mismatch');assert.equal(changed.expectedFingerprint,fp);
 const workerPath=path.join(runtime,'worker.py'),runDir=path.join(runtime,'run');fs.mkdirSync(runDir);fs.writeFileSync(workerPath,worker.REMOTE_WORKER_FILE);
 const call=req=>spawnSync('python',[workerPath,'--root',runDir],{input:JSON.stringify(req)+'\n',encoding:'utf8'});
 let result=call({requestId:'health-1',op:'health'});assert.equal(result.status,0);let lines=result.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.equal(lines.at(-1).result.version,worker.REMOTE_WORKER_VERSION);
 result=call({requestId:'state-1',op:'write_state',state:{runId:'abc',completed:7}});lines=result.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.equal(lines[0].type,'progress');assert.equal(lines.at(-1).result.ok,true);
 result=call({requestId:'status-1',op:'status'});lines=result.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.deepEqual(lines.at(-1).result.state,{runId:'abc',completed:7});
 result=call({requestId:'escape-1',op:'resolve_path',path:'../escape.txt'});assert.notEqual(result.status,0);lines=result.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.match(lines.at(-1).error.code,/PATH_OUTSIDE_ALLOWED_ROOT/);
 const outside=path.join(runtime,'outside');fs.mkdirSync(outside);try{fs.symlinkSync(outside,path.join(runDir,'link'),'junction');result=call({requestId:'link-1',op:'resolve_path',path:'link/file.txt'});assert.notEqual(result.status,0);lines=result.stdout.trim().split(/\r?\n/).map(JSON.parse);assert.match(lines.at(-1).error.code,/PATH_OUTSIDE_ALLOWED_ROOT|SYMLINK_ESCAPE_REJECTED/);}catch(e){if(process.platform!=='win32')throw e;}
 const persisted=fs.readFileSync(path.join(runtime,'ssh','known-hosts.json'),'utf8');assert.ok(!persisted.includes('PRIVATE KEY'));console.log('remote control plane tests passed');
})().catch(e=>{console.error(e);process.exit(1)});
