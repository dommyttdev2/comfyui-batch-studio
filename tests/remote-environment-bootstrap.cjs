const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {pathToFileURL}=require('node:url');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-remote-bootstrap-'));
const compiled=path.join(runtime,'compiled');
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',compiled],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(compiled,'main',relative)).href);
const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n')};

(async()=>{
 try{
  const [{RemoteEnvironmentBootstrap},worker]=await Promise.all([load('remote-environment-bootstrap.js'),load('remote-worker-source.js')]);
  const project=path.join(runtime,'project');fs.mkdirSync(project,{recursive:true});
  const runId='00000000-0000-4000-8000-000000000051';
  writeJson(path.join(project,'execution_runs',runId+'.json'),{
   schemaVersion:1,runId,projectId:'p51',executionTarget:'remote',remote:{provider:'vastai',instanceId:51},lifecycle:'RUNNING',phase:'REMOTE_ENVIRONMENT_CHECKING',
   controls:{scheduling:'ACTIVE',interrupt:'IDLE',stopSchedulingRequestedAt:null,forceInterruptRequestedAt:null},
   current:{branchId:null,leafId:null,promptId:null},progress:{overall:{completed:0,total:1},branches:[],models:[]},promptIds:[],evidence:[],error:null,errorHistory:[],
   snapshot:{projectId:'p51',target:'remote',remote:{provider:'vastai',instanceId:51},preflight:{state:'READY',plannedImages:1,targetImages:1,blocking:[],warnings:[],sections:[]},workflow:{uiPath:'x',apiPath:'y',uiSha256:'u',apiSha256:'a',workflowIdentity:'w'},plan:{sha256:'p',branches:[]},runIdentity:'run-identity-51'},
   resume:{attempts:0,lastAttemptAt:null,lastValidatedEvidenceIds:[],lastIgnoredEvidenceIds:[],lastDecisionPhase:null},startedAt:new Date().toISOString(),updatedAt:new Date().toISOString(),completedAt:null
  });
  const token='github_pat_SUPER_SECRET_TEST_TOKEN';
  const nodes=[{repository:'toshiki-takedomi/comfyui-batch-orchestrator'},{repository:'norqis/ComfyUI-Scene-Prompt-Tools',ref:'main'}];
  const calls=[];
  const remote={requestWorker:async(_root,_run,op,payload={})=>{calls.push({op,payload});return {response:{ok:true,op},events:[]}}};
  const bootstrap=new RemoteEnvironmentBootstrap(remote);
  await bootstrap.prepare(project,runId,{githubToken:token,customNodes:nodes});
  assert.deepEqual(calls.map(x=>x.op),['ensure_tools','github_auth','update_comfyui','sync_custom_nodes','restart_comfyui']);
  assert.equal(calls[1].payload.githubToken,token);
  assert.equal(calls[2].payload.githubToken,token);
  assert.deepEqual(calls[3].payload.nodes,nodes);
  const persisted=fs.readFileSync(path.join(project,'execution_runs',runId+'.json'),'utf8');
  assert.doesNotMatch(persisted,/SUPER_SECRET_TEST_TOKEN|githubToken/,'GitHub PAT must never be persisted in Execution Run state');
  assert.equal(JSON.parse(persisted).phase,'REMOTE_ENVIRONMENT_READY');
  await assert.rejects(()=>bootstrap.prepare(project,runId,{githubToken:'',customNodes:[]}),/REMOTE_GITHUB_PAT_REQUIRED/);

  assert.match(worker.REMOTE_WORKER_FILE,/aria2c/,'worker must use aria2c for model staging');
  assert.match(worker.REMOTE_WORKER_FILE,/repos\/comfyanonymous\/ComfyUI\/releases\/latest/,'worker must resolve the latest official ComfyUI release');
  assert.match(worker.REMOTE_WORKER_FILE,/https:\/\/github\.com\/comfyanonymous\/ComfyUI\.git/,'worker must fetch the release tag from the official ComfyUI repository');
  assert.match(worker.REMOTE_WORKER_FILE,/GIT_CONFIG_VALUE_0/,'private git fetch authentication must stay ephemeral in process environment');
  assert.match(worker.REMOTE_WORKER_FILE,/gh","auth","status/,'worker must verify non-interactive GitHub auth');
  assert.doesNotMatch(worker.REMOTE_WORKER_FILE,/gh","auth","login/,'worker must not start interactive gh auth login');
  assert.match(worker.REMOTE_WORKER_FILE,/gh","repo","clone/,'worker must clone configured custom nodes with gh');
  assert.equal(worker.REMOTE_WORKER_VERSION,'4','worker version must advance when bootstrap install behavior changes');
  assert.match(worker.REMOTE_WORKER_FILE,/RECORD file not found/,'worker must detect Debian packages without pip RECORD metadata');
  assert.match(worker.REMOTE_WORKER_FILE,/installed by debian/,'worker must scope the retry to Debian-managed package conflicts');
  assert.match(worker.REMOTE_WORKER_FILE,/--ignore-installed/,'worker must retry only the affected requirements install without uninstalling Debian package metadata');
  assert.match(worker.REMOTE_WORKER_FILE,/is_system_python/,'Debian RECORD fallback must be restricted to system Python');
  assert.match(worker.REMOTE_WORKER_FILE,/PIP_REQUIREMENTS_DEBIAN_RETRY_FAILED/,'retry failures must remain explicit and diagnosable');
  console.log('Remote environment bootstrap tests passed.');
 }finally{fs.rmSync(runtime,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1});
