const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-civitai-tests-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});

(async()=>{
  const mod=await import(pathToFileURL(path.join(runtime,'main','civitai-catalog.js')).href);
  const resource=(postId,weight,versionId=42)=>({postId,meta:{civitaiResources:[{type:'lora',modelVersionId:versionId,weight}]}});
  const items=[
    resource(1,0.6),resource(1,0.8),
    resource(2,0.7),resource(3,0.9),resource(4,0.5),resource(5,0.7),
    resource(6,99,999),
  ];
  const baseline=mod.calculateStrengthBaseline(items,42);
  assert.equal(baseline.value,0.7,'baseline must be median of per-post medians');
  assert.equal(baseline.provenance.basis,'observed-usage-derived');
  assert.equal(baseline.provenance.method,'median-of-post-medians:newest-200');
  assert.equal(baseline.provenance.sampleCount,5);
  assert.equal(mod.calculateStrengthBaseline(items.slice(0,5),42),null,'fewer than five distinct posts must omit baseline');
  console.log('Integrated Civitai catalog tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
