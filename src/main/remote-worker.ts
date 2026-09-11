import { createHash, randomUUID } from 'node:crypto';
import type { SFTPWrapper } from 'ssh2';
import type { VerifiedSshSession } from './ssh-client.js';
import { REMOTE_WORKER_FILE, REMOTE_WORKER_VERSION } from './remote-worker-source.js';

export type WorkerEvent={type:'progress';stage:string;[key:string]:unknown}|{type:'response';requestId:string;result?:unknown;error?:{code:string;message:string}};
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const q=(value:string)=>`'${value.replace(/'/g,"'\\''")}'`;
function sftpWrite(sftp:SFTPWrapper,target:string,data:Buffer){return new Promise<void>((resolve,reject)=>{const stream=sftp.createWriteStream(target,{mode:0o700});stream.on('close',resolve).on('error',reject);stream.end(data);});}

export class RemoteWorkerClient {
  readonly localSha256=sha(REMOTE_WORKER_FILE);
  async deploy(session:VerifiedSshSession,comfyDir:string,runId:string){
    if(!/^[0-9a-f-]{36}$/i.test(runId))throw new Error('Invalid Execution Run ID');
    const runDir=`${comfyDir.replace(/\/$/,'')}/.batch-studio/runs/${runId}`,workerPath=`${runDir}/worker-v${REMOTE_WORKER_VERSION}.py`;
    let result=await session.exec(`mkdir -p ${q(runDir)} && chmod 700 ${q(runDir)}`);if(result.code!==0)throw new Error(`Remote run temp creation failed: ${result.stderr}`);
    const sftp=await session.sftp();try{await sftpWrite(sftp,workerPath,Buffer.from(REMOTE_WORKER_FILE));}finally{sftp.end();}
    const verifyProgram=`import hashlib;print(hashlib.sha256(open(${JSON.stringify(workerPath)},'rb').read()).hexdigest())`;
    result=await session.exec(`python3 -c ${q(verifyProgram)}`);
    const remoteSha256=result.stdout.trim();if(result.code!==0||remoteSha256!==this.localSha256)throw new Error(`REMOTE_WORKER_SHA256_MISMATCH local=${this.localSha256} remote=${remoteSha256||'unavailable'}`);
    return {runDir,workerPath,localSha256:this.localSha256,remoteSha256};
  }
  async request(session:VerifiedSshSession,deployment:{runDir:string;workerPath:string},op:string,payload:Record<string,unknown>={}){
    const requestId=randomUUID(),input=JSON.stringify({requestId,op,...payload})+'\n';
    const result=await session.exec(`python3 ${q(deployment.workerPath)} --root ${q(deployment.runDir)}`,input);const events:WorkerEvent[]=[];
    for(const line of result.stdout.split(/\r?\n/).filter(Boolean)){try{events.push(JSON.parse(line));}catch{throw new Error('REMOTE_WORKER_PROTOCOL_INVALID_JSON');}}
    const response=events.find((event):event is Extract<WorkerEvent,{type:'response'}>=>event.type==='response'&&event.requestId===requestId);
    if(!response)throw new Error(`REMOTE_WORKER_NO_RESPONSE: ${result.stderr}`);if(response.error)throw new Error(`${response.error.code}: ${response.error.message}`);return {response:response.result,events};
  }
}
