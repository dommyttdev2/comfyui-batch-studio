const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-rate-limit-tests-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

(async()=>{
  process.env.CIVITAI_BASE_URL='https://civitai.test';
  process.env.CIVITAI_MATURE_BASE_URL='https://civitai.test';
  process.env.CIVITAI_REQUEST_INTERVAL_MS='0';
  process.env.CIVITAI_MIN_RETRY_MS='1';
  const mod=await import(pathToFileURL(path.join(runtime,'main','civitai-request-policy.js')).href);
  assert.equal(mod.parseRetryAfter('2',1000),2000);
  assert.equal(mod.parseRetryAfter('Thu, 01 Jan 1970 00:00:03 GMT',1000),2000);

  let calls=0;
  const fakeFetch=async()=>{
    calls++;
    if(calls===1)return new Response('{}',{status:429,headers:{'Retry-After':'0'}});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const original=globalThis.fetch;
  const policy=new mod.CivitaiRequestPolicy(fakeFetch);
  policy.install();
  try{
    const response=await globalThis.fetch('https://civitai.test/api/v1/models/1');
    assert.equal(response.status,200,'429 must be absorbed and retried');
    assert.equal(calls,2,'the exact request must resume after one rate-limit response');
    for(let i=0;i<20&&policy.status().waiting;i++)await sleep(2);
    assert.equal(policy.status().waiting,false,'policy must leave waiting state after successful retry');
  } finally {
    globalThis.fetch=original;
  }
  console.log('Civitai rate-limit resume tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
