import { useState } from 'react';
import { CivitExplorerStage } from './CivitExplorerStage';
import { R2ManagerStage } from './R2ManagerStage';
import { MarketplaceImagePickerWindow } from './MarketplaceImagePickerWindow';
import { ThumbnailPickerWindow } from './ThumbnailPickerWindow';
import { VastAiIntegrationPanel } from './integrations/VastAiIntegrationPanel';
import type { Runner } from './ui';

export type StandaloneWindowTool =
  | 'r2'
  | 'civit'
  | 'vastai'
  | 'thumbnail-picker'
  | 'marketplace-picker';

export function standaloneToolFromSearch(search: string): StandaloneWindowTool | null {
  const tool = new URLSearchParams(search).get('tool');
  return tool === 'r2' ||
    tool === 'civit' ||
    tool === 'vastai' ||
    tool === 'thumbnail-picker' ||
    tool === 'marketplace-picker'
    ? tool
    : null;
}

export function StandaloneToolApp({ tool }: { tool: StandaloneWindowTool }) {
  const [error, setError] = useState('');
  if (tool === 'thumbnail-picker') return <ThumbnailPickerWindow />;
  if (tool === 'marketplace-picker') return <MarketplaceImagePickerWindow />;
  const run: Runner = async (fn) => {
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    }
  };
  const title = tool === 'r2' ? 'R2 File Manager' : tool === 'civit' ? 'Civit Explorer' : 'Vast.ai';
  return (
    <main className="shell">
      <header className="top">
        <div>
          <span className="eyebrow">ComfyUI Batch Studio</span>
          <h1>{title}</h1>
          <small>専用ウィンドウ</small>
        </div>
      </header>
      {error && <div className="errorbar">{error}</div>}
      <div className="body" style={{ gridTemplateColumns: 'minmax(0,1fr)' }}>
        <section className="workspace">
          {tool === 'r2' ? (
            <R2ManagerStage run={run} />
          ) : tool === 'civit' ? (
            <CivitExplorerStage run={run} />
          ) : (
            <VastAiIntegrationPanel run={run} onStatus={() => {}} />
          )}
        </section>
      </div>
    </main>
  );
}
