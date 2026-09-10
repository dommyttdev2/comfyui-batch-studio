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
  process.env.CIVIT_API_KEY='test-key';
  process.env.CIVITAI_BASE_URL='https://civitai.test';
  process.env.CIVITAI_MATURE_BASE_URL='https://civitai.test';
  process.env.CIVITAI_MODEL_CACHE_TTL_SECONDS='3600';
  process.env.CIVITAI_VERSION_CACHE_TTL_SECONDS='3600';
  process.env.CIVITAI_BASELINE_CACHE_TTL_SECONDS='3600';
  process.env.CIVITAI_THUMBNAIL_CACHE_TTL_SECONDS='3600';
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

  const before={schemaVersion:1,generation:1,generatedAt:'x',collections:[{id:1,name:'A',items:[{modelId:1,versionId:11},{modelId:2,versionId:21}]}]};
  const after={schemaVersion:1,generation:2,generatedAt:'y',collections:[{id:1,name:'A',items:[{modelId:1,versionId:12},{modelId:3,versionId:31}]}]};
  assert.deepEqual(mod.calculateMembershipChanges(before,after),{added:1,updated:1,removed:1},'membership diff must distinguish add/update/remove');

  const storage=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-civitai-sync-'));
  let currentModels=[1,2];
  let calls=[];
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  const version=(id,name)=>({id,name,baseModel:'Illustrious',trainedWords:[name.toLowerCase()],files:[{id:id*10,name:`${name}.safetensors`,primary:true}],images:[]});
  const modelPayloads={
    1:{id:1,name:'One',type:'LORA',modelVersions:[version(11,'One v1'),version(12,'One v2'),version(13,'One v3')]},
    2:{id:2,name:'Two',type:'Checkpoint',modelVersions:[version(21,'Two v1')]},
  };
  const collectionItem=id=>({type:'model',data:{id,name:id===1?'One':'Two',version:id===1?version(11,'One v1'):version(21,'Two v1')}});
  const baselineImages=[1,2,3,4,5].map(postId=>({postId,meta:{civitaiResources:[{type:'lora',modelVersionId:11,weight:.7}]}}));
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(typeof input==='string'?input:input instanceof URL?String(input):input.url);
    calls.push(`${url.pathname}${url.search}`);
    if(url.pathname==='/api/trpc/collection.getAllUser')return json({result:{data:{json:[{id:100,name:'Models',description:'',read:'Private',type:'Model'}]}}});
    if(url.pathname==='/api/trpc/collection.getAllCollectionItems')return json({result:{data:{json:{collectionItems:currentModels.map(collectionItem),nextCursor:null}}}});
    const modelMatch=url.pathname.match(/^\/api\/v1\/models\/(\d+)$/);
    if(modelMatch)return json(modelPayloads[Number(modelMatch[1])]);
    if(url.pathname==='/api/v1/images'&&url.searchParams.get('modelVersionId')==='11')return json({items:baselineImages});
    throw new Error(`Unexpected Civitai test request: ${url}`);
  };

  try{
    const first=new mod.CivitaiCatalogService(storage);
    await first.initialize();
    await first.startSync();
    await first.waitForSync();
    const firstStatus=first.status();
    assert.equal(firstStatus.state,'ready');
    assert.equal(firstStatus.changes.added,2);
    assert.equal(first.catalog().collections[0].items.length,2);
    assert.equal(fs.existsSync(first.cachePath),true,'metadata cache must be persisted');
    const firstImageCalls=calls.filter(x=>x.startsWith('/api/v1/images?'));
    assert.equal(firstImageCalls.length,1,'baseline lookup must only query the collection-selected LoRA version');
    assert.match(firstImageCalls[0],/modelVersionId=11/);
    assert.equal(calls.filter(x=>x.startsWith('/api/v1/models/')).length,2);

    currentModels=[1];
    calls=[];
    const second=new mod.CivitaiCatalogService(storage);
    await second.initialize();
    await second.startSync();
    await second.waitForSync();
    const secondStatus=second.status();
    const secondCatalog=second.catalog();
    assert.equal(secondStatus.state,'ready');
    assert.equal(secondStatus.changes.added,0);
    assert.equal(secondStatus.changes.updated,0);
    assert.equal(secondStatus.changes.removed,1,'removing a model from the Civitai collection must remove it from the catalog');
    assert.deepEqual(secondCatalog.collections[0].items.map(x=>x.modelId),[1]);
    assert.equal(calls.filter(x=>x.startsWith('/api/trpc/collection.getAllUser')).length,1,'collection list must be fetched every sync');
    assert.equal(calls.filter(x=>x.startsWith('/api/trpc/collection.getAllCollectionItems')).length,1,'collection membership must be fully fetched every sync');
    assert.equal(calls.filter(x=>x.startsWith('/api/v1/models/')).length,0,'fresh model metadata must be reused from cache');
    assert.equal(calls.filter(x=>x.startsWith('/api/v1/images?')).length,0,'fresh baseline metadata must be reused from cache');
    assert.ok(secondStatus.metrics.cacheHits>=3,'model, baseline and thumbnail cache hits should be observable');
    assert.equal(secondStatus.metrics.membershipItems,1);
    assert.equal(secondStatus.metrics.collectionPages,1);
  } finally {
    globalThis.fetch=originalFetch;
  }

  console.log('Integrated Civitai catalog tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
