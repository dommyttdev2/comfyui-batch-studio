const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-lora-mode-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,'main',relative)).href);
const writeJson=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n')};

(async()=>{
  const {compileWorkflow}=await load('compiler.js');
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-lora-mode-parent-'));
  const root=path.join(parent,'project');
  fs.mkdirSync(root,{recursive:true});

  writeJson(path.join(root,'project_brief.json'),{
    schemaVersion:1,
    project:{id:'lora-mode-test',title:'LoRA mode test'}
  });
  writeJson(path.join(root,'project_meta.json'),{
    schemaVersion:1,
    createdAt:new Date().toISOString(),
    settings:{
      templatePath:path.join(repo,'templates/default-scene-batch/template.json'),
      manifestPath:path.join(repo,'templates/default-scene-batch/manifest.json')
    }
  });
  writeJson(path.join(root,'models.json'),{
    schemaVersion:1,
    catalog:{schemaVersion:1,generation:1,generatedAt:'2026-09-09T00:00:00Z'},
    checkpoint:{ref:'checkpoint.main',modelId:1,modelName:'Checkpoint',versionId:2,versionName:'v1',fileId:3,fileName:'checkpoint.safetensors',modelUrl:'https://example.com/models/1',trainedWords:[],reason:'test'},
    loras:[{ref:'lora.character',modelId:10,modelName:'Character',versionId:20,versionName:'v1',fileId:30,fileName:'character.safetensors',modelUrl:'https://example.com/models/10',trainedWords:['character'],reason:'test'}]
  });
  writeJson(path.join(root,'prompt_plan.json'),{
    schemaVersion:1,
    common:{positive:'quality',negative:'bad'},
    rootLoras:[],
    branches:[
      {id:'with-lora',label:'With LoRA',loras:[{modelRef:'lora.character',strengthModel:0.7,strengthClip:0.7}],leaves:[{id:'leaf-one',name:'日本語の表示名',positive:'p1',negative:'n1'}]},
      {id:'without-lora',label:'Without LoRA',loras:[],leaves:[{id:'leaf-two',name:'別の日本語名',positive:'p2',negative:'n2'}]}
    ]
  });

  const result=await compileWorkflow(root);
  assert.equal(result.validation.valid,true);
  const workflow=JSON.parse(fs.readFileSync(result.outputPath,'utf8'));
  const withLora=workflow.nodes.find(n=>n.type==='AnimaLoraStack'&&String(n.title).startsWith('LoRA - with-lora -'));
  const withoutLora=workflow.nodes.find(n=>n.type==='AnimaLoraStack'&&String(n.title).startsWith('LoRA - without-lora -'));
  assert.ok(withLora,'LoRA branch stack must exist');
  assert.ok(withoutLora,'non-LoRA branch stack must exist');
  assert.equal(withLora.mode,0,'branch with LoRA must be enabled');
  assert.equal(withoutLora.mode,4,'branch without LoRA must be bypassed');
  assert.equal(JSON.parse(withLora.widgets_values[0]).loras.length,1);
  assert.equal(JSON.parse(withoutLora.widgets_values[0]).loras.length,0);

  const withLoraMatrix=workflow.nodes.find(n=>n.type==='SceneMatrix'&&String(n.title).startsWith('Prompt - with-lora -'));
  const withoutLoraMatrix=workflow.nodes.find(n=>n.type==='SceneMatrix'&&String(n.title).startsWith('Prompt - without-lora -'));
  assert.ok(withLoraMatrix,'with-LoRA SceneMatrix must exist');
  assert.ok(withoutLoraMatrix,'without-LoRA SceneMatrix must exist');
  const withLoraRow=JSON.parse(withLoraMatrix.widgets_values[0]).sets[0];
  const withoutLoraRow=JSON.parse(withoutLoraMatrix.widgets_values[0]).sets[0];
  assert.equal(withLoraRow.row_id,'leaf-one');
  assert.equal(withLoraRow.name,'leaf-one','SceneMatrix row name must use prompt id, not prompt_plan name');
  assert.equal(withLoraRow.path_label,'leaf-one');
  assert.equal(withoutLoraRow.row_id,'leaf-two');
  assert.equal(withoutLoraRow.name,'leaf-two','SceneMatrix row name must use prompt id, not prompt_plan name');
  assert.equal(withoutLoraRow.path_label,'leaf-two');
  console.log('Compiler LoRA mode tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
