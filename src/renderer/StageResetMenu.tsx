import { useState } from 'react';
import './stage-reset.css';

export type ResetScope =
  | 'story'
  | 'base-models'
  | 'models'
  | 'models-fix'
  | 'prompt-plan'
  | 'workflow';

type ResetCopy = { title: string; keep: string[]; reset: string[]; note?: string };

function resetRecoveryHint(message: string) {
  if (/run|execution|実行中|生成中/i.test(message)) {
    return '実行中のRunを停止または完了させてから、再試行してください。';
  }
  if (/eacces|eperm|permission|access denied|権限|書き込み/i.test(message)) {
    return 'プロジェクトフォルダーへの書き込み権限や、他アプリによるファイルロックを確認してから再試行してください。';
  }
  if (/json|parse|invalid|破損|形式/i.test(message)) {
    return '対象ファイルの内容を確認・復旧してから再試行してください。退避済みデータは history/downstream-reset に保持されます。';
  }
  return '表示された原因を解消して「再試行」を押すか、「キャンセル」でこの操作を中止してください。';
}
const COPY: Record<ResetScope, ResetCopy> = {
  story: {
    title: 'ストーリーからリセット',
    keep: ['基本設定'],
    reset: [
      'story.md（下書き・確定版）',
      'モデル選定 / LoRA選定・再選定',
      'Prompt Plan',
      '生成済みWorkflow',
    ],
  },
  'base-models': {
    title: '基盤モデル選択からリセット',
    keep: ['基本設定', 'ストーリー'],
    reset: [
      'Model系統 / Checkpoint / Text Encoder / VAE',
      'GrokのLoRA選定・再選定',
      'Prompt Plan',
      '生成済みWorkflow',
    ],
  },
  models: {
    title: 'GrokでLoRAを選定 からリセット',
    keep: ['基本設定', 'ストーリー', '基盤モデル選択'],
    reset: ['選定1', 'LoRA再選定履歴', 'Prompt Plan', '生成済みWorkflow'],
    note: 'Checkpoint / Text Encoder / VAE は保持されます。',
  },
  'models-fix': {
    title: 'LoRAを再選定 からリセット',
    keep: ['基本設定', 'ストーリー', '基盤モデル選択', 'Grok選定LoRA · 選定1'],
    reset: ['LoRA再選定履歴', 'Prompt Plan', '生成済みWorkflow'],
    note: '現在のLoRA構成は最新の「選定1」へ戻します。',
  },
  'prompt-plan': {
    title: 'Prompt Planからリセット',
    keep: ['ストーリー', 'モデル選定 / LoRA選定'],
    reset: ['Prompt Plan（下書き・確定版）', 'Prompt PlanのGrok返却履歴', '生成済みWorkflow'],
  },
  workflow: {
    title: 'Workflowからリセット',
    keep: ['ストーリー', 'モデル選定 / LoRA選定', 'Prompt Plan'],
    reset: ['生成済みWorkflow', 'Workflow Build情報'],
  },
};

export function StageResetMenu({
  scope,
  onReset,
}: {
  scope: ResetScope;
  onReset: (scope: ResetScope) => Promise<void>;
}) {
  const [menu, setMenu] = useState(false),
    [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [resetError, setResetError] = useState('');
  const copy = COPY[scope];
  const execute = async () => {
    if (busy) return;
    setResetError('');
    setBusy(true);
    try {
      await onReset(scope);
      setConfirming(false);
      setMenu(false);
    } catch (cause) {
      setResetError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="stage-reset-menu">
        <button
          type="button"
          className="stage-reset-trigger"
          aria-label={`${copy.title}のメニュー`}
          aria-expanded={menu}
          onClick={() => setMenu((v) => !v)}
        >
          ︙
        </button>
        {menu && (
          <div className="stage-reset-popover">
            <button
              type="button"
              onClick={() => {
                setResetError('');
                setConfirming(true);
                setMenu(false);
              }}
            >
              この工程からリセット
            </button>
          </div>
        )}
      </div>
      {confirming && (
        <div
          className="modal stage-reset-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`reset-title-${scope}`}
        >
          <div className="modalcard">
            <h2 id={`reset-title-${scope}`}>{copy.title}</h2>
            <p>この工程と、それより後の成果物をリセットします。</p>
            <div className="stage-reset-summary">
              <section>
                <h3>保持されます</h3>
                <ul>
                  {copy.keep.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>リセットされます</h3>
                <ul>
                  {copy.reset.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>
            </div>
            {copy.note && <p className="stage-reset-note">{copy.note}</p>}
            {resetError && (
              <div className="stage-reset-error" role="alert" aria-live="assertive">
                <strong>リセットできませんでした</strong>
                <p>{resetError}</p>
                <p>{resetRecoveryHint(resetError)}</p>
              </div>
            )}
            <p className="stage-reset-archive">
              リセット対象は削除せず <code>._batch_studio/history/downstream-reset/</code>{' '}
              に退避します。
            </p>
            <div className="actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setResetError('');
                  setConfirming(false);
                }}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="danger"
                disabled={busy}
                onClick={() => void execute()}
              >
                {busy ? 'リセット中…' : resetError ? '再試行' : 'リセットする'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
