import { AssistantPane } from './assistant-pane';
import { Dialog, ModalHost } from './modal';
import { useState, useSyncExternalStore, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { api } from './api';
import { workspace as w, artifactKeys } from './workspace';
import './workspace.css';
const labels: Record<string, string> = {
  brief: '基本設定',
  story: 'ストーリー',
  models: 'モデル',
  promptPlan: 'Prompt Plan',
  workflow: 'Workflow',
  caption: 'Caption',
  thumbnail: 'Thumbnail',
  marketplace: 'Marketplace',
};
function App() {
  useSyncExternalStore(w.subscribe, w.snapshot);
  const [token, setToken] = useState('');
  const [user, setUser] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [root, setRoot] = useState('');
  const [jobs, setJobs] = useState(false);
  const [reset, setReset] = useState<{
    id: string;
    key: string;
    confirmationId: string;
    revision: number;
    generation: string;
    leaseId: string;
  } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const tab = w.tabs.find((t) => t.id === w.selected);
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    api.onInvalidSession = () => {
      w.suspend();
      setUser('');
      setError('認証が失効しました。再ログインしてください。');
    };
    return () => {
      api.onInvalidSession = () => {};
      w.suspend();
    };
  }, []);
  useEffect(() => {
    if (editor.current && tab) editor.current.scrollTop = tab.scroll;
  }, [tab?.id, tab?.key]);
  const login = () =>
    run(async () => {
      await api.login(token);
      setToken('');
      setUser(api.userId);
      await w.initialize();
    });
  const save = () => tab && run(() => w.flush(tab.id));
  const resetPrepare = () =>
    tab &&
    run(async () => {
      await w.flush(tab.id);
      const t = w.tabs.find((x) => x.id === tab.id)!;
      const v = await api.request<{ confirmation: { id: string } }>(
        '/projects/' + t.id + '/commands/prepare-reset',
        {
          expectedRevision: t.project.revision,
          leaseId: t.project.lease?.leaseId,
          target: t.key,
          stage: false,
        },
      );
      setReset({
        id: t.id,
        key: t.key,
        revision: t.project.revision,
        generation: t.generation,
        leaseId: t.project.lease?.leaseId ?? '',
        confirmationId: v.confirmation.id,
      });
    });
  return (
    <>
      <header>
        <div>
          <strong>Batch Studio</strong>
          <small>Project Workspace</small>
        </div>
        {user && (
          <div>
            {user}{' '}
            <button
              onClick={() =>
                void run(async () => {
                  await w.logout();
                  setUser('');
                })
              }
            >
              ログアウト
            </button>
          </div>
        )}
      </header>
      {!user ? (
        <main className="login">
          <h1>Workspaceにログイン</h1>
          <p>登録済みのアクセストークンを入力してください。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void login();
            }}
          >
            <label>
              アクセストークン
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <button disabled={busy}>ログイン</button>
          </form>
          {error && <p role="alert">{error}</p>}
        </main>
      ) : (
        <>
          <nav className="tabs" aria-label="Projectタブ">
            <button
              role="tab"
              aria-selected={w.selected === 'home'}
              disabled={busy}
              onClick={() => void run(() => w.select('home'))}
            >
              Home
            </button>
            {w.tabs.map((t) => (
              <div key={t.generation} className="tab-item">
                <button
                  role="tab"
                  aria-selected={w.selected === t.id}
                  disabled={busy}
                  onClick={() => void run(() => w.select(t.id))}
                >
                  {t.name}
                  {Object.keys(t.dirty).length ? ' ●' : ''}
                  {[...w.jobs.values()].some(
                    (j) =>
                      j.projectId === t.id &&
                      ['running', 'reserved', 'cancelling'].includes(j.state),
                  )
                    ? ' 処理中'
                    : ''}
                </button>
                <button aria-label={t.name + 'を左へ'} onClick={() => w.move(t.id, -1)}>
                  ‹
                </button>
                <button aria-label={t.name + 'を右へ'} onClick={() => w.move(t.id, 1)}>
                  ›
                </button>
                <button
                  aria-label={t.name + 'を閉じる'}
                  disabled={busy}
                  onClick={() => void run(() => w.close(t.id))}
                >
                  ×
                </button>
              </div>
            ))}
            <button onClick={() => setJobs(!jobs)}>全ジョブ</button>
            <button
              id="tools-button"
              onClick={() => window.dispatchEvent(new Event('workspace:tools'))}
            >
              ツール
            </button>
          </nav>
          {error && (
            <div className="notice" role="alert">
              {error}
              {tab && (
                <button onClick={() => void run(() => w.close(tab.id, true))}>
                  下書きを破棄して閉じる
                </button>
              )}
              {error === 'BUILD_MISMATCH' && (
                <button onClick={() => location.reload()}>再読込</button>
              )}
            </div>
          )}
          {w.error && <p role="alert">{w.error}</p>}
          {w.eventStatus && (
            <div className="notice" role="status">
              {w.eventStatus}
              <button onClick={() => api.reconnect()}>再接続</button>
              <button onClick={() => api.reconnect(true)}>状態を再同期</button>
            </div>
          )}
          {jobs && (
            <section className="job-list">
              <h2>全ジョブ</h2>
              <p>タブを閉じても処理は継続します。</p>
              {[...w.jobs.values()].map((j) => (
                <div key={j.id}>
                  {j.kind} — {j.state}{' '}
                  <button onClick={() => void run(() => w.open(j.projectId))}>Projectを開く</button>
                </div>
              ))}
            </section>
          )}
          {w.selected === 'home' ? (
            <main>
              <h1>Projects</h1>
              <p>ひとつの画面で複数のProjectを切り替えます。</p>
              <div className="project-list">
                {w.projects.map((p) => (
                  <button key={p.id} onClick={() => void run(() => w.open(p.id))}>
                    {p.displayName}
                  </button>
                ))}
              </div>
              <section>
                <h2>新しいProject</h2>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const v = await api.request<{ project: { id: string } }>('/projects', {
                        rootId: root || w.roots[0]?.id,
                        directoryName: name,
                        displayName: name,
                      });
                      localStorage.setItem('workspace:last:' + user, v.project.id);
                      w.suspend();
                      setUser('');
                      setError('Projectを作成しました。権限更新のため再ログインしてください。');
                    });
                  }}
                >
                  <label>
                    作成先
                    <select
                      aria-label="作成先"
                      value={root || w.roots[0]?.id || ''}
                      onChange={(e) => setRoot(e.target.value)}
                    >
                      {w.roots.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Project名
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      maxLength={64}
                    />
                  </label>
                  <button disabled={busy || !w.roots.length}>Projectを作成</button>
                </form>
                {!w.roots.length && (
                  <p>登録済みの作成先がありません。管理者による登録が必要です。</p>
                )}
              </section>
            </main>
          ) : (
            tab && (
              <main
                className="project-view"
                style={{ gridTemplateColumns: '160px minmax(260px,1fr) ' + tab.pane + '%' }}
              >
                <aside className="stages" aria-label="工程">
                  {artifactKeys.map((key) => (
                    <button
                      key={key}
                      aria-pressed={tab.key === key}
                      onClick={() => void run(() => w.stage(tab.id, key))}
                    >
                      {labels[key]}
                    </button>
                  ))}
                </aside>
                <section className="editor-panel">
                  <div className="section-heading">
                    <h1>
                      {tab.name} / {labels[tab.key]}
                    </h1>
                    <span>revision {tab.project.revision}</span>
                  </div>
                  {tab.error && <p role="alert">{tab.error}</p>}
                  {!tab.project.lease?.ownedByCurrentSession && (
                    <p>
                      編集leaseを取得できません。
                      <button onClick={() => void run(() => w.action(tab.id, 'acquire-lease'))}>
                        編集権を取得
                      </button>
                    </p>
                  )}
                  {tab.recovery.map((r) => (
                    <div key={r.id} className="notice">
                      <p>
                        未送信下書き: {labels[r.key]}{' '}
                        {r.baseRevision !== tab.baseRevision
                          ? '— revisionが異なります。内容を比較してください。'
                          : ''}
                      </p>
                      <pre>{r.content}</pre>
                      <button
                        disabled={r.baseRevision !== tab.baseRevision}
                        onClick={() => void run(() => w.restore(tab.id, r))}
                      >
                        下書きを復元
                      </button>
                      <button onClick={() => void run(() => w.discardRecovery(tab.id, r))}>
                        回復下書きを破棄
                      </button>
                    </div>
                  ))}
                  <label className="editor-label">
                    Artifact内容
                    <textarea
                      ref={editor}
                      aria-label="Artifact内容"
                      spellCheck={false}
                      disabled={
                        !tab.project.lease?.ownedByCurrentSession ||
                        busy ||
                        ['thumbnail', 'marketplace'].includes(tab.key)
                      }
                      value={
                        tab.dirty[tab.key] ??
                        tab.project.drafts[tab.key]?.content ??
                        tab.project.artifacts[tab.key]?.content ??
                        ''
                      }
                      onChange={(e) => {
                        void w
                          .edit(tab.id, tab.key, e.target.value)
                          .catch((e) => setError(e.message));
                      }}
                      onScroll={(e) => {
                        tab.scroll = e.currentTarget.scrollTop;
                      }}
                    />
                  </label>
                  <div className="actions">
                    <button
                      disabled={busy || !tab.project.lease?.ownedByCurrentSession}
                      onClick={() => void save()}
                    >
                      下書きを保存
                    </button>
                    <button
                      disabled={busy || !tab.project.lease?.ownedByCurrentSession}
                      onClick={() =>
                        void run(async () => {
                          await w.flush(tab.id);
                          await w.action(tab.id, 'confirm-artifact', { key: tab.key });
                        })
                      }
                    >
                      確定
                    </button>
                    <button
                      disabled={busy || !tab.project.lease?.ownedByCurrentSession}
                      onClick={() => void resetPrepare()}
                    >
                      Reset
                    </button>
                    {tab.key === 'workflow' && (
                      <button
                        disabled={busy || !tab.project.lease?.ownedByCurrentSession}
                        onClick={() =>
                          void run(async () => {
                            await w.flush(tab.id);
                            await w.action(tab.id, 'compile-workflow');
                          })
                        }
                      >
                        Workflowを生成
                      </button>
                    )}
                  </div>
                  <p>
                    {tab.project.drafts[tab.key]?.status ??
                      tab.project.artifacts[tab.key]?.status ??
                      '未作成'}
                  </p>
                  {(tab.project.drafts[tab.key]?.validation.issues ?? []).map((issue, i) => (
                    <p key={i}>
                      {issue.code}: {issue.message}
                    </p>
                  ))}
                  {['thumbnail', 'marketplace'].includes(tab.key) && (
                    <p>画像編集は後続フェーズで利用できます。</p>
                  )}
                </section>
                <AssistantPane tab={tab} />
              </main>
            )
          )}
          {reset && (
            <Dialog title="Artifact Reset確認" onClose={() => setReset(null)}>
              <h2>Resetの確認</h2>
              <p>対象Artifactと下書きを削除し、下流をstaleにします。</p>
              <button onClick={() => setReset(null)}>取消</button>
              <button
                onClick={() =>
                  void run(async () => {
                    const t = w.tabs.find((t) => t.id === reset.id);
                    if (
                      !t ||
                      t.project.revision !== reset.revision ||
                      t.generation !== reset.generation ||
                      t.project.lease?.leaseId !== reset.leaseId
                    )
                      throw Error('TARGET_CHANGED');
                    await w.action(reset.id, 'reset-artifact', {
                      key: reset.key,
                      confirmationId: reset.confirmationId,
                    });
                    setReset(null);
                  })
                }
              >
                Resetを実行
              </button>
              {error && <p role="alert">{error}</p>}
            </Dialog>
          )}
        </>
      )}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <>
    <App />
    <ModalHost />
  </>,
);
