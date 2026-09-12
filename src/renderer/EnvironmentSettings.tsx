import { useEffect, useState } from 'react';
import type {
  AppSettings,
  AppSettingsSaveInput,
  AppSettingsStatus,
  RemoteCustomNodeRepository,
} from '../shared/types';
import type { Runner } from './ui';

type FormState = Required<AppSettings> & { githubPat: string };
type StringField = Exclude<keyof Required<AppSettings>, 'remoteCustomNodes'>;
const EMPTY_SETTINGS: FormState = {
  comfyUiInstallPath: '',
  remoteComfyUiInstallPath: '',
  comfyUiApiEndpoint: 'http://127.0.0.1:8188',
  projectRoot: '',
  artifactRoot: '',
  remoteCustomNodes: [],
  catalogPath: '',
  r2Bucket: '',
  r2ModelPrefix: '',
  r2IndexPath: '',
  templatePath: '',
  manifestPath: '',
  githubPat: '',
};

export function EnvironmentSettings({ onClose, run }: { onClose: () => void; run: Runner }) {
  const [settings, setSettings] = useState<FormState>(EMPTY_SETTINGS),
    [status, setStatus] = useState<AppSettingsStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.batchStudio.appSettings
      .get()
      .then((appSettings) => {
        if (cancelled) return;
        setStatus(appSettings);
        setSettings({
          comfyUiInstallPath: appSettings.comfyUiInstallPath,
          remoteComfyUiInstallPath: appSettings.remoteComfyUiInstallPath,
          comfyUiApiEndpoint: appSettings.comfyUiApiEndpoint,
          projectRoot: appSettings.projectRoot,
          artifactRoot: appSettings.artifactRoot,
          remoteCustomNodes: appSettings.remoteCustomNodes,
          catalogPath: appSettings.catalogPath,
          r2Bucket: appSettings.r2Bucket,
          r2ModelPrefix: appSettings.r2ModelPrefix,
          r2IndexPath: appSettings.r2IndexPath,
          templatePath: appSettings.templatePath,
          manifestPath: appSettings.manifestPath,
          githubPat: '',
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const setField = (key: StringField, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }));
  const setCustomNodes = (remoteCustomNodes: RemoteCustomNodeRepository[]) =>
    setSettings((prev) => ({ ...prev, remoteCustomNodes }));
  const chooseComfyUi = () =>
    run(async () => {
      const selected = await window.batchStudio.appSettings.selectComfyUiDirectory();
      if (selected) setField('comfyUiInstallPath', selected);
    });
  const chooseRoot = (key: 'projectRoot' | 'artifactRoot') =>
    run(async () => {
      const selected = await window.batchStudio.project.selectParent();
      if (selected) setField(key, selected);
    });
  const addCustomNode = () =>
    setCustomNodes([...settings.remoteCustomNodes, { repository: '', ref: '' }]);
  const updateCustomNode = (index: number, patch: Partial<RemoteCustomNodeRepository>) =>
    setCustomNodes(
      settings.remoteCustomNodes.map((node, i) => (i === index ? { ...node, ...patch } : node)),
    );
  const removeCustomNode = (index: number) =>
    setCustomNodes(settings.remoteCustomNodes.filter((_node, i) => i !== index));
  const save = () =>
    run(async () => {
      const input: AppSettingsSaveInput = {
        ...settings,
        remoteCustomNodes: settings.remoteCustomNodes.map((node) => ({
          repository: node.repository,
          ref: node.ref?.trim() || undefined,
        })),
        githubPat: settings.githubPat.trim() || undefined,
      };
      const next = await window.batchStudio.appSettings.save(input);
      setStatus(next);
      onClose();
    });
  return (
    <div className="modal">
      <div className="modalcard environment-settings-card">
        <h2>環境設定</h2>
        <p>
          ComfyUI Batch
          Studio自体のローカル環境・互換パス設定です。R2、Civitai、クラウドインスタンスの資格情報はホームの「サービス連携」から設定します。
        </p>
        <section className="environment-section">
          <div className="panelhead">
            <div>
              <h3>パス設定</h3>
              <p>
                プロジェクト単位ではなくアプリ全体で共通するローカルパスです。空欄の場合は内蔵・統合機能を使用します。
              </p>
            </div>
          </div>
          <div className="formgrid">
            <label className="wide">
              <span>
                Project root <code>BATCH_STUDIO_PROJECT_ROOT</code>
              </span>
              <div className="actions">
                <input
                  style={{ flex: 1, minWidth: 280 }}
                  value={settings.projectRoot}
                  readOnly
                  placeholder="新規プロジェクトの既定の作成先"
                />
                <button onClick={() => void chooseRoot('projectRoot')}>選択</button>
                <button
                  disabled={!settings.projectRoot}
                  onClick={() => setField('projectRoot', '')}
                >
                  解除
                </button>
              </div>
            </label>
            <label className="wide">
              <span>
                成果物配置 root（生成画像） <code>BATCH_STUDIO_ARTIFACT_ROOT</code>
              </span>
              <div className="actions">
                <input
                  style={{ flex: 1, minWidth: 280 }}
                  value={settings.artifactRoot}
                  readOnly
                  placeholder="生成画像などの成果物を配置する親フォルダー"
                />
                <button onClick={() => void chooseRoot('artifactRoot')}>選択</button>
                <button
                  disabled={!settings.artifactRoot}
                  onClick={() => setField('artifactRoot', '')}
                >
                  解除
                </button>
              </div>
            </label>
            <label className="wide">
              Local ComfyUI インストール先ディレクトリ
              <div className="actions">
                <input
                  style={{ flex: 1, minWidth: 280 }}
                  value={settings.comfyUiInstallPath}
                  readOnly
                  placeholder="ローカル実行で使用するComfyUIフォルダー"
                />
                <button onClick={() => void chooseComfyUi()}>選択</button>
                <button
                  disabled={!settings.comfyUiInstallPath}
                  onClick={() => setField('comfyUiInstallPath', '')}
                >
                  解除
                </button>
              </div>
            </label>
            <label className="wide">
              <span>
                Remote ComfyUI インストール先ディレクトリ{' '}
                <code>BATCH_STUDIO_REMOTE_COMFYUI_INSTALL_PATH</code>
              </span>
              <input
                value={settings.remoteComfyUiInstallPath}
                onChange={(e) => setField('remoteComfyUiInstallPath', e.target.value)}
                placeholder="/workspace/ComfyUI"
              />
            </label>
            <label className="wide">
              <span>
                Local ComfyUI API endpoint <code>BATCH_STUDIO_COMFYUI_API_ENDPOINT</code>
              </span>
              <input
                value={settings.comfyUiApiEndpoint}
                onChange={(e) => setField('comfyUiApiEndpoint', e.target.value)}
                placeholder="http://127.0.0.1:8188"
              />
            </label>
            <label className="wide">
              <span>
                外部 model_catalog.json（互換用） <code>BATCH_STUDIO_CATALOG_PATH</code>
              </span>
              <input
                value={settings.catalogPath}
                onChange={(e) => setField('catalogPath', e.target.value)}
                placeholder="空欄 = Civitai統合カタログ"
              />
            </label>
            <label className="wide">
              <span>
                R2ファイル一覧JSON（互換用） <code>BATCH_STUDIO_R2_INDEX_PATH</code>
              </span>
              <input
                value={settings.r2IndexPath}
                onChange={(e) => setField('r2IndexPath', e.target.value)}
                placeholder="空欄 = R2統合インデックス"
              />
            </label>
            <label>
              <span>
                Workflow Template <code>BATCH_STUDIO_TEMPLATE_PATH</code>
              </span>
              <input
                value={settings.templatePath}
                onChange={(e) => setField('templatePath', e.target.value)}
                placeholder="空欄 = 内蔵"
              />
            </label>
            <label>
              <span>
                Manifest <code>BATCH_STUDIO_MANIFEST_PATH</code>
              </span>
              <input
                value={settings.manifestPath}
                onChange={(e) => setField('manifestPath', e.target.value)}
                placeholder="空欄 = 内蔵"
              />
            </label>
          </div>
          <p className="hint">
            新規プロジェクトでは Project root が作成先の既定値になります。成果物配置 root
            を設定すると、プロジェクト作成時に <code>{'<成果物配置 root>/<projectId>'}</code>{' '}
            フォルダーを作成します。
          </p>
          <p className="hint">
            ローカル実行は Local ComfyUI の <code>models</code> 配下を確認します。リモート実行では
            Remote ComfyUI のインストール先を必須とし、SSH接続後にその <code>models</code>{' '}
            配下へR2から安全にstagingします。
          </p>
          {status?.configured && (
            <div className="facts">
              <div>
                ComfyUI <code>{status.comfyUiInstallPath}</code>
              </div>
              <div>
                モデル探索先 <code>{status.modelsPath ?? '-'}</code>
              </div>
              <div>
                models <b>{status.modelsExists ? '✓' : '✕'}</b>
              </div>
            </div>
          )}
        </section>

        <section className="environment-section">
          <div className="panelhead">
            <div>
              <h3>Remote 実行 bootstrap</h3>
              <p>
                リモート実行前に aria2 / GitHub CLI、ComfyUI最新release、custom_nodes
                を自動整備します。
              </p>
            </div>
          </div>
          <div className="formgrid">
            <label className="wide">
              <span>
                GitHub PAT <code>BATCH_STUDIO_GITHUB_PAT</code>
              </span>
              <input
                type="password"
                autoComplete="off"
                value={settings.githubPat}
                onChange={(e) => setSettings((prev) => ({ ...prev, githubPat: e.target.value }))}
                placeholder={
                  status?.githubPatConfigured
                    ? '設定済み（変更時のみ入力）'
                    : 'PATを入力、または環境変数で設定'
                }
              />
            </label>
          </div>
          <p className="hint">
            PATはOSの安全な暗号化ストレージへ保存し、画面には再表示しません。環境変数{' '}
            <code>BATCH_STUDIO_GITHUB_PAT</code> または <code>GH_TOKEN</code>{' '}
            がある場合は環境変数を優先します。Remoteでは <code>GH_TOKEN</code>{' '}
            として一時的に使用し、<code>gh auth login</code> の資格情報ファイルは作成しません。現在:{' '}
            <b>
              {status?.githubPatConfigured ? '設定済み (' + status.githubPatSource + ')' : '未設定'}
            </b>
          </p>
          <div className="panelhead">
            <div>
              <h4>Workflow依存 custom_nodes</h4>
              <p>
                必要なGitHubリポジトリだけを追加してください。実行前に未導入ならclone、導入済みなら安全に更新します。
              </p>
            </div>
            <button onClick={addCustomNode}>custom_nodeを追加</button>
          </div>
          {settings.remoteCustomNodes.length === 0 ? (
            <p className="hint">custom_node は未設定です。</p>
          ) : (
            <div className="table">
              {settings.remoteCustomNodes.map((node, index) => (
                <div className="tablerow" key={index}>
                  <input
                    aria-label={'custom node repository ' + (index + 1)}
                    value={node.repository}
                    onChange={(e) => updateCustomNode(index, { repository: e.target.value })}
                    placeholder="owner/repository または https://github.com/owner/repository"
                  />
                  <input
                    aria-label={'custom node ref ' + (index + 1)}
                    value={node.ref ?? ''}
                    onChange={(e) => updateCustomNode(index, { ref: e.target.value })}
                    placeholder="ref（任意: branch / tag / SHA）"
                  />
                  <button className="danger" onClick={() => removeCustomNode(index)}>
                    削除
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="hint">
            同じリポジトリ名の重複は保存時に拒否します。Remote上に追跡済みのローカル変更があるComfyUI/custom_nodeは自動破棄せず、bootstrapを停止してエラーにします。
          </p>
        </section>

        <div className="actions environment-actions">
          <button onClick={onClose}>キャンセル</button>
          <button className="primary" onClick={() => void save()}>
            環境設定を保存
          </button>
        </div>
      </div>
    </div>
  );
}
