import { useEffect, useState, useSyncExternalStore } from 'react';
import { assistant as a, tasks } from './assistant';
import { Dialog } from './modal';
import { type Tab, workspace as w } from './workspace';
export function AssistantPane({ tab }: { tab: Tab }) {
  useSyncExternalStore(a.subscribe, a.snapshot);
  const s = a.state(tab),
    busy = a.busy(s),
    supported = !!tasks[s.stage];
  const [discard, setDiscard] = useState<string | null>(null);
  useEffect(() => {
    void a.load(s);
    setDiscard(null);
  }, [s]);
  const change = (work: () => void) => {
    work();
    a.emit();
  };
  return (
    <aside className="assistant">
      <h2>Assistant</h2>
      <label>
        Provider
        <select
          value={tab.provider}
          onChange={(e) => {
            tab.provider = e.target.value;
            w.emit();
          }}
        >
          <option value="codex">Codex</option>
          <option value="grok">Grok</option>
        </select>
      </label>
      <label>
        Pane幅
        <input
          type="range"
          min="20"
          max="40"
          value={tab.pane}
          onChange={(e) => {
            tab.pane = Number(e.target.value);
            w.emit();
          }}
        />
      </label>
      {!supported ? (
        <p>この工程にはCLI操作がありません。</p>
      ) : (
        <>
          <p role="status">
            {s.loading
              ? 'CLI確認中'
              : s.availability?.state === 'available'
                ? 'CLI利用可能'
                : 'CLI利用不可'}
          </p>
          {s.error && (
            <p className="error" role="alert">
              {s.error}
            </p>
          )}
          <label>
            AIモデル
            <select
              disabled={busy || !s.models.length}
              value={s.model}
              onChange={(e) =>
                change(() => {
                  s.model = e.target.value;
                  s.effort = '';
                })
              }
            >
              <option value="">CLIの既定モデル</option>
              {s.models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            推論強度
            <select
              disabled={busy}
              value={s.effort}
              onChange={(e) =>
                change(() => {
                  s.effort = e.target.value;
                })
              }
            >
              <option value="">既定</option>
              {s.models
                .find((m) => m.id === (s.model || s.defaultModel))
                ?.supportedReasoningEfforts?.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={busy || !s.models.length || !tab.project.lease?.ownedByCurrentSession}
            onClick={() =>
              void a.saveModel(s).catch((e) =>
                change(() => {
                  s.error = e.message;
                }),
              )
            }
          >
            モデル設定を保存
          </button>
          <label>
            会話履歴
            <select
              disabled={busy}
              value={s.history.activeConversationId ?? ''}
              onChange={(e) =>
                void a.mutate(s, 'conversations/restore', { conversationId: e.target.value })
              }
            >
              <option value="">会話を選択</option>
              {s.history.conversations.map((c, i) => (
                <option key={c.id} value={c.id} disabled={!c.resumable}>
                  会話 {i + 1} ({c.messageCount})
                </option>
              ))}
            </select>
          </label>
          <button disabled={busy} onClick={() => void a.mutate(s, 'conversations/new', {})}>
            新規会話
          </button>
          <div aria-label="Assistant会話" className="assistant-messages">
            {s.history.messages.map((m) => (
              <div key={m.id}>
                <strong>{m.role === 'user' ? 'あなた' : 'Assistant'}</strong>
                <pre>{m.text}</pre>
              </div>
            ))}
          </div>
        </>
      )}
      <textarea
        aria-label="Assistant入力"
        value={s.input}
        onChange={(e) =>
          change(() => {
            s.input = e.target.value;
          })
        }
      />
      <button
        disabled={!supported || busy || !s.input.trim() || s.availability?.state !== 'available'}
        onClick={() => void a.start(s, false)}
      >
        送信
      </button>
      {supported && (
        <>
          <label>
            工程タスク
            <select
              aria-label="工程タスク"
              disabled={busy}
              value={s.task}
              onChange={(e) =>
                change(() => {
                  s.task = e.target.value;
                })
              }
            >
              {tasks[s.stage].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <textarea
            aria-label="工程タスクの追加指示"
            value={s.extra}
            onChange={(e) =>
              change(() => {
                s.extra = e.target.value;
              })
            }
          />
          <button
            disabled={busy || s.availability?.state !== 'available'}
            onClick={() => void a.start(s, true)}
          >
            工程タスクを実行
          </button>
          {s.pending && (
            <button disabled={s.sending} onClick={() => void a.mutate(s, '', {})}>
              同じリクエストを再確認
            </button>
          )}
          {a.jobs(s).map((j) => (
            <div key={j.id} className="assistant-job">
              <span>{j.state}</span>
              {['reserved', 'running'].includes(j.state) && (
                <button
                  disabled={s.sending || !!s.pending}
                  onClick={() => void a.mutate(s, 'jobs/' + j.id + '/stop', {})}
                >
                  停止
                </button>
              )}
              {j.state === 'uncertain' && (
                <>
                  <button
                    disabled={s.sending || !!s.pending}
                    onClick={() => void a.mutate(s, 'jobs/' + j.id + '/reconcile', {})}
                  >
                    実行結果を照合
                  </button>
                  <button disabled={s.sending || !!s.pending} onClick={() => setDiscard(j.id)}>
                    未確定結果を破棄
                  </button>
                </>
              )}
              {s.history.records
                .filter((r) => r.jobId === j.id)
                .map((r) => (
                  <span key={r.jobId}>
                    {r.imported
                      ? '下書きへ取り込み済み'
                      : r.importError
                        ? '取り込み失敗: ' + r.importError
                        : ''}
                    {r.artifact && !r.imported && ['succeeded', 'failed'].includes(j.state) ? (
                      <button
                        disabled={s.sending || !!s.pending}
                        onClick={() => void a.mutate(s, 'jobs/' + j.id + '/import', {})}
                      >
                        成果物を再取り込み
                      </button>
                    ) : null}
                  </span>
                ))}
            </div>
          ))}
        </>
      )}
      {discard && (
        <Dialog title="未確定結果の破棄" onClose={() => setDiscard(null)}>
          <p>実行を停止し、未確定の成果物を破棄します。再実行は行いません。</p>
          <button
            onClick={() => {
              const id = discard;
              setDiscard(null);
              void a.mutate(s, 'jobs/' + id + '/abandon', {
                acknowledge: 'discard-unknown-result',
              });
            }}
          >
            停止して破棄
          </button>
        </Dialog>
      )}
    </aside>
  );
}
