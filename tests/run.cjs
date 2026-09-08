const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const tsImport=require('typescript');
const ts=tsImport.default??tsImport;
const MODULE_COMMONJS=ts.ModuleKind?.CommonJS??1;
const TARGET_ES2022=ts.ScriptTarget?.ES2022??9;

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-tests-runtime-'));
for(const sub of ['main','shared']){
  const input=path.join(repo,'src',sub),output=path.join(runtime,sub);fs.mkdirSync(output,{recursive:true});
  for(const name of fs.readdirSync(input).filter(n=>n.endsWith('.ts'))){
    const source=fs.readFileSync(path.join(input,name),'utf8');
    const result=ts.transpileModule(source,{compilerOptions:{module:MODULE_COMMONJS,target:TARGET_ES2022,esModuleInterop:true}});
    fs.writeFileSync(path.join(output,name.replace(/\.ts$/,'.js')),result.outputText);
  }
}
const validation=require(path.join(runtime,'main','validation.js'));
const artifacts=require(path.join(runtime,'main','artifact-service.js'));
const compiler=require(path.join(runtime,'main','compiler.js'));
const scan=require(path.join(runtime,'main','project-scan.js'));
const grok=require(path.join(runtime,'main','grok-context.js'));
const availability=require(path.join(runtime,'main','availability.js'));
const preflight=require(path.join(runtime,'main','preflight.js'));

const writeJson=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')};
const sha=s=>crypto.createHash('sha256').update(Buffer.from(s,'utf8')).digest('hex');
function models(){return {schemaVersion:1,catalog:{schemaVersion:1,generation:1,generatedAt:'2026-09-08T00:00:00Z'},checkpoint:{ref:'checkpoint.main',modelId:1,modelName:'Checkpoint',versionId:2,versionName:'v1',fileId:3,fileName:'checkpoint.safetensors',modelUrl:'https://example.com/models/1',trainedWords:[],reason:'test'},loras:[{ref:'lora.character',modelId:10,modelName:'Character',versionId:20,versionName:'v1',fileId:30,fileName:'character.safetensors',modelUrl:'https://example.com/models/10',trainedWords:['character'],reason:'test',strengthBaseline:{value:0.7,provenance:{source:'civitai',basis:'observed-usage-derived',method:'median-of-post-medians:newest-200',sampleCount:5}}}]};}
function plan(){return {schemaVersion:1,common:{positive:'quality',negative:'bad'},rootLoras:[{modelRef:'lora.character',strengthModel:0.7,strengthClip:0.7}],branches:[{id:'b01',label:'One',loras:[],leaves:[{id:'l01',name:'one',positive:'p1',negative:'n1'},{id:'l02',name:'two',positive:'p2',negative:'n2'}]},{id:'b02',label:'Two',loras:[],leaves:[{id:'l03',name:'three',positive:'p3',negative:'n3'}]}]};}

