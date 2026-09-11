const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..'),runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-local-execution-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,'main',relative)).href);
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n')};
const waitFor=async(fn,timeout=5000)=>{const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,25))}throw new Error('timed out')};

function graphFor(projectId){
  const matrix=(id,leaves)=>({class_type:'SceneMatrix',inputs:{matrix_json:JSON.stringify({version:1,sets:leaves.map(row_id=>({row_id,enabled:true}))}),run_handle:''},_meta:{title:'Prompt'}});
  return {
    '1':matrix(1,['a1','a2']),
    '2':{class_type:'ScenePrompterExpand',inputs:{scene_prompt:['1',0],current_index:0,run_id:'',seed_base:0,prefix:'a',model_mode:'Illustrious'}},
    '3':{class_type:'SceneSaveImage',inputs:{images:['2',0],path:`BatchStudio/${projectId}/branch-a`,metadata_mode:'none'}},
    '4':matrix(4,['b1']),
    '5':{class_type:'ScenePrompterExpand',inputs:{scene_prompt:['4',0],current_index:0,run_id:'',seed_base:0,prefix:'b',model_mode:'Illustrious'}},
    '6':{class_type:'SceneSaveImage',inputs:{images:['5',0],path:`BatchStudio/${projectId}/branch-b`,metadata_mode:'none'}}
  };
}
async function makeProject(execution,hashCanonicalJson,projectId='local-api-project'){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-local-project-')),install=path.join(root,'comfy');
  fs.mkdirSync(path.join(install,'models'),{recursive:true});
  const api=graphFor(projectId),ui={nodes:[],links:[]},uiSha256=hashCanonicalJson(ui),apiSha256=hashCanonicalJson(api),workflowIdentity=hashCanonicalJson({uiSha256,apiSha256});
  writeJson(path.join(root,'LoRA_project.json'),ui);writeJson(path.join(root,'LoRA_project.api.json'),api);
  writeJson(path.join(root,'project_brief.json'),{schemaVersion:1,project:{id:projectId,title:'Local API'},subject:{copyrightedCharacter:false,characterName:'',series:''},audience:'test',request:'test',exclusions:'',assumptions:{adultCharacters:true,consensual:true},generation:{target_image_count:3,modelFamily:'Illustrious'},references:[]});
  writeJson(path.join(root,'prompt_plan.json'),{schemaVersion:1,common:{positive:'',negative:''},rootLoras:[],branches:[{id:'branch-a',label:'A',loras:[],leaves:[{id:'a1',name:'a1',positive:'',negative:''},{id:'a2',name:'a2',positive:'',negative:''}]},{id:'branch-b',label:'B',loras:[],leaves:[{id:'b1',name:'b1',positive:'',negative:''}]}]});
  writeJson(path.join(root,'project_meta.json'),{schemaVersion:1,createdAt:new Date().toISOString(),settings:{executionTarget:'local'},workflowBuild:{outputs:{ui:{path:'LoRA_project.json',sha256:uiSha256},api:{path:'LoRA_project.api.json',sha256:apiSha256}},workflowIdentity}});
  const ready={state:'READY',plannedImages:3,targetImages:3,blocking:[],warnings:[],sections:[]};
  const run=await execution.startExecutionRun(root,async()=>ready);
  return {root,install,run,ready};
}
function startServer(install,options={}){
  const calls={prompts:[],claims:[],prepares:[],finalizes:[],releases:[],interrupts:0},history=new Map(),running=new Set(),claimedHandles=new Map();
  let holdFirst=Boolean(options.holdFirst);
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString('utf8'),body=raw?JSON.parse(raw):{};
    const json=(status,payload)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(payload))};
    if(req.url==='/system_stats')return json(200,{system:{ok:true}});
    if(req.url==='/object_info')return json(200,{SceneMatrix:{},ScenePrompterExpand:{},SceneSaveImage:{}});
    if(req.url==='/scene_prompt/runs/prepare'){
      calls.prepares.push(body);const node=body.api_graph.output[String(body.expand_node_id)],matrix=body.api_graph.output[String(node.inputs.scene_prompt[0])],total=JSON.parse(matrix.inputs.matrix_json).sets.length;
      return json(200,{run_handle:`handle-${body.expand_node_id}-${calls.prepares.length}`,total_batches:total,total_images:total,presets:[],preset_graphs:{}});
    }
    if(req.url==='/prompt'){
      const graph=body.prompt,expand=Object.entries(graph).find(([,n])=>n.class_type==='ScenePrompterExpand'),save=Object.values(graph).find(n=>n.class_type==='SceneSaveImage'),promptId=`prompt-${calls.prompts.length+1}`;
      const record={promptId,expandId:expand[0],index:expand[1].inputs.current_index,path:save.inputs.path,runHandle:expand[1].inputs.run_handle};calls.prompts.push(record);running.add(promptId);history.set(promptId,'pending');
      const target=path.join(install,'output',String(save.inputs.path));fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,`${promptId}.png`),'png');
      if(!(holdFirst&&calls.prompts.length===1)){history.set(promptId,'success');running.delete(promptId)}
      return json(200,{prompt_id:promptId,number:calls.prompts.length,node_errors:{}});
    }
    if(req.url==='/scene_prompt/runs/claim'){calls.claims.push(body);const previous=claimedHandles.get(body.run_handle);if(previous&&previous!==body.prompt_id)return json(200,{claimed:false});claimedHandles.set(body.run_handle,body.prompt_id);return json(200,{claimed:true})}
    if(req.url==='/scene_prompt/runs/finalize'){calls.finalizes.push(body);return json(200,{state:'finalized'})}
    if(req.url==='/scene_prompt/runs/release'){calls.releases.push(body);return json(200,{released:true})}
    if(req.url==='/queue')return json(200,{queue_running:[...running].map((id,i)=>[i,id,{}]),queue_pending:[]});
    if(req.url==='/interrupt'){calls.interrupts++;for(const id of running){history.set(id,'error')}running.clear();return json(200,{})}
    if(req.url?.startsWith('/history/')){const id=decodeURIComponent(req.url.slice('/history/'.length)),state=history.get(id);if(!state)return json(200,{});return json(200,{[id]:{status:{status_str:state,completed:state!=='pending'}}})}
    return json(404,{error:'not found'});
  });
  return new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve({server,calls,history,running,endpoint:`http://127.0.0.1:${server.address().port}`,releaseFirst(){holdFirst=false;const id=calls.prompts[0]?.promptId;if(id){history.set(id,'success');running.delete(id)}}})));
}

