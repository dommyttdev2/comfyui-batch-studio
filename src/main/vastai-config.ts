import { stat } from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { VastAiConnectionInput, VastAiConnectionStatus } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import { validateSshKeyPair } from './ssh-key-pair.js';

export const VASTAI_ENVIRONMENT_VARIABLE='VASTAI_API_KEY';
export const DEFAULT_VASTAI_SSH_USER='root';
export const DEFAULT_VASTAI_COMFY_PORT=18188;

interface StoredVastAiConfigV1 {
  schemaVersion:1;
  encryptedApiKey?:string;
  sshPrivateKeyPath:string;
  sshUser:string;
  comfyUiDirectory:string;
  comfyUiPort:number;
}
interface StoredVastAiConfigV2 {
  schemaVersion:2;
  encryptedApiKey?:string;
  sshPrivateKeyPath:string;
  sshPublicKeyPath:string;
  sshUser:string;
  comfyUiDirectory:string;
  comfyUiPort:number;
}
interface StoredVastAiConfigV3 {
  schemaVersion:3;
  encryptedApiKey?:string;
  sshPrivateKeyPath:string;
  sshPublicKeyPath:string;
  sshUser:string;
  comfyUiPort:number;
}
type StoredVastAiConfig=StoredVastAiConfigV1|StoredVastAiConfigV2|StoredVastAiConfigV3;
function encrypt(value:string){if(!safeStorage.isEncryptionAvailable())throw new Error('OSの安全な暗号化ストレージを利用できないためVast.ai API Keyを保存できません。');return safeStorage.encryptString(value).toString('base64');}
function decrypt(value:string|undefined){if(!value)return '';try{return safeStorage.decryptString(Buffer.from(value,'base64'));}catch{return '';}}
function text(value:unknown){return typeof value==='string'?value.trim():'';}
async function isFile(target:string){try{return (await stat(target)).isFile();}catch{return false;}}
function normalizePort(value:unknown){const n=typeof value==='number'?value:Number(value);if(!Number.isInteger(n)||n<1||n>65535)throw new Error('ComfyUI Portは1〜65535の整数で指定してください。');return n;}
async function pairValid(privatePath:string,publicPath:string){if(!privatePath||!publicPath)return false;try{await validateSshKeyPair(privatePath,publicPath);return true}catch{return false}}

export class VastAiConfigStore {
  private readonly filePath:string;
  constructor(userData:string){this.filePath=path.join(userData,'vastai','config.json');}
  private async raw(){return readJson<StoredVastAiConfig>(this.filePath);}
  private environmentApiKey(){return text(process.env[VASTAI_ENVIRONMENT_VARIABLE]);}
  async apiKey(){const saved=decrypt((await this.raw())?.encryptedApiKey);return saved||this.environmentApiKey();}
  async status():Promise<VastAiConnectionStatus>{
    const stored=await this.raw(),saved=decrypt(stored?.encryptedApiKey),environment=this.environmentApiKey();
    const sshPrivateKeyPath=text(stored?.sshPrivateKeyPath),sshPublicKeyPath=stored?.schemaVersion===2?text(stored.sshPublicKeyPath):'';
    const sshPrivateKeyExists=Boolean(sshPrivateKeyPath&&await isFile(sshPrivateKeyPath)),sshPublicKeyExists=Boolean(sshPublicKeyPath&&await isFile(sshPublicKeyPath));
    const sshUser=text(stored?.sshUser)||DEFAULT_VASTAI_SSH_USER,comfyUiPort=stored?.comfyUiPort??DEFAULT_VASTAI_COMFY_PORT;
    return {configured:Boolean(saved||environment),source:saved?'saved':environment?'environment':'none',sshPrivateKeyPath,sshPrivateKeyExists,sshPublicKeyPath,sshPublicKeyExists,sshKeyPairValid:sshPrivateKeyExists&&sshPublicKeyExists?await pairValid(sshPrivateKeyPath,sshPublicKeyPath):false,sshUser,comfyUiPort};
  }
  async save(input:VastAiConnectionInput):Promise<VastAiConnectionStatus>{
    const existing=await this.raw(),submittedKey=text(input?.apiKey),savedKey=decrypt(existing?.encryptedApiKey),environmentKey=this.environmentApiKey(),resolvedKey=submittedKey||savedKey||environmentKey;
    if(!resolvedKey)throw new Error(`${VASTAI_ENVIRONMENT_VARIABLE} またはVast.ai API Keyを設定してください。`);
    const sshPrivateKeyPath=text(input?.sshPrivateKeyPath),sshPublicKeyPath=text(input?.sshPublicKeyPath),sshUser=text(input?.sshUser)||DEFAULT_VASTAI_SSH_USER,comfyUiPort=normalizePort(input?.comfyUiPort??DEFAULT_VASTAI_COMFY_PORT);
    if(Boolean(sshPrivateKeyPath)!==Boolean(sshPublicKeyPath))throw new Error('SSH秘密鍵とSSH公開鍵はセットで指定してください。');
    for(const [label,target] of [['SSH秘密鍵',sshPrivateKeyPath],['SSH公開鍵',sshPublicKeyPath]] as const){
      if(!target)continue;
      if(!path.isAbsolute(target))throw new Error(`${label}は絶対パスで指定してください。`);
      if(!(await isFile(target)))throw new Error(`${label}が見つかりません: ${target}`);
    }
    if(sshPrivateKeyPath&&sshPublicKeyPath)await validateSshKeyPair(sshPrivateKeyPath,sshPublicKeyPath);
    const encryptedApiKey=submittedKey?encrypt(submittedKey):existing?.encryptedApiKey;
    await writeJsonAtomic(this.filePath,{schemaVersion:3,encryptedApiKey,sshPrivateKeyPath,sshPublicKeyPath,sshUser,comfyUiPort} satisfies StoredVastAiConfigV3);
    if(submittedKey)process.env[VASTAI_ENVIRONMENT_VARIABLE]=submittedKey;
    return this.status();
  }
}
