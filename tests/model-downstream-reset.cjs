const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-downstream-reset-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,relative)).href);
const writeJson=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
const write=(p,v='x')=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);};
const exists=p=>fs.existsSync(p);
const catalogMeta=(generation=3)=>({schemaVersion:1,generation,generatedAt:`2026-09-09T0${generation}:00:00Z`});
const file=(id,name)=>({id,name,type:'Model'});
const catalogItem=(modelId,modelName,modelType,versionId,fileId,fileName,trainedWords=[])=>({modelId,modelName,modelType,versionId,versionName:'v1',baseModel:'Illustrious',files:[file(fileId,fileName)],trainedWords,versions:[{versionId,versionName:'v1',baseModel:'Illustrious',files:[file(fileId,fileName)],trainedWords}]});
const selection=(ref,modelId,modelName,versionId,fileId,fileName,trainedWords=[])=>({ref,modelId,modelName,versionId,versionName:'v1',fileId,fileName,modelUrl:`https://civitai.com/models/${modelId}`,trainedWords,reason:'selected'});
const models=(generation=3,loraModelId=2,loraWords=['pose_a'])=>({schemaVersion:4,modelFamily:'illustrious',catalog:catalogMeta(generation),checkpoint:selection('checkpoint.main',1,'Checkpoint',11,111,'checkpoint.safetensors',['style']),loras:[selection(`lora.pose_${loraModelId}`,loraModelId,`LoRA ${loraModelId}`,loraModelId*10+1,loraModelId*100+1,`lora-${loraModelId}.safetensors`,loraWords)]});
const catalog={...catalogMeta(3),collections:[{id:1,name:'Tests',items:[catalogItem(1,'Checkpoint','Checkpoint',11,111,'checkpoint.safetensors',['style']),catalogItem(2,'LoRA 2','LORA',21,201,'lora-2.safetensors',['pose_a']),catalogItem(3,'LoRA 3','LORA',31,301,'lora-3.safetensors',['pose_b'])]}]};
function downstream(root){
 write(path.join(root,'prompt_plan.json'),'{}\n');
 write(path.join(root,'._batch_studio','drafts','prompt_plan.json'),'{}\n');
 write(path.join(root,'._batch_studio','grok-responses','prompt-plan','one.txt'),'prompt');
 write(path.join(root,'._batch_studio','grok-responses','prompt-plan-fix','one.txt'),'prompt-fix');
 write(path.join(root,'._batch_studio','grok-responses','models-fix','one.txt'),'models-fix');
 write(path.join(root,'._batch_studio','grok-responses','models','old.txt'),'models');
 write(path.join(root,'LoRA_project.json'),'workflow');
 writeJson(path.join(root,'project_meta.json'),{schemaVersion:1,createdAt:'2026-09-09T00:00:00Z',settings:{executionTarget:'local'},workflowBuild:{outputPath:'LoRA_project.json',generatedAt:'2026-09-09T01:00:00Z'}});
}
(async()=>{
 const [{modelGenerationInputsChanged,resetModelDownstream},{importGrok,confirmArtifact,saveDraft}]=await Promise.all([load('main/model-downstream-reset.js'),load('main/artifact-service.js')]);
 const a=models(2,2),catalogOnly={...a,catalog:catalogMeta(3),checkpoint:{...a.checkpoint,reason:'different explanation',modelName:'renamed for display'},loras:a.loras.map(x=>({...x,reason:'new reason',modelName:'display rename'}))};
 assert.equal(modelGenerationInputsChanged(a,[],catalogOnly,[]),false,'catalog provenance and descriptive metadata must not reset downstream');
 assert.equal(modelGenerationInputsChanged(a,[],models(2,2,['pose_changed']),[]),true,'trainedWords affect prompt generation');
 assert.equal(modelGenerationInputsChanged(a,[{requirement:'pose',positive:'tag_a',negative:'',reason:'old'}],a,[{requirement:'pose',positive:'tag_b',negative:'',reason:'new'}]),true,'prompt fallback content affects prompt generation');
 assert.equal(modelGenerationInputsChanged(a,[{requirement:'pose',positive:'tag_a',negative:'',reason:'old'}],a,[{requirement:'pose',positive:'tag_a',negative:'',reason:'new reason only'}]),false,'fallback reason alone must not reset downstream');

 const directRoot=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-reset-direct-'));downstream(directRoot);
 await resetModelDownstream(directRoot,{clearModelFixHistory:false});
 assert.equal(exists(path.join(directRoot,'prompt_plan.json')),false);assert.equal(exists(path.join(directRoot,'._batch_studio','drafts','prompt_plan.json')),false);
 assert.equal(exists(path.join(directRoot,'._batch_studio','grok-responses','prompt-plan')),false);assert.equal(exists(path.join(directRoot,'._batch_studio','grok-responses','prompt-plan-fix')),false);
 assert.equal(exists(path.join(directRoot,'._batch_studio','grok-responses','models-fix')),true,'reselection confirmation keeps its own history');
 assert.equal(exists(path.join(directRoot,'LoRA_project.json')),false);const directMeta=JSON.parse(fs.readFileSync(path.join(directRoot,'project_meta.json'),'utf8'));assert.equal(directMeta.workflowBuild,undefined);assert.equal(directMeta.settings.executionTarget,'local');
 const archives=fs.readdirSync(path.join(directRoot,'._batch_studio','history','downstream-reset'));assert.equal(archives.length,1);assert.equal(exists(path.join(directRoot,'._batch_studio','history','downstream-reset',archives[0],'prompt_plan.json')),true,'reset data must be recoverable from hidden history');

 const catalogPath=path.join(os.tmpdir(),`batch-studio-catalog-${process.pid}-${Date.now()}.json`);writeJson(catalogPath,catalog);process.env.BATCH_STUDIO_CATALOG_PATH=catalogPath;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-reset-confirm-'));writeJson(path.join(root,'models.json'),models(3,2));downstream(root);writeJson(path.join(root,'models.json'),models(3,2));
 const lora3=selection('lora.pose_3',3,'LoRA 3',31,301,'lora-3.safetensors',['pose_b']);
 const imported=await importGrok(root,'models',JSON.stringify({schemaVersion:1,loras:[lora3],promptFallbacks:[{requirement:'camera angle',positive:'from_below',negative:'',reason:'prompt is sufficient'}]}),'models');
 assert.equal(imported.validation.valid,true);const result=await confirmArtifact(root,'models');assert.equal(result.downstreamReset,true,'reconfirming selection 1 with effective changes must reset downstream');
 assert.equal(exists(path.join(root,'prompt_plan.json')),false);assert.equal(exists(path.join(root,'._batch_studio','grok-responses','models-fix')),false,'selection 1 reconfirmation clears old reselection history');
 assert.equal(exists(path.join(root,'._batch_studio','grok-responses','models')),true,'selection 1 history must remain');assert.equal(exists(path.join(root,'LoRA_project.json')),false);
 const confirmed=JSON.parse(fs.readFileSync(path.join(root,'models.json'),'utf8'));assert.equal(confirmed.loras[0].modelId,3);const fallback=JSON.parse(fs.readFileSync(path.join(root,'._batch_studio','model_prompt_fallbacks.json'),'utf8'));assert.equal(fallback.promptFallbacks[0].positive,'from_below','new fallback must survive downstream reset');

 const provenanceRoot=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-reset-provenance-'));writeJson(path.join(provenanceRoot,'models.json'),models(2,2));downstream(provenanceRoot);writeJson(path.join(provenanceRoot,'models.json'),models(2,2));await saveDraft(provenanceRoot,'models',JSON.stringify(models(2,2),null,2));
 const provenanceResult=await confirmArtifact(provenanceRoot,'models');assert.equal(provenanceResult.downstreamReset,false,'catalog generation refresh alone must not reset downstream');
 assert.equal(exists(path.join(provenanceRoot,'prompt_plan.json')),true);assert.equal(exists(path.join(provenanceRoot,'LoRA_project.json')),true);const provenanceConfirmed=JSON.parse(fs.readFileSync(path.join(provenanceRoot,'models.json'),'utf8'));assert.equal(provenanceConfirmed.catalog.generation,3,'PR #28 provenance refresh must still be preserved');
 console.log('Model downstream reset tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
