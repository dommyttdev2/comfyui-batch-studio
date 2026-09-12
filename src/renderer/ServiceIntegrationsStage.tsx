import { useEffect, useState } from 'react';
import type {
  CivitaiConnectionStatus,
  R2ConnectionStatus,
  VastAiConnectionStatus,
} from '../shared/types';
import type { Runner } from './ui';
import { R2IntegrationPanel } from './integrations/R2IntegrationPanel';
import { CivitaiIntegrationPanel } from './integrations/CivitaiIntegrationPanel';
import { VastAiIntegrationPanel } from './integrations/VastAiIntegrationPanel';

type Page = 'root' | 'r2' | 'civitai' | 'cloud' | 'vastai';
function statusLabel(configured: boolean, source?: 'saved' | 'environment' | 'none') {
  if (!configured) return '未設定';
  return source === 'environment' ? '環境変数を使用' : '設定済み';
}

export function ServiceIntegrationsStage({
  run,
  onOpenR2,
  onOpenCivit,
}: {
  run: Runner;
  onOpenR2: () => void;
  onOpenCivit: () => void;
}) {
  const [page, setPage] = useState<Page>('root');
  const [r2Status, setR2Status] = useState<R2ConnectionStatus | null>(null),
    [civitaiStatus, setCivitaiStatus] = useState<CivitaiConnectionStatus | null>(null),
    [vastStatus, setVastStatus] = useState<VastAiConnectionStatus | null>(null);
  const refreshStatuses = async () => {
    const [r, c, v] = await Promise.all([
      window.batchStudio.r2.settings(),
      window.batchStudio.civitai.settings(),
      window.batchStudio.vastai.settings(),
    ]);
    setR2Status(r);
    setCivitaiStatus(c);
    setVastStatus(v);
  };
  useEffect(() => {
    void refreshStatuses().catch(() => {});
  }, []);
  const back = () => setPage(page === 'vastai' ? 'cloud' : 'root');
  if (page === 'r2')
    return (
      <R2IntegrationPanel run={run} onBack={back} onOpenManager={onOpenR2} onStatus={setR2Status} />
    );
  if (page === 'civitai')
    return (
      <CivitaiIntegrationPanel
        run={run}
        onBack={back}
        onOpenExplorer={onOpenCivit}
        onStatus={setCivitaiStatus}
      />
    );
  if (page === 'vastai')
    return <VastAiIntegrationPanel run={run} onBack={back} onStatus={setVastStatus} />;
  if (page === 'cloud')
    return (
      <section className="panel service-page">
        <div className="service-page-head">
          <button onClick={back}>← サービス連携</button>
          <div>
            <h3>クラウドインスタンス</h3>
            <p>リモート実行で利用するクラウドサービスを選択します。</p>
          </div>
        </div>
        <div className="service-card-grid">
          <button className="service-card" onClick={() => setPage('vastai')}>
            <div>
              <strong>Vast.ai</strong>
              <span>GPU Cloud</span>
            </div>
            <b className={vastStatus?.configured ? 'ok' : 'muted'}>
              {statusLabel(Boolean(vastStatus?.configured), vastStatus?.source)}
            </b>
            <p>Instance一覧・起動・停止と、リモート実行用SSH設定を管理します。</p>
          </button>
        </div>
      </section>
    );
  return (
    <section className="panel service-page">
      <div className="panelhead">
        <div>
          <h3>サービス連携</h3>
          <p>
            外部サービスの接続情報とクラウドリソースを、プロジェクトとは独立したアプリ共通設定として管理します。
          </p>
        </div>
        <button onClick={() => void run(refreshStatuses)}>状態を更新</button>
      </div>
      <div className="service-card-grid">
        <button className="service-card" onClick={() => setPage('r2')}>
          <div>
            <strong>Cloudflare R2</strong>
            <span>Model / Artifact Storage</span>
          </div>
          <b className={r2Status?.configured || r2Status?.secretConfigured ? 'ok' : 'muted'}>
            {r2Status?.configured
              ? '設定済み'
              : r2Status?.secretConfigured
                ? '環境変数を使用'
                : '未設定'}
          </b>
          <p>API Key、モデル保管先、R2 File Managerへの入口を管理します。</p>
        </button>
        <button className="service-card" onClick={() => setPage('civitai')}>
          <div>
            <strong>Civitai</strong>
            <span>Model Catalog</span>
          </div>
          <b className={civitaiStatus?.configured ? 'ok' : 'muted'}>
            {statusLabel(Boolean(civitaiStatus?.configured), civitaiStatus?.source)}
          </b>
          <p>Collection同期に使うAPI KeyとCivit Explorerへの入口を管理します。</p>
        </button>
        <button className="service-card" onClick={() => setPage('cloud')}>
          <div>
            <strong>クラウドインスタンス</strong>
            <span>Remote Compute</span>
          </div>
          <b className={vastStatus?.configured ? 'ok' : 'muted'}>
            {vastStatus?.configured ? 'Vast.ai 設定済み' : '未設定'}
          </b>
          <p>リモート生成で利用するGPUクラウドプロバイダーを管理します。</p>
        </button>
      </div>
    </section>
  );
}
