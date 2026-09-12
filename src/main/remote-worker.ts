import { createHash, randomUUID } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import type { VerifiedSshSession } from './ssh-client.js';
import { REMOTE_WORKER_FILE, REMOTE_WORKER_VERSION } from './remote-worker-source.js';

export type WorkerEvent={type:'progress';stage:string;[key:string]:unknown}|{type:'response';requestId:string;result?:unknown;error?:{code:string;message:string}};
export type WorkerEventHandler=(event:WorkerEvent)=>void|Promise<void>;
export class RemoteWorkerRequestError extends Error { constructor(public readonly code:string,message:string){super(message);this.name='RemoteWorkerRequestError';} }
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const q=(value:string)=>`'${value.replace(/'/g,"'\\''")}'`;
function sftpWrite(sftp:SFTPWrapper,target:string,data:Buffer){return new Promise<void>((resolve,reject)=>{const stream=sftp.createWriteStream(target,{mode:0o700});stream.on('close',resolve).on('error',reject);stream.end(data);});}

export class RemoteWorkerClient {
  readonly localSha256=sha(REMOTE_WORKER_FILE);
  async deploy(session:VerifiedSshSession,comfyDir:string,runId:string){
    if(!/^[0-9a-f-]{36}$/i.test(runId))throw new Error('Invalid Execution Run ID');
    const normalizedComfyDir=comfyDir.replace(/\/$/,'');const runDir=`${normalizedComfyDir}/.batch-studio/runs/${runId}`,workerPath=`${runDir}/worker-v${REMOTE_WORKER_VERSION}.py`,modelsRoot=`${normalizedComfyDir}/models`;
    let result=await session.exec(`if [ ! -d ${q(normalizedComfyDir)} ] || [ ! -d ${q(modelsRoot)} ]; then exit 44; fi; mkdir -p ${q(runDir)} && chmod 700 ${q(runDir)}`);if(result.code===44)throw new Error(`REMOTE_COMFYUI_DIRECTORY_MISSING: ${normalizedComfyDir}/models`);if(result.code!==0)throw new Error(`Remote run temp creation failed: ${result.stderr}`);
    const sftp=await session.sftp();try{await sftpWrite(sftp,workerPath,Buffer.from(REMOTE_WORKER_FILE));}finally{sftp.end();}
    const verifyProgram=`import hashlib;print(hashlib.sha256(open(${JSON.stringify(workerPath)},'rb').read()).hexdigest())`;
    result=await session.exec(`python3 -c ${q(verifyProgram)}`);
    const remoteSha256=result.stdout.trim();if(result.code!==0||remoteSha256!==this.localSha256)throw new Error(`REMOTE_WORKER_SHA256_MISMATCH local=${this.localSha256} remote=${remoteSha256||'unavailable'}`);
    return {runDir,workerPath,modelsRoot,comfyRoot:normalizedComfyDir,localSha256:this.localSha256,remoteSha256};
  }
  async request(session:VerifiedSshSession,deployment:{runDir:string;workerPath:string;modelsRoot?:string;comfyRoot?:string},op:string,payload:Record<string,unknown>={},onEvent?:WorkerEventHandler){
    const requestId=randomUUID(),input=JSON.stringify({requestId,op,...payload})+'\n';
    const command=`python3 ${q(deployment.workerPath)} --root ${q(deployment.runDir)}${deployment.modelsRoot?` --model-root ${q(deployment.modelsRoot)}`:''}${deployment.comfyRoot?` --comfy-root ${q(deployment.comfyRoot)}`:''}`;
    const events:WorkerEvent[]=[];let buffer='',protocolError:Error|null=null,eventChain=Promise.resolve();
    const acceptLine=(raw:string)=>{const line=raw.replace(/\r$/,'');if(!line)return;try{const event=JSON.parse(line) as WorkerEvent;events.push(event);if(onEvent)eventChain=eventChain.then(()=>onEvent(event));}catch{protocolError??=new Error('REMOTE_WORKER_PROTOCOL_INVALID_JSON');}};
    const consume=(chunk:string)=>{buffer+=chunk;for(;;){const index=buffer.indexOf('\n');if(index<0)break;const line=buffer.slice(0,index);buffer=buffer.slice(index+1);acceptLine(line);}};
    const result=await session.exec(command,input,consume);if(buffer.trim())acceptLine(buffer);await eventChain;if(protocolError)throw protocolError;
    const response=events.find((event):event is Extract<WorkerEvent,{type:'response'}>=>event.type==='response'&&event.requestId===requestId);
    if(!response)throw new Error(`REMOTE_WORKER_NO_RESPONSE: ${result.stderr}`);if(response.error)throw new RemoteWorkerRequestError(response.error.code,response.error.message);return {response:response.result,events};
  }
}