(async()=>{
  const execution=await load('execution-run.js'),{hashCanonicalJson}=await load('workflow-api.js'),{LocalExecutionService,enumerateSceneBranches,sliceSceneBranchGraph}=await load('local-execution.js');
  {
    const {root,install,run}=await makeProject(execution,hashCanonicalJson),mock=await startServer(install);
    try{
      const api=JSON.parse(fs.readFileSync(path.join(root,'LoRA_project.api.json'),'utf8'));
      assert.deepEqual(enumerateSceneBranches(api,run).map(x=>[x.branchId,x.expandNodeId]),[['branch-a','2'],['branch-b','5']]);
      assert.equal(Object.values(sliceSceneBranchGraph(api,'2')).filter(n=>n.class_type==='ScenePrompterExpand').length,1);
      const service=new LocalExecutionService(async()=>({endpoint:mock.endpoint,installPath:install}));service.start(root,run.runId);
      const done=await waitFor(async()=>{const current=await execution.getExecutionRun(root,run.runId);return current?.lifecycle==='COMPLETED'?current:null});
      assert.deepEqual(mock.calls.prompts.map(x=>[x.expandId,x.index]),[['2',0],['2',1],['5',0]],'branches and indexes must be FIFO/sequential');
      assert.deepEqual(mock.calls.claims.map(x=>x.prompt_id),['prompt-1','prompt-3'],'each prepared run_handle is claimed only by its first prompt');
      assert.deepEqual(mock.calls.finalizes.map(x=>x.prompt_id),['prompt-2','prompt-3']);
      assert.equal(mock.calls.releases.length,2);assert.equal(done.progress.overall.completed,3);assert.equal(done.promptIds.length,3);
      assert.ok(mock.calls.prompts.every(x=>String(x.runHandle).startsWith('handle-')),'prepared run_handle must be injected before submit');
      assert.equal(done.evidence.some(x=>x.kind==='LOCAL_FILE_VERIFIED'),true);
    }finally{mock.server.close()}
  }
  {
    const {root,install,run,ready}=await makeProject(execution,hashCanonicalJson,'stop-project'),mock=await startServer(install,{holdFirst:true});
    try{
      const service=new LocalExecutionService(async()=>({endpoint:mock.endpoint,installPath:install}));service.start(root,run.runId);
      await waitFor(()=>mock.calls.prompts.length===1);await execution.requestStopScheduling(root,run.runId);mock.releaseFirst();
      const paused=await waitFor(async()=>{const current=await execution.getExecutionRun(root,run.runId);return current?.lifecycle==='PAUSED'?current:null});
      assert.equal(mock.calls.prompts.length,1,'stop scheduling must not submit the next index');assert.equal(paused.progress.overall.completed,1);
      const resumed=await execution.resumeExecutionRun(root,run.runId,async()=>ready);assert.equal(resumed.lifecycle,'RUNNING');service.start(root,run.runId);
      const done=await waitFor(async()=>{const current=await execution.getExecutionRun(root,run.runId);return current?.lifecycle==='COMPLETED'?current:null});
      assert.equal(done.progress.overall.completed,3);assert.deepEqual(mock.calls.prompts.map(x=>x.index),[0,1,0]);
    }finally{mock.server.close()}
  }
  {
    const {root,install,run}=await makeProject(execution,hashCanonicalJson,'interrupt-project'),mock=await startServer(install);
    try{
      const service=new LocalExecutionService(async()=>({endpoint:mock.endpoint,installPath:install}));
      await execution.mutateExecutionRun(root,run.runId,current=>{current.current.promptId='owned-prompt'});
      mock.running.add('other-prompt');assert.equal(await service.forceInterrupt(root,run.runId),false);assert.equal(mock.calls.interrupts,0);
      mock.running.add('owned-prompt');assert.equal(await service.forceInterrupt(root,run.runId),true);assert.equal(mock.calls.interrupts,1,'interrupt is allowed only while this run owns queue_running');
    }finally{mock.server.close()}
  }
  console.log('Local ComfyUI execution tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
