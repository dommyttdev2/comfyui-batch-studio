import { stat } from 'node:fs/promises';
import path from 'node:path';
import type { AppSettings, AppSettingsStatus } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import { listLocalModelFiles } from './model-file-sources.js';

interface StoredAppSettings {
  schemaVersion: 1;
  comfyUiInstallPath: string;
}

async function isDirectory(target:string){try{return (await stat(target)).isDirectory()}catch{return false}}

export class AppSettingsStore {
  private readonly filePath:string;
  constructor(userDataPath:string){this.filePath=path.join(userDataPath,'app-settings.json')}
  private async read():Promise<AppSettings>{const raw=await readJson<StoredAppSettings>(this.filePath);return {comfyUiInstallPath:raw?.schemaVersion===1&&typeof raw.comfyUiInstallPath==='string'?raw.comfyUiInstallPath:''}}
  async status():Promise<AppSettingsStatus>{const current=await this.read(),installPath=current.comfyUiInstallPath.trim(),modelsPath=installPath?path.join(installPath,'models'):null;const [textEncoders,clip]=await Promise.all([listLocalModelFiles(modelsPath,'text_encoder'),listLocalModelFiles(modelsPath,'clip')]);return {...current,configured:Boolean(installPath),modelsPath,installExists:Boolean(installPath&&await isDirectory(installPath)),modelsExists:Boolean(modelsPath&&await isDirectory(modelsPath)),modelFiles:{text_encoders:textEncoders,clip}}}
  async save(input:AppSettings):Promise<AppSettingsStatus>{const value=typeof input?.comfyUiInstallPath==='string'?input.comfyUiInstallPath.trim():'';if(!value)throw new Error('ComfyUIのインストール先ディレクトリを指定してください。');if(!path.isAbsolute(value))throw new Error('ComfyUIのインストール先は絶対パスで指定してください。');const resolved=path.resolve(value);if(!(await isDirectory(resolved)))throw new Error('指定したComfyUIのインストール先ディレクトリが見つかりません。');const modelsPath=path.join(resolved,'models');if(!(await isDirectory(modelsPath)))throw new Error('指定したディレクトリにmodelsフォルダーがありません。ComfyUIのインストール先ディレクトリを指定してください。');await writeJsonAtomic(this.filePath,{schemaVersion:1,comfyUiInstallPath:resolved} satisfies StoredAppSettings);return this.status()}
}
