const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'batch-studio-vastai-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,'main',relative)).href);
function response(payload,status=200){return {ok:status>=200&&status<300,status,statusText:status===200?'OK':'ERR',text:async()=>JSON.stringify(payload)};}

(async()=>{
  const {VastAiClient,normalizeVastInstance,normalizeVastStatus}=await load('vastai-client.js');
  assert.equal(normalizeVastStatus({actual_status:'running'}),'running');
  assert.equal(normalizeVastStatus({actual_status:'scheduling'}),'scheduling');
  assert.equal(normalizeVastStatus({actual_status:'exited',intended_status:'stopped',cur_state:'stopped'}),'stopped');
  assert.equal(normalizeVastStatus({actual_status:'loading'}),'starting');
  assert.equal(normalizeVastStatus({actual_status:'offline'}),'offline');

  const mapped=normalizeVastInstance({id:42,actual_status:'running',public_ipaddr:'203.0.113.9',ssh_host:'fallback.vast.ai',ssh_port:10022,ports:{'22/tcp':[{HostIp:'0.0.0.0',HostPort:'40022'}]},gpu_name:'RTX 5090',num_gpus:1,gpu_ram:32768,dph_total:0.75});
  assert.equal(mapped.sshHost,'203.0.113.9');
  assert.equal(mapped.sshPort,40022);
  assert.equal(mapped.gpuName,'RTX 5090');
  assert.equal(mapped.hourlyCost,0.75);

  const calls=[];
  const fakeFetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const u=new URL(String(url));
    if(u.pathname==='/api/v1/instances/'&&u.searchParams.get('after_token')==='next-page')return response({instances:[{id:2,actual_status:'stopped',gpu_name:'RTX 4090'}],next_token:null});
    if(u.pathname==='/api/v1/instances/')return response({instances:[{id:1,actual_status:'running',ssh_host:'ssh.vast.ai',ssh_port:12345,gpu_name:'RTX 5090'}],next_token:'next-page'});
    if(u.pathname==='/api/v0/instances/1/'&&(!init.method||init.method==='GET'))return response({instances:{id:1,actual_status:'running',ssh_host:'ssh.vast.ai',ssh_port:12345}});
    if(u.pathname==='/api/v0/instances/1/'&&init.method==='PUT')return response({success:true});
    return response({msg:'not found'},404);
  };
  const client=new VastAiClient(async()=>'secret-key',fakeFetch,'https://example.test');
  const instances=await client.listInstances();
  assert.deepEqual(instances.map(x=>x.id),[1,2]);
  assert.equal(calls[0].init.headers.Authorization,'Bearer secret-key');
  assert.match(calls[1].url,/after_token=next-page/);

  const one=await client.getInstance(1);
  assert.equal(one.sshHost,'ssh.vast.ai');
  await client.startInstance(1);
  await client.stopInstance(1);
  const puts=calls.filter(x=>x.init.method==='PUT');
  assert.equal(puts.length,2);
  assert.deepEqual(JSON.parse(puts[0].init.body),{state:'running'});
  assert.deepEqual(JSON.parse(puts[1].init.body),{state:'stopped'});
  assert.ok(puts.every(x=>x.init.headers.Authorization==='Bearer secret-key'));

  console.log('Vast.ai client tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1});