(async()=>{
  const brief={project:{id:'sample-project',title:'Sample'},subject:{copyrightedCharacter:false,characterName:'',series:''},audience:'visual focus',request:'',exclusions:'',assumptions:{adultCharacters:true,consensual:true},generation:{target_image_count:3,modelFamily:'Illustrious'},references:[]};
  assert.equal(validation.validateProjectBrief(brief).valid,true,'valid project brief must pass');
  assert.equal(validation.validateProjectBrief({...brief,audience:''}).valid,false,'audience is required');
  assert.equal(validation.validateProjectBrief({...brief,subject:{...brief.subject,copyrightedCharacter:true,characterName:''}}).valid,false,'copyrighted character name is required');
  assert.equal(validation.validateProjectBrief({...brief,assumptions:{adultCharacters:false,consensual:false}}).valid,false,'adult/consent confirmation is required');

  const manifest=JSON.parse(fs.readFileSync(path.join(repo,'templates/default-scene-batch/manifest.json'),'utf8'));
  const templateRaw=fs.readFileSync(path.join(repo,'templates/default-scene-batch/template.json'),'utf8');
  assert.equal(validation.validateWorkflowManifest(manifest).valid,true,'built-in manifest must be valid');
  assert.equal(manifest.template.sha256,sha(templateRaw),'template SHA must match manifest');
  const badManifest=structuredClone(manifest);badManifest.unknown=true;assert.equal(validation.validateWorkflowManifest(badManifest).valid,false,'unknown manifest fields must fail');
  const p=plan();p.branches[0].leaves[0].unknown=true;assert.equal(validation.validatePromptPlan(p,models()).valid,false,'unknown Prompt Plan fields must fail');

  const root=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-project-'));
  fs.mkdirSync(path.join(root,'._batch_studio','drafts'),{recursive:true});fs.mkdirSync(path.join(root,'._batch_studio','history'),{recursive:true});
  writeJson(path.join(root,'project_brief.json'),{schemaVersion:1,project:{id:'test',title:'Test'},subject:{copyrightedCharacter:true,characterName:'Character',series:'Series'},audience:'test',request:'test',exclusions:'',assumptions:{adultCharacters:true,consensual:true},generation:{target_image_count:3,modelFamily:'Illustrious'},references:[]});
  const catalogPath=path.join(root,'model_catalog.json');writeJson(catalogPath,{schemaVersion:1,generation:1,generatedAt:'2026-09-08T00:00:00Z',collections:[{id:1,name:'test',items:[{modelId:1,modelName:'Checkpoint',versionId:2,versionName:'v1',files:[{id:3,name:'checkpoint.safetensors'}],versions:[{versionId:2,versionName:'v1',files:[{id:3,name:'checkpoint.safetensors'}]}]},{modelId:10,modelName:'Character',versionId:20,versionName:'v1',files:[{id:30,name:'character.safetensors'}],versions:[{versionId:20,versionName:'v1',files:[{id:30,name:'character.safetensors'}]}]}]}]});
  writeJson(path.join(root,'project_meta.json'),{schemaVersion:1,createdAt:new Date().toISOString(),settings:{catalogPath,templatePath:path.join(repo,'templates/default-scene-batch/template.json'),manifestPath:path.join(repo,'templates/default-scene-batch/manifest.json')}});
  fs.writeFileSync(path.join(root,'story.md'),'story\n');writeJson(path.join(root,'models.json'),models());writeJson(path.join(root,'prompt_plan.json'),plan());
  const modelTask=await grok.buildGrokTask(root,'models');assert.match(modelTask.prompt,/missingRequirements/);assert.match(modelTask.prompt,/model_catalog\.json/);
  const planTask=await grok.buildGrokTask(root,'prompt-plan');assert.match(planTask.prompt,/1 Leaf = 1 image/);assert.match(planTask.prompt,/3 枚/);
  const old=Date.now()-10000;for(const [idx,name] of ['project_brief.json','story.md','models.json','prompt_plan.json'].entries())fs.utimesSync(path.join(root,name),new Date(old+idx*1000),new Date(old+idx*1000));

  const modelRoot=path.join(root,'local-models');fs.mkdirSync(modelRoot,{recursive:true});fs.writeFileSync(path.join(modelRoot,'checkpoint.safetensors'),'');fs.writeFileSync(path.join(modelRoot,'character.safetensors'),'');let currentMeta=JSON.parse(fs.readFileSync(path.join(root,'project_meta.json'),'utf8'));currentMeta.settings.comfyModelsRoot=modelRoot;writeJson(path.join(root,'project_meta.json'),currentMeta);
  const result=await compiler.compileWorkflow(root);assert.equal(result.branchCount,2);assert.equal(result.imageCount,3);assert.equal(result.validation.valid,true);assert.equal(fs.existsSync(path.join(root,'LoRA_test.json')),true);
  const compiled=JSON.parse(fs.readFileSync(path.join(root,'LoRA_test.json'),'utf8'));const nodeIds=compiled.nodes.map(n=>n.id),linkIds=compiled.links.map(l=>l[0]),groupIds=(compiled.groups??[]).map(g=>g.id);assert.equal(new Set(nodeIds).size,nodeIds.length,'compiled node ids must be unique');assert.equal(new Set(linkIds).size,linkIds.length,'compiled link ids must be unique');assert.equal(new Set(groupIds).size,groupIds.length,'compiled group ids must be unique');assert.equal(compiled.last_node_id,Math.max(...nodeIds));assert.equal(compiled.last_link_id,Math.max(...linkIds));const counters=compiled.nodes.filter(n=>n.type==='ScenePromptCounter');assert.equal(counters.length,2);assert.ok(counters.every(n=>n.widgets_values?.[0]===1),'all branch counters must equal 1');
  let summary=await scan.scanProject(root);assert.equal(summary.artifacts.find(a=>a.key==='workflow').state,'generated');
  let pf=await preflight.runPreflight(root);assert.equal(pf.state,'READY','all local model files should be READY');
  fs.unlinkSync(path.join(modelRoot,'character.safetensors'));const r2Index=path.join(root,'r2-index.json');writeJson(r2Index,['models/character.safetensors']);currentMeta=JSON.parse(fs.readFileSync(path.join(root,'project_meta.json'),'utf8'));currentMeta.settings.r2IndexPath=r2Index;writeJson(path.join(root,'project_meta.json'),currentMeta);const av=await availability.checkAvailability(root);assert.equal(av.rows.find(r=>r.ref==='lora.character').state,'transfer-required');assert.equal(av.validation.valid,false,'transfer-required model must block readiness');pf=await preflight.runPreflight(root);assert.equal(pf.state,'BLOCKED','R2-only model must block Preflight');fs.writeFileSync(path.join(modelRoot,'character.safetensors'),'');

  const altered=path.join(root,'altered-template.json');const template=JSON.parse(templateRaw);template.extra={changed:true};writeJson(altered,template);const meta=JSON.parse(fs.readFileSync(path.join(root,'project_meta.json'),'utf8'));meta.settings.templatePath=altered;writeJson(path.join(root,'project_meta.json'),meta);summary=await scan.scanProject(root);assert.equal(summary.artifacts.find(a=>a.key==='workflow').state,'stale');

  const draftRoot=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-drafts-'));fs.mkdirSync(path.join(draftRoot,'._batch_studio','drafts'),{recursive:true});fs.mkdirSync(path.join(draftRoot,'._batch_studio','history'),{recursive:true});
  fs.writeFileSync(path.join(draftRoot,'._batch_studio','drafts','story.md'),'new story\n');await artifacts.confirmArtifact(draftRoot,'story');assert.equal(fs.existsSync(path.join(draftRoot,'._batch_studio','drafts','story.md')),false,'confirmed draft must be cleared');
  const unresolved={...models(),missingRequirements:[{role:'pose',requirement:'pose LoRA',reason:'not found'}]};await artifacts.saveDraft(draftRoot,'models',JSON.stringify(unresolved));await assert.rejects(()=>artifacts.confirmArtifact(draftRoot,'models'),/検証エラー/);
  const emptyMissing={...models(),missingRequirements:[]};const emptyDraft=await artifacts.saveDraft(draftRoot,'models',JSON.stringify(emptyMissing));assert.equal(emptyDraft.validation.valid,false,'draft-only missingRequirements must not enter confirmed schema');await assert.rejects(()=>artifacts.confirmArtifact(draftRoot,'models'),/検証エラー/);
  assert.equal(validation.validateModels(emptyMissing).valid,false,'formal models validator must reject missingRequirements');

  console.log('All Batch Studio tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
