import { createHash } from 'node:crypto';
import path from 'node:path';
import { readJson, writeJsonAtomic } from './fs-utils.js';

interface HostKeyRecord { host:string; port:number; algorithm:string; fingerprint:string; trustedAt:string; }
interface HostKeyFile { schemaVersion:1; hosts:Record<string,HostKeyRecord>; }
export type HostKeyCheck={status:'trusted'|'unknown'|'mismatch';fingerprint:string;expectedFingerprint?:string};

export function sshHostKeyFingerprint(key:Buffer){return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/,'')}`;}
export function sshHostKeyId(host:string,port:number){return `${host.toLowerCase()}:${port}`;}

export class SshHostKeyStore {
  private readonly filePath:string;
  constructor(userData:string){this.filePath=path.join(userData,'ssh','known-hosts.json');}
  private async load():Promise<HostKeyFile>{return (await readJson<HostKeyFile>(this.filePath))??{schemaVersion:1,hosts:{}};}
  async check(host:string,port:number,key:Buffer,algorithm='unknown'):Promise<HostKeyCheck>{
    const fingerprint=sshHostKeyFingerprint(key),record=(await this.load()).hosts[sshHostKeyId(host,port)];
    if(!record)return {status:'unknown',fingerprint};
    return record.fingerprint===fingerprint?{status:'trusted',fingerprint}:{status:'mismatch',fingerprint,expectedFingerprint:record.fingerprint};
  }
  async trustedFingerprint(host:string,port:number){return (await this.load()).hosts[sshHostKeyId(host,port)]?.fingerprint??null;}
  async trustFingerprint(host:string,port:number,fingerprint:string,algorithm='unknown'){
    if(!/^SHA256:[A-Za-z0-9+/]+$/.test(fingerprint))throw new Error('Invalid SSH Host Key fingerprint');
    const file=await this.load();
    file.hosts[sshHostKeyId(host,port)]={host,port,algorithm,fingerprint,trustedAt:new Date().toISOString()};
    await writeJsonAtomic(this.filePath,file);return fingerprint;
  }
  async trust(host:string,port:number,key:Buffer,algorithm='unknown'){return this.trustFingerprint(host,port,sshHostKeyFingerprint(key),algorithm);}
}
