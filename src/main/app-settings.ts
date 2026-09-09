import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings, AppSettingsStatus } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import { listLocalModelFiles } from './model-file-sources.js';

interface StoredAppSettingsV1 { schemaVersion:1; comfyUiInstallPath:string; }
interface StoredAppSettingsV2 { schemaVersion:2; comfyUiInstallPath:string; catalogPath:string; r2Bucket:string; r2ModelPrefix:string; r2IndexPath:string; templatePath:string; manifestPath:string; }
type StoredAppSettings=StoredAppSettingsV1|StoredAppSettingsV2;
type NormalizedAppSettings=Required<AppSettings>;
const EMPTY:NormalizedAppSettings={comfyUiInstallPath:'',catalogPath:'',r2Bucket:'',r2ModelPrefix:'',r2IndexPath:'',templatePath:'',manifestPath:''};
const RUNTIME_ENV={catalogPath:'BATCH_STUDIO_CATALOG_PATH',r2Bucket:'BATCH_STUDIO_R2_BUCKET',r2ModelPrefix:'BATCH_STUDIO_R2_MODEL_PREFIX',r2IndexPath:'BATCH_STUDIO_R2_INDEX_PATH',templatePath:'BATCH_STUDIO_TEMPLATE_PATH',manifestPath:'BATCH_STUDIO_MANIFEST_PATH'} as const;
async function isDirectory(target:string){try{return (await stat(target)).isDirectory()}catch{return false}}
function text(value:unknown){return typeof value==='string'?value.trim():''}
function normalize(raw:StoredAppSettings|null):NormalizedAppSettings{if(raw?.schemaVersion===1)return {...EMPTY,comfyUiInstallPath:text(raw.comfyUiInstallPath)};if(raw?.schemaVersion===2)return {comfyUiInstallPath:text(raw.comfyUiInstallPath),catalogPath:text(raw.catalogPath),r2Bucket:text(raw.r2Bucket),r2ModelPrefix:text(raw.r2ModelPrefix).replace(/^\/+|\/+$/g,''),r2IndexPath:text(raw.r2IndexPath),templatePath:text(raw.templatePath),manifestPath:text(raw.manifestPath)};return {...EMPTY}}
function applyRuntimeEnvironment(settings:NormalizedAppSettings){for(const [key,envKey] of Object.entries(RUNTIME_ENV) as Array<[keyof typeof RUNTIME_ENV,string]>)process.env[envKey]=settings[key]}

export class AppSettingsStore {
  private readonly filePath:string;
  constructor(userDataPath:string){this.filePath=path.join(userDataPath,'app-settings.json')}
  private async read():Promise<NormalizedAppSettings>{return normalize(await readJson<StoredAppSettings>(this.filePath))}
  async initialize(){const current=await this.read();applyRuntimeEnvironment(current);return this.statusFrom(current)}
  async values():Promise<NormalizedAppSettings>{return this.read()}
  private async statusFrom(current:NormalizedAppSettings):Promise<AppSettingsStatus>{const installPath=current.comfyUiInstallPath,modelsPath=installPath?path.join(installPath,'models'):null;const [textEncoders,vae]=await Promise.all([listLocalModelFiles(modelsPath,'text_encoder'),listLocalModelFiles(modelsPath,'vae')]);return {...current,configured:Boolean(installPath),modelsPath,installExists:Boolean(installPath&&await isDirectory(installPath)),modelsExists:Boolean(modelsPath&&await isDirectory(modelsPath)),modelFiles:{text_encoders:textEncoders,vae}}}
  async status():Promise<AppSettingsStatus>{return this.statusFrom(await this.read())}
  async save(input:AppSettings):Promise<AppSettingsStatus>{let comfyUiInstallPath=text(input?.comfyUiInstallPath);if(comfyUiInstallPath){if(!path.isAbsolute(comfyUiInstallPath))throw new Error('ComfyUIのインストール先は絶対パスで指定してください。');comfyUiInstallPath=path.resolve(comfyUiInstallPath);if(!(await isDirectory(comfyUiInstallPath)))throw new Error('指定したComfyUIのインストール先ディレクトリが見つかりません。');const modelsPath=path.join(comfyUiInstallPath,'models');if(!(await isDirectory(modelsPath)))throw new Error('指定したディレクトリにmodelsフォルダーがありません。ComfyUIのインストール先ディレクトリを指定してください。');}
    const value:NormalizedAppSettings={comfyUiInstallPath,catalogPath:text(input?.catalogPath),r2Bucket:text(input?.r2Bucket),r2ModelPrefix:text(input?.r2ModelPrefix).replace(/^\/+|\/+$/g,''),r2IndexPath:text(input?.r2IndexPath),templatePath:text(input?.templatePath),manifestPath:text(input?.manifestPath)};await writeJsonAtomic(this.filePath,{schemaVersion:2,...value} satisfies StoredAppSettingsV2);applyRuntimeEnvironment(value);return this.statusFrom(value)}
}
