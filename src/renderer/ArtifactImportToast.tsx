import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AssistantPaneProvider, GrokTask, ImportResult } from '../shared/types';

export interface ImportNoticeInput {
  root: string;
  stage: GrokTask['stage'];
  provider: AssistantPaneProvider;
  fileName: string;
  summary?: ImportResult['summary'];
}

export interface ImportNotice extends ImportNoticeInput {
  id: number;
}

export const ImportNoticeContext = createContext<(notice: ImportNoticeInput) => Promise<void>>(
  async () => {},
);

export function useImportNotice() {
  return useContext(ImportNoticeContext);
}

const stageLabels: Partial<Record<GrokTask['stage'], string>> = {
  'story-finalize': 'ストーリー',
  'story-fix': 'ストーリー修正',
  models: 'モデル選定',
  'models-fix': 'モデル再選定',
  'prompt-plan': 'プロンプト設計',
  'prompt-plan-fix': 'プロンプト設計の修正',
  'prompt-plan-patch': 'プロンプト設計の部分修正',
  caption: 'キャプション',
};

function summaryLabel(summary?: ImportResult['summary']) {
  if (typeof summary?.loras === 'number') return 'LoRA ' + summary.loras + '件';
  if (typeof summary?.images === 'number') return '計画画像 ' + summary.images + '枚';
  return null;
}

function ImportToast({
  notice,
  onDismiss,
}: {
  notice: ImportNotice;
  onDismiss: (id: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  useEffect(() => {
    if (hovered) return;
    const timer = window.setTimeout(() => dismissRef.current(notice.id), 5000);
    return () => window.clearTimeout(timer);
  }, [notice.id, hovered]);
  const count = summaryLabel(notice.summary);
  return (
    <section
      className="import-toast"
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="import-toast-heading">
        <strong>✓ 取り込み完了</strong>
        <button
          type="button"
          aria-label="取り込み通知を閉じる"
          onClick={() => onDismiss(notice.id)}
        >
          ×
        </button>
      </div>
      <p>{stageLabels[notice.stage] ?? '成果物'}を取り込みました</p>
      <small>{notice.fileName}</small>
      <div className="import-toast-meta">
        <span>取り込み元: {notice.provider === 'codex' ? 'Codex' : 'Grok'}</span>
        {count && <span>{count}</span>}
      </div>
      <span className="import-toast-draft">下書きに保存しました（未確定）</span>
    </section>
  );
}

export function ImportToastStack({
  notices,
  onDismiss,
}: {
  notices: ImportNotice[];
  onDismiss: (id: number) => void;
}) {
  if (!notices.length) return null;
  return (
    <div className="import-toast-stack">
      {notices.map((notice) => (
        <ImportToast key={notice.id} notice={notice} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
