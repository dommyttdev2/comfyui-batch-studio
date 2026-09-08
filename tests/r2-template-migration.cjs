const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-r2-migration-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});

(async()=>{
  const {R2Manager}=await import(pathToFileURL(path.join(runtime,'main','r2-manager.js')).href);
  const oldLocalAppData=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-legacy-localappdata-'));
  const legacyDir=path.join(oldLocalAppData,'R2 File Manager');
  fs.mkdirSync(legacyDir,{recursive:true});
  const legacyPath=path.join(legacyDir,'batch_download_templates.json');
  const legacy={
    'legacy-1':{
      id:'legacy-1',bucket:'models',name:'Legacy Models',
      objects:[{key:'models/loras/legacy.safetensors',size:123,last_modified:'2026-09-05T00:00:00Z',storage_class:'STANDARD'}],
      created_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-05T00:00:00Z'
    },
    'legacy-duplicate-name':{
      id:'legacy-duplicate-name',bucket:'models',name:'Existing',
      objects:[{key:'models/checkpoints/duplicate.safetensors',size:456}],
      created_at:'2026-09-02T00:00:00Z',updated_at:'2026-09-06T00:00:00Z'
    },
    'legacy-invalid':{id:'legacy-invalid',bucket:'',name:'Invalid',objects:[]}
  };
  fs.writeFileSync(legacyPath,JSON.stringify(legacy,null,2)+'\n');
  const originalLegacy=fs.readFileSync(legacyPath,'utf8');

  const userData=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-userdata-'));
  const target=path.join(userData,'r2','batch-download-templates.json');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,JSON.stringify({schemaVersion:1,templates:[{
    id:'current-1',bucket:'models',name:'Existing',createdAt:'2026-09-07T00:00:00Z',updatedAt:'2026-09-07T00:00:00Z',
    objects:[{key:'models/checkpoints/current.safetensors',name:'current.safetensors',size:789}]
  }]},null,2)+'\n');

  const previous=process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA=oldLocalAppData;
  try{
    const manager=new R2Manager({},userData);
    const templates=await manager.templates();
    assert.equal(templates.length,2,'one valid non-duplicate legacy template should be merged');
    const migrated=templates.find(t=>t.id==='legacy-1');
    assert.ok(migrated,'legacy template id should be preserved');
    assert.equal(migrated.name,'Legacy Models');
    assert.equal(migrated.bucket,'models');
    assert.deepEqual(migrated.objects,[{key:'models/loras/legacy.safetensors',name:'legacy.safetensors',size:123}]);
    assert.equal(migrated.createdAt,'2026-09-01T00:00:00Z');
    assert.equal(migrated.updatedAt,'2026-09-05T00:00:00Z');
    assert.equal(templates.filter(t=>t.name==='Existing').length,1,'same bucket/name must not be duplicated');
    assert.equal(fs.readFileSync(legacyPath,'utf8'),originalLegacy,'legacy source must remain untouched');

    const managerAgain=new R2Manager({},userData);
    assert.equal((await managerAgain.templates()).length,2,'migration must be idempotent across restarts');
    const saved=JSON.parse(fs.readFileSync(target,'utf8'));
    assert.equal(saved.schemaVersion,1);
    assert.equal(saved.templates.length,2);
  } finally {
    if(previous===undefined)delete process.env.LOCALAPPDATA;else process.env.LOCALAPPDATA=previous;
  }
  console.log('R2 legacy template migration tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
