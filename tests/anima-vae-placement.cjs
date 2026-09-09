const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-anima-vae-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,'main',relative)).href);
const writeJson=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const checkpoint={ref:'checkpoint.main',modelId:1,modelName:'Anima checkpoint',versionId:2,versionName:'v1',fileId:3,fileName:'anima.safetensors',modelUrl:'https://example.com/model',trainedWords:[],reason:'test'};
const fileSelection=(ref,fileName)=>({ref,fileName,reason:'test'});

(async()=>{
  const {checkAvailability}=await load('availability.js');
  const project=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-anima-vae-project-'));
  const comfy=fs.mkdtempSync(path.join(os.tmpdir(),'ComfyUI-anima-'));
  const models=path.join(comfy,'models');
  fs.mkdirSync(path.join(models,'checkpoints'),{recursive:true});
  fs.mkdirSync(path.join(models,'text_encoders','vendor'),{recursive:true});
  fs.mkdirSync(path.join(models,'vae','vendor'),{recursive:true});
  fs.writeFileSync(path.join(models,'checkpoints','anima.safetensors'),'checkpoint');
  fs.writeFileSync(path.join(models,'text_encoders','vendor','t5.safetensors'),'text');
  fs.writeFileSync(path.join(models,'vae','vendor','ae.safetensors'),'vae');
  writeJson(path.join(project,'models.json'),{schemaVersion:4,modelFamily:'anima',catalog:{schemaVersion:1,generation:1,generatedAt:'2026-09-09T00:00:00Z'},checkpoint,textEncoder:fileSelection('text_encoder.main','vendor/t5.safetensors'),vae:fileSelection('vae.main','vendor/ae.safetensors'),loras:[]});
  writeJson(path.join(project,'project_meta.json'),{schemaVersion:1,createdAt:new Date().toISOString(),settings:{executionTarget:'local'}});

  let requested=[];
  let result=await checkAvailability(project,async name=>{requested.push(name);return false},models);
  assert.equal(result.validation.valid,true);
  assert.equal(result.rows.find(x=>x.kind==='text_encoder').local,true);
  assert.equal(result.rows.find(x=>x.kind==='vae').local,true);
  assert.ok(requested.includes('text_encoders/vendor/t5.safetensors'));
  assert.ok(requested.includes('vae/vendor/ae.safetensors'));
  assert.equal(requested.some(x=>x.startsWith('clip/')),false,'corrected Anima placement must not query models/clip');

  writeJson(path.join(project,'project_meta.json'),{schemaVersion:1,createdAt:new Date().toISOString(),settings:{executionTarget:'remote'}});
  requested=[];
  result=await checkAvailability(project,async name=>{requested.push(name);return true},models);
  assert.equal(result.validation.valid,true);
  assert.ok(requested.includes('vae/vendor/ae.safetensors'),'remote placement must query VAE under vae/');

  console.log('Corrected Anima Text Encoder/VAE placement tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
