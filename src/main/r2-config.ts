import path from 'node:path';
import { safeStorage } from 'electron';
import { readJson, writeJsonAtomic } from './fs-utils.js';

export interface R2ConnectionInput {
  name?: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey?: string;
  publicUrl?: string;
  cloudflareApiToken?: string;
}

export interface R2ConnectionStatus {
  configured: boolean;
  name: string;
  accountId: string;
  accessKeyId: string;
  publicUrl: string;
  secretConfigured: boolean;
  metricsTokenConfigured: boolean;
}

interface StoredR2Config {
  schemaVersion: 1;
  name: string;
  accountId: string;
  accessKeyId: string;
  publicUrl: string;
  encryptedSecret?: string;
  encryptedMetricsToken?: string;
}

const ACCOUNT_ID=/^[0-9a-fA-F]{32}$/;

function normalizePublicUrl(value:string|undefined){return (value??'').trim().replace(/\/+$/,'');}
function validate(input:R2ConnectionInput){
  if(!ACCOUNT_ID.test(input.accountId.trim()))throw new Error('Account IDは32文字の16進数で入力してください。');
  if(!input.accessKeyId.trim())throw new Error('Access Key IDを入力してください。');
  const publicUrl=normalizePublicUrl(input.publicUrl);
  if(publicUrl&&!/^https?:\/\//i.test(publicUrl))throw new Error('Public URLはhttp://またはhttps://から入力してください。');
}
function encrypt(value:string){if(!safeStorage.isEncryptionAvailable())throw new Error('OSの安全な暗号化ストレージを利用できないためSecretを保存できません。');return safeStorage.encryptString(value).toString('base64');}
function decrypt(value:string|undefined){if(!value)return '';try{return safeStorage.decryptString(Buffer.from(value,'base64'));}catch{return '';}}

export class R2ConfigStore {
  private readonly filePath:string;
  constructor(userData:string){this.filePath=path.join(userData,'r2','config.json');}
  async raw(){return readJson<StoredR2Config>(this.filePath);}
  environmentDefaults():R2ConnectionInput{return {name:'Personal R2',accountId:process.env.R2_ACCOUNT_ID??'',accessKeyId:process.env.R2_ACCESS_KEY??'',secretAccessKey:process.env.R2_SECRET_ACCESS_KEY??'',publicUrl:process.env.R2_PUBLIC_URL??'',cloudflareApiToken:process.env.CLOUDFLARE_API_TOKEN??''};}
  async status():Promise<R2ConnectionStatus>{const c=await this.raw();if(!c){const e=this.environmentDefaults();return {configured:false,name:e.name??'Personal R2',accountId:e.accountId,accessKeyId:e.accessKeyId,publicUrl:normalizePublicUrl(e.publicUrl),secretConfigured:Boolean(e.secretAccessKey),metricsTokenConfigured:Boolean(e.cloudflareApiToken)};}return {configured:true,name:c.name,accountId:c.accountId,accessKeyId:c.accessKeyId,publicUrl:c.publicUrl,secretConfigured:Boolean(decrypt(c.encryptedSecret)),metricsTokenConfigured:Boolean(decrypt(c.encryptedMetricsToken))};}
  async credentials(){const c=await this.raw();if(c){const secret=decrypt(c.encryptedSecret);if(!secret)throw new Error('Secret Access Keyが保存されていません。');return {name:c.name,accountId:c.accountId,accessKeyId:c.accessKeyId,secretAccessKey:secret,publicUrl:c.publicUrl,cloudflareApiToken:decrypt(c.encryptedMetricsToken)};}const e=this.environmentDefaults();validate(e);if(!e.secretAccessKey)throw new Error('Secret Access Keyを入力してください。');return {...e,name:e.name??'Personal R2',publicUrl:normalizePublicUrl(e.publicUrl),cloudflareApiToken:e.cloudflareApiToken??''};}
  async save(input:R2ConnectionInput){validate(input);const existing=await this.raw();const submittedSecret=(input.secretAccessKey??'').trim();const submittedToken=(input.cloudflareApiToken??'').trim();const encryptedSecret=submittedSecret?encrypt(submittedSecret):existing?.encryptedSecret;const encryptedMetricsToken=submittedToken?encrypt(submittedToken):existing?.encryptedMetricsToken;if(!encryptedSecret)throw new Error('Secret Access Keyを入力してください。');const next:StoredR2Config={schemaVersion:1,name:(input.name??'Personal R2').trim()||'Personal R2',accountId:input.accountId.trim(),accessKeyId:input.accessKeyId.trim(),publicUrl:normalizePublicUrl(input.publicUrl),encryptedSecret,encryptedMetricsToken};await writeJsonAtomic(this.filePath,next);return this.status();}
}
