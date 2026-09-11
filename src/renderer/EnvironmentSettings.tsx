import { useEffect, useState } from 'react';
import type { AppSettings, AppSettingsStatus } from '../shared/types';
import type { Runner } from './ui';

type AppSettingsWithRoots=AppSettings&{projectRoot:string;artifactRoot:string};
const EMPTY_SETTINGS:AppSettingsWithRoots={comfyUiInstallPath:'',comfyUiApiEndpoint:'http://127.0.0.1:8188',projectRoot:'',artifactRoot:'',catalogPath:'',r2Bucket:'',r2ModelPrefix:'',r2IndexPath:'',templatePath:'',manifestPath:''};

export function EnvironmentSettings({onClose,run}:{onClose:()=>void;run:Runner}){
  const [settings,setSettings]=useState<AppSettingsWithRoots>(EMPTY_SETTINGS),[status,setStatus]=useState<AppSettingsStatus|null>(null);
  useEffect(()=>{let cancelled=false;void window.batchStudio.appSettings.get().then(appSettings=>{if(cancelled)return;const roots=appSettings as AppSettingsStatus&Partial<Pick<AppSettingsWithRoots,'projectRoot'|'artifactRoot'>>;setStatus(appSettings);setSettings({comfyUiInstallPath:appSettings.comfyUiInstallPath,comfyUiApiEndpoint:appSettings.comfyUiApiEndpoint,projectRoot:roots.projectRoot??'',artifactRoot:roots.artifactRoot??'',catalogPath:appSettings.catalogPath,r2Bucket:appSettings.r2Bucket,r2ModelPrefix:appSettings.r2ModelPrefix,r2IndexPath:appSettings.r2IndexPath,templatePath:appSettings.templatePath,manifestPath:appSettings.manifestPath});}).catch(()=>{});return()=>{cancelled=true}},[]);
  const setApp=(key:keyof AppSettingsWithRoots,value:string)=>setSettings(prev=>({...prev,[key]:value}));
  const chooseComfyUi=()=>run(async()=>{const selected=await window.batchStudio.appSettings.selectComfyUiDirectory();if(selected)setApp('comfyUiInstallPath',selected)});
  const chooseRoot=(key:'projectRoot'|'artifactRoot')=>run(async()=>{const selected=await window.batchStudio.project.selectParent();if(selected)setApp(key,selected)});
  const save=()=>run(async()=>{const next=await window.batchStudio.appSettings.save(settings);setStatus(next);onClose()});
  return <div className="modal"><div className="modalcard environment-settings-card"><h2>環境設定</h2><p>ComfyUI Batch Studio自体のローカル環境・互換パス設定です。R2、Civitai、クラウドインスタンスの資格情報はホームの「サービス連携」から設定します。</p>
    <section className="environment-section"><div className="panelhead"><div><h3>パス設定</h3><p>プロジェクト単位ではなくアプリ全体で共通するローカルパスです。空欄の場合は内蔵・統合機能を使用します。</p></div></div><div className="formgrid">
      <label className="wide"><span>Project root <code>BATCH_STUDIO_PROJECT_ROOT</code></span><div className="actions"><input style={{flex:1,minWidth:280}} value={settings.projectRoot} readOnly placeholder="新規プロジェクトの既定の作成先"/><button onClick={()=>void chooseRoot('projectRoot')}>選択</button><button disabled={!settings.projectRoot} onClick={()=>setApp('projectRoot','')}>解除</button></div></label>
      <label className="wide"><span>成果物配置 root（生成画像） <code>BATCH_STUDIO_ARTIFACT_ROOT</code></span><div className="actions"><input style={{flex:1,minWidth:280}} value={settings.artifactRoot} readOnly placeholder="生成画像などの成果物を配置する親フォルダー"/><button onClick={()=>void chooseRoot('artifactRoot')}>選択</button><button disabled={!settings.artifactRoot} onClick={()=>setApp('artifactRoot','')}>解除</button></div></label>
      <label className="wide">ComfyUI インストール先ディレクトリ<div className="actions"><input style={{flex:1,minWidth:280}} value={settings.comfyUiInstallPath} readOnly placeholder="ComfyUI フォルダーを選択（リモート実行のみなら空欄可）"/><button onClick={()=>void chooseComfyUi()}>選択</button><button disabled={!settings.comfyUiInstallPath} onClick={()=>setApp('comfyUiInstallPath','')}>解除</button></div></label>
      <label className="wide"><span>Local ComfyUI API endpoint <code>BATCH_STUDIO_COMFYUI_API_ENDPOINT</code></span><input value={settings.comfyUiApiEndpoint??''} onChange={e=>setApp('comfyUiApiEndpoint',e.target.value)} placeholder="http://127.0.0.1:8188"/></label>
      <label className="wide"><span>外部 model_catalog.json（互換用） <code>BATCH_STUDIO_CATALOG_PATH</code></span><input value={settings.catalogPath??''} onChange={e=>setApp('catalogPath',e.target.value)} placeholder="空欄 = Civitai統合カタログ"/></label>
      <label className="wide"><span>R2ファイル一覧JSON（互換用） <code>BATCH_STUDIO_R2_INDEX_PATH</code></span><input value={settings.r2IndexPath??''} onChange={e=>setApp('r2IndexPath',e.target.value)} placeholder="空欄 = R2統合インデックス"/></label>
      <label><span>Workflow Template <code>BATCH_STUDIO_TEMPLATE_PATH</code></span><input value={settings.templatePath??''} onChange={e=>setApp('templatePath',e.target.value)} placeholder="空欄 = 内蔵"/></label><label><span>Manifest <code>BATCH_STUDIO_MANIFEST_PATH</code></span><input value={settings.manifestPath??''} onChange={e=>setApp('manifestPath',e.target.value)} placeholder="空欄 = 内蔵"/></label>
    </div><p className="hint">新規プロジェクトでは Project root が作成先の既定値になります。成果物配置 root を設定すると、プロジェクト作成時に <code>{'<成果物配置 root>/<projectId>'}</code> フォルダーを作成します。</p><p className="hint">ローカル実行のモデル配置確認では、指定したComfyUIディレクトリ直下の <code>models</code> 配下を再帰的に探索します。</p>{status?.configured&&<div className="facts"><div>ComfyUI <code>{status.comfyUiInstallPath}</code></div><div>モデル探索先 <code>{status.modelsPath??'-'}</code></div><div>models <b>{status.modelsExists?'✓':'✕'}</b></div></div>}</section>
    <div className="actions environment-actions"><button onClick={onClose}>キャンセル</button><button className="primary" onClick={()=>void save()}>環境設定を保存</button></div>
  </div></div>;
}
