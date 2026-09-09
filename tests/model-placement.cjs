const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-model-placement-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,'main',relative)).href);
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n')};
const modelArtifact={schemaVersion:1,catalog:{schemaVersion:1,generation:1,generatedAt:'2026-09-09T00:00:00Z'},checkpoint:{ref:'checkpoint.main',modelId:1,modelName:'Checkpoint',versionId:2,versionName:'v1',fileId:3,fileName:'checkpoint.safetensors',modelUrl:'https://example.com/model',trainedWords:[],reason:'test'},loras:[]};

(async()=>{
  const [{checkAvailability},{AppSettingsStore}]=await Promise.all([load('availability.js'),load('app-settings.js')]);
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-model-placement-project-'));
  writeJson(path.join(root,'models.json'),modelArtifact);
  const comfyRoot=fs.mkdtempSync(path.join(os.tmpdir(),'ComfyUI-'));
  const modelsRoot=path.join(comfyRoot,'models');
  const nested=path.join(modelsRoot,'checkpoints');
  fs.mkdirSync(nested,{recursive:true});
  const modelFile=path.join(nested,'checkpoint.safetensors');
  fs.writeFileSync(modelFile,'model');
  const writeMeta=executionTarget=>writeJson(path.join(root,'project_meta.json'),{schemaVersion:1,createdAt:new Date().toISOString(),settings:{executionTarget,comfyModelsRoot:modelsRoot}});
  const r2None=async()=>false,r2All=async()=>true;

  writeMeta('local');
  let result=await checkAvailability(root,r2None,modelsRoot);
  assert.equal(result.executionTarget,'local');
  assert.equal(result.localModelsRoot,modelsRoot);
  assert.equal(result.rows[0].local,true,'local lookup must recurse under ComfyUI/models');
  assert.equal(result.rows[0].r2,false);
  assert.equal(result.validation.valid,true,'local execution must not require R2 placement');

  fs.unlinkSync(modelFile);
  result=await checkAvailability(root,r2All,modelsRoot);
  assert.equal(result.rows[0].state,'transfer-required');
  assert.equal(result.validation.valid,false,'local execution must require local placement even when R2 has the model');
  assert.ok(result.validation.issues.some(issue=>issue.code==='MODEL_LOCAL_PLACEMENT_REQUIRED'));

  fs.writeFileSync(modelFile,'model');
  writeMeta('remote');
  result=await checkAvailability(root,r2None,modelsRoot);
  assert.equal(result.rows[0].state,'transfer-required');
  assert.equal(result.validation.valid,false,'remote execution must require R2 placement even when local has the model');
  assert.ok(result.validation.issues.some(issue=>issue.code==='MODEL_R2_PLACEMENT_REQUIRED'));

  fs.unlinkSync(modelFile);
  result=await checkAvailability(root,r2All,modelsRoot);
  assert.equal(result.rows[0].state,'available');
  assert.equal(result.validation.valid,true,'remote execution must not require local placement');

  fs.writeFileSync(modelFile,'model');
  writeMeta('local');
  result=await checkAvailability(root,r2None,null);
  assert.equal(result.rows[0].local,false,'explicit app-level null path must not fall back to legacy project comfyModelsRoot');
  assert.equal(result.validation.valid,false);
  assert.ok(result.validation.issues.some(issue=>issue.code==='COMFYUI_INSTALL_PATH_REQUIRED'));

  const userData=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-app-settings-'));
  const store=new AppSettingsStore(userData);
  let status=await store.status();
  assert.equal(status.configured,false);
  assert.equal(status.r2Bucket,'');
  const invalidComfy=fs.mkdtempSync(path.join(os.tmpdir(),'invalid-comfy-'));
  await assert.rejects(()=>store.save({comfyUiInstallPath:invalidComfy}),/modelsフォルダー/);
  status=await store.save({comfyUiInstallPath:comfyRoot,catalogPath:'/tmp/model_catalog.json',r2Bucket:'models-bucket',r2ModelPrefix:'/models/',r2IndexPath:'/tmp/r2-index.json',templatePath:'/tmp/template.json',manifestPath:'/tmp/manifest.json'});
  assert.equal(status.configured,true);
  assert.equal(status.comfyUiInstallPath,path.resolve(comfyRoot));
  assert.equal(status.modelsPath,path.join(path.resolve(comfyRoot),'models'));
  assert.equal(status.installExists,true);
  assert.equal(status.modelsExists,true);
  assert.equal(status.catalogPath,'/tmp/model_catalog.json');
  assert.equal(status.r2Bucket,'models-bucket');
  assert.equal(status.r2ModelPrefix,'models');
  assert.equal(status.r2IndexPath,'/tmp/r2-index.json');
  assert.equal(status.templatePath,'/tmp/template.json');
  assert.equal(status.manifestPath,'/tmp/manifest.json');
  assert.equal(process.env.BATCH_STUDIO_CATALOG_PATH,'/tmp/model_catalog.json');
  assert.equal(process.env.BATCH_STUDIO_R2_BUCKET,'models-bucket');
  assert.equal(process.env.BATCH_STUDIO_R2_MODEL_PREFIX,'models');
  assert.equal(process.env.BATCH_STUDIO_R2_INDEX_PATH,'/tmp/r2-index.json');
  assert.equal(process.env.BATCH_STUDIO_TEMPLATE_PATH,'/tmp/template.json');
  assert.equal(process.env.BATCH_STUDIO_MANIFEST_PATH,'/tmp/manifest.json');

  status=await store.save({comfyUiInstallPath:'',catalogPath:'',r2Bucket:'remote-only-bucket',r2ModelPrefix:'remote-models',r2IndexPath:'',templatePath:'',manifestPath:''});
  assert.equal(status.configured,false,'remote-only environments must be able to save common settings without a local ComfyUI path');
  assert.equal(status.r2Bucket,'remote-only-bucket');
  assert.equal(process.env.BATCH_STUDIO_R2_BUCKET,'remote-only-bucket');

  console.log('Model placement and shared environment settings tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
