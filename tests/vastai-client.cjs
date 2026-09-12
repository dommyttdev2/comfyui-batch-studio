const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFileSync}=require('node:child_process');
const {utils}=require('ssh2');

const repo=path.resolve(__dirname,'..');
const runtime=fs.mkdtempSync(path.join(repo,'.tmp-vastai-runtime-'));
const tscBin=path.join(repo,'node_modules','typescript','bin','tsc');
execFileSync(process.execPath,[tscBin,'-p',path.join(repo,'tsconfig.electron.json'),'--outDir',runtime],{cwd:repo,stdio:'inherit'});
const load=relative=>import(pathToFileURL(path.join(runtime,'main',relative)).href);
function response(payload,status=200){return {ok:status>=200&&status<300,status,statusText:status===200?'OK':'ERR',text:async()=>JSON.stringify(payload)};}

(async()=>{
  const {VastAiClient,VastAiInstanceNotFoundError,normalizeVastInstance,normalizeVastStatus,resolveVastComfyUiPort}=await load('vastai-client.js');
  const {normalizeOpenSshPublicKey,validateSshKeyPair}=await load('ssh-key-pair.js');
  assert.equal(normalizeVastStatus({actual_status:'running'}),'running');
  assert.equal(normalizeVastStatus({actual_status:'scheduling'}),'scheduling');
  assert.equal(normalizeVastStatus({actual_status:'exited',intended_status:'stopped',cur_state:'stopped'}),'stopped');
  assert.equal(normalizeVastStatus({actual_status:'loading'}),'starting');
  assert.equal(normalizeVastStatus({actual_status:'offline'}),'offline');

  const mapped=normalizeVastInstance({id:42,actual_status:'running',public_ipaddr:'203.0.113.9',ssh_host:'fallback.vast.ai',ssh_port:10022,ports:{'22/tcp':[{HostIp:'0.0.0.0',HostPort:'40022'}],'18188/tcp':[{HostIp:'0.0.0.0',HostPort:'48188'}]},gpu_name:'RTX 5090',num_gpus:1,gpu_ram:32768,dph_total:0.75});
  assert.equal(mapped.sshHost,'203.0.113.9');
  assert.equal(mapped.sshPort,40022);
  assert.equal(mapped.comfyUiPort,18188);
  assert.equal(resolveVastComfyUiPort({ports:{'8188/tcp':[{HostIp:'0.0.0.0',HostPort:'38188'}]}}),8188);
  assert.equal(resolveVastComfyUiPort({ports:{'22/tcp':[{HostIp:'0.0.0.0',HostPort:'40022'}]}}),null);
  const secondMapped=normalizeVastInstance({id:43,actual_status:'running',public_ipaddr:'203.0.113.10',ports:{'22/tcp':[{HostIp:'0.0.0.0',HostPort:'40123'}],'8188/tcp':[{HostIp:'0.0.0.0',HostPort:'48189'}]}});
  assert.equal(secondMapped.sshPort,40123,'SSH HostPortはInstanceごとの22/tcp mappingを使う');
  assert.equal(secondMapped.comfyUiPort,8188);
  const proxyFallback=normalizeVastInstance({id:44,actual_status:'running',ssh_host:'ssh44.vast.ai',ssh_port:10444});
  assert.equal(proxyFallback.sshHost,'ssh44.vast.ai');
  assert.equal(proxyFallback.sshPort,10444);
  assert.equal(mapped.gpuName,'RTX 5090');
  assert.equal(mapped.hourlyCost,0.75);

  const pair=utils.generateKeyPairSync('ed25519');
  const otherPair=utils.generateKeyPairSync('ed25519');
  const privatePath=path.join(runtime,'id_test'),publicPath=privatePath+'.pub',mismatchPath=path.join(runtime,'other.pub');
  fs.writeFileSync(privatePath,pair.private);fs.writeFileSync(publicPath,pair.public+' test-comment\n');fs.writeFileSync(mismatchPath,otherPair.public);
  const validated=await validateSshKeyPair(privatePath,publicPath);
  assert.equal(validated.publicKey,normalizeOpenSshPublicKey(pair.public));
  await assert.rejects(()=>validateSshKeyPair(privatePath,mismatchPath),/同じキーペアではありません/);

  const calls=[];
  let lifecycleState='running',accountKeys=[{id:7,key:validated.publicKey}],instanceKeys=[{id:8,public_key:validated.publicKey}];
  const fakeFetch=async(url,init={})=>{
    calls.push({url:String(url),init});
    const u=new URL(String(url));
    if(u.pathname==='/api/v1/instances/'&&u.searchParams.get('after_token')==='next-page')return response({instances:[{id:2,actual_status:'stopped',gpu_name:'RTX 4090'}],next_token:null});
    if(u.pathname==='/api/v1/instances/')return response({instances:[{id:1,actual_status:'running',ssh_host:'ssh.vast.ai',ssh_port:12345,gpu_name:'RTX 5090'}],next_token:'next-page'});
    if(u.pathname==='/api/v0/ssh/'&&(!init.method||init.method==='GET'))return response(accountKeys);
    if(u.pathname==='/api/v0/ssh/'&&init.method==='POST'){const body=JSON.parse(init.body);accountKeys=[...accountKeys,{id:9,key:body.ssh_key}];return response({success:true,key:{id:9,public_key:body.ssh_key}})}
    if(u.pathname==='/api/v0/instances/1/ssh/'&&(!init.method||init.method==='GET'))return response({success:true,ssh_keys:JSON.stringify(instanceKeys)});
    if(u.pathname==='/api/v0/instances/1/ssh/'&&init.method==='POST'){const body=JSON.parse(init.body);instanceKeys=[...instanceKeys,{id:10,public_key:body.ssh_key}];return response({success:true,msg:'SSH key attached successfully'})}
    if(u.pathname==='/api/v0/instances/1/'&&init.method==='PUT'){
      const requested=JSON.parse(init.body);
      lifecycleState=requested.state;
      return response({success:true});
    }
    if(u.pathname==='/api/v0/instances/1/'&&(!init.method||init.method==='GET'))return response({instances:{id:1,actual_status:lifecycleState,intended_status:lifecycleState,cur_state:lifecycleState,ssh_host:lifecycleState==='running'?'ssh.vast.ai':null,ssh_port:lifecycleState==='running'?12345:null}});
    if(u.pathname==='/api/v0/instances/999/'&&(!init.method||init.method==='GET'))return response({instances:{}});
    return response({msg:'not found'},404);
  };
  const client=new VastAiClient(async()=>'secret-key',fakeFetch,'https://example.test');
  const instances=await client.listInstances();
  assert.deepEqual(instances.map(x=>x.id),[1,2]);
  assert.equal(calls[0].init.headers.Authorization,'Bearer secret-key');
  assert.match(calls[1].url,/after_token=next-page/);

  const existing=await client.ensureSshAccess(1,validated.publicKey+' ignored-comment');
  assert.deepEqual(existing,{accountAlreadyRegistered:true,instanceAlreadyAttached:true,instanceAttached:true});
  assert.equal(calls.filter(x=>x.init.method==='POST'&&new URL(x.url).pathname.includes('/ssh/')).length,0,'既存鍵は再登録・再attachしない');

  accountKeys=[];instanceKeys=[];
  const provisioned=await client.ensureSshAccess(1,validated.publicKey);
  assert.deepEqual(provisioned,{accountAlreadyRegistered:false,instanceAlreadyAttached:false,instanceAttached:true});
  const sshPosts=calls.filter(x=>x.init.method==='POST'&&new URL(x.url).pathname.includes('/ssh/'));
  assert.equal(sshPosts.length,2);
  assert.equal(new URL(sshPosts[0].url).pathname,'/api/v0/ssh/');
  assert.equal(new URL(sshPosts[1].url).pathname,'/api/v0/instances/1/ssh/');
  assert.equal(JSON.parse(sshPosts[0].init.body).ssh_key,validated.publicKey);
  assert.equal(JSON.parse(sshPosts[1].init.body).ssh_key,validated.publicKey);

  const one=await client.getInstance(1);
  assert.equal(one.sshHost,'ssh.vast.ai');
  await assert.rejects(()=>client.getInstance(999),error=>error instanceof VastAiInstanceNotFoundError&&error.instanceId===999&&/見つかりません/.test(error.message));
  const started=await client.startInstance(1);
  assert.equal(started.status,'running');
  const stopped=await client.stopInstance(1);
  assert.equal(stopped.status,'stopped');
  const puts=calls.filter(x=>x.init.method==='PUT');
  assert.equal(puts.length,2);
  assert.deepEqual(JSON.parse(puts[0].init.body),{state:'running'});
  assert.deepEqual(JSON.parse(puts[1].init.body),{state:'stopped'});
  assert.ok(puts.every(x=>x.init.headers.Authorization==='Bearer secret-key'));
  assert.ok(calls.filter(x=>new URL(x.url).pathname==='/api/v0/instances/1/'&&(!x.init.method||x.init.method==='GET')).length>=3,'lifecycle操作後にGETで最終状態を確認する');

  console.log('Vast.ai client tests passed.');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(()=>{fs.rmSync(runtime,{recursive:true,force:true})});
