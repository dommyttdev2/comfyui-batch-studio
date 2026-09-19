import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CodexAccountStatus,
  CodexContext,
  CodexMessage,
  CodexSnapshot,
  GrokTask,
} from '../shared/types';
import './codex-pane.css';

const stageTasks: Record<
  CodexContext['stage'],
  Array<{ value: GrokTask['stage']; label: string }>
> = {
  story: [
    { value: 'story-initial', label: 'ストーリーを検討' },
    { value: 'story-finalize', label: 'story.mdを作成' },
    { value: 'story-fix', label: 'ストーリーを修正' },
  ],
  models: [
    { value: 'models', label: 'LoRAを選定' },
    { value: 'models-fix', label: 'LoRAを再選定' },
  ],
  'prompt-plan': [
    { value: 'prompt-plan', label: 'Prompt Planを作成' },
    { value: 'prompt-plan-fix', label: 'Prompt Planを修正' },
  ],
  caption: [{ value: 'caption', label: 'キャプションを作成' }],
};
const stageTitles: Record<CodexContext['stage'], string> = {
  story: 'ストーリー',
  models: 'LoRA選定',
  'prompt-plan': 'プロンプト設計',
  caption: 'キャプション',
};
function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function CodexPane() {
  const [context, setContext] = useState<CodexContext | null>(null);
  const [account, setAccount] = useState<CodexAccountStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CodexSnapshot | null>(null);
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [stream, setStream] = useState('');
  const [input, setInput] = useState('');
  const [extra, setExtra] = useState('');
  const [task, setTask] = useState<GrokTask['stage']>('story-finalize');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const currentContext = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshAccount = useCallback(async () => {
    setAccount(await window.batchStudio.codex.status());
  }, []);
  const refresh = useCallback(async (key: string) => {
    const value = await window.batchStudio.codex.snapshot();
    if (currentContext.current !== key) return;
    setSnapshot(value);
    setMessages(value.messages);
  }, []);
  const switchContext = useCallback(
    async (next: CodexContext | null) => {
      const key = next ? next.root + '\0' + next.stage : '';
      currentContext.current = key;
      setContext(next);
      setSnapshot(null);
      setMessages([]);
      setStream('');
      setError('');
      setBusy(false);
      if (!next) return;
      setTask(stageTasks[next.stage][0].value);
      setLoading(true);
      try {
        await refresh(key);
        await refreshAccount();
      } catch (err) {
        if (currentContext.current === key) setError(errorText(err));
      } finally {
        if (currentContext.current === key) setLoading(false);
      }
    },
    [refresh, refreshAccount],
  );

  useEffect(() => {
    const offContext = window.batchStudio.codex.onContext((next) => {
      void switchContext(next);
    });
    const offEvent = window.batchStudio.codex.onEvent((event) => {
      if (event.method === 'account/updated' || event.method === 'account/login/completed') {
        void refreshAccount().catch((err) => setError(errorText(err)));
        return;
      }
      if (event.method === 'disconnected') {
        setBusy(false);
        setError(String(event.params.message ?? 'Codexとの接続が切れました。'));
        return;
      }
      if (event.method === 'turn/started') setBusy(true);
      if (event.method === 'item/agentMessage/delta' && typeof event.params.delta === 'string')
        setStream((text) => text + event.params.delta);
      if (event.method === 'turn/completed') {
        setBusy(false);
        const key = currentContext.current;
        void refresh(key)
          .then(() => {
            if (currentContext.current === key) setStream('');
          })
          .catch((err) => {
            if (currentContext.current === key) setError(errorText(err));
          });
      }
    });
    void window.batchStudio.codex
      .context()
      .then((next) => switchContext(next))
      .catch((err) => setError(errorText(err)));
    return () => {
      offContext();
      offEvent();
    };
  }, [refresh, refreshAccount, switchContext]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, stream]);

  const send = async (request: () => Promise<void>, text: string) => {
    const key = currentContext.current;
    setError('');
    setBusy(true);
    setStream('');
    setMessages((before) => [...before, { id: 'pending-' + Date.now(), role: 'user', text }]);
    try {
      await request();
      if (key === currentContext.current) {
        setInput('');
        setExtra('');
        // A fresh thread gets its ID only after the first turn starts.
        const current = await window.batchStudio.codex.snapshot();
        if (key === currentContext.current) setSnapshot(current);
      }
    } catch (err) {
      if (key === currentContext.current) {
        setBusy(false);
        setError(errorText(err));
        void refresh(key).catch(() => {});
      }
    }
  };

  const selectChat = async (threadId: string) => {
    setError('');
    setLoading(true);
    const key = currentContext.current;
    try {
      const next = threadId
        ? await window.batchStudio.codex.restoreChat(threadId)
        : await window.batchStudio.codex.newChat();
      if (key === currentContext.current) {
        setSnapshot(next);
        setMessages(next.messages);
        setStream('');
      }
    } catch (err) {
      if (key === currentContext.current) setError(errorText(err));
    } finally {
      if (key === currentContext.current) setLoading(false);
    }
  };
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const output = latestAssistant?.text ?? stream;

  return (
    <main className="codex-pane">
      <header className="codex-heading">
        <div>
          <strong>Codex</strong>
          <small>{context ? stageTitles[context.stage] : '工程を選択してください'}</small>
        </div>
        <div className="codex-account">
          <small>
            {account?.authenticated
              ? 'ChatGPT' + (account.planType ? ' · ' + account.planType : '')
              : account?.authMode === 'apikey'
                ? 'APIキー認証中（送信は無効）'
                : '未ログイン'}
          </small>
          {!account?.authenticated && (
            <button
              onClick={() =>
                void window.batchStudio.codex.signIn().catch((err) => setError(errorText(err)))
              }
            >
              ChatGPTでログイン
            </button>
          )}
        </div>
      </header>
      {context && (
        <section className="codex-history">
          <label htmlFor="codex-chat-history">この工程の会話履歴</label>
          <select
            id="codex-chat-history"
            value={snapshot?.activeThreadId ?? ''}
            disabled={loading || busy}
            onChange={(event) => void selectChat(event.target.value)}
          >
            <option value="">新しいチャット</option>
            {snapshot?.threadIds.map((id, index) => (
              <option key={id} value={id}>
                {index + 1}. {id.slice(0, 8)}…
              </option>
            ))}
          </select>
          <button disabled={loading || busy} onClick={() => void selectChat('')}>
            新しいチャット
          </button>
        </section>
      )}
      {error && (
        <div className="codex-error" role="alert">
          {error}
        </div>
      )}
      <div className="codex-messages" ref={scrollRef} role="log" aria-live="polite">
        {loading && <p>会話履歴を復元しています…</p>}
        {!context && <p>企画工程を開くと、対応するチャットを表示します。</p>}
        {context && !loading && messages.length === 0 && !stream && (
          <p>この工程のチャットを開始できます。以前の会話は上の履歴から復元できます。</p>
        )}
        {messages.map((message) => (
          <article key={message.id} className={'codex-message ' + message.role}>
            <strong>{message.role === 'user' ? 'あなた' : 'Codex'}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        {stream && (
          <article className="codex-message assistant">
            <strong>Codex · 回答中</strong>
            <p>{stream}</p>
          </article>
        )}
        {busy && <p className="codex-processing">Codexが回答を生成しています…</p>}
      </div>
      {context && (
        <section className="codex-compose">
          <div className="codex-task">
            <select
              value={task}
              onChange={(event) => setTask(event.target.value as GrokTask['stage'])}
              disabled={loading || busy}
            >
              {stageTasks[context.stage].map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            <button
              disabled={loading || busy || !account?.authenticated}
              onClick={() =>
                void send(
                  () => window.batchStudio.codex.sendTask(task, extra),
                  '工程の依頼: ' +
                    stageTasks[context.stage].find((value) => value.value === task)?.label +
                    (extra ? '\n' + extra : ''),
                )
              }
            >
              工程用の依頼を送信
            </button>
          </div>
          <textarea
            value={extra}
            rows={2}
            placeholder="工程への追加指示（任意）"
            disabled={loading || busy}
            onChange={(event) => setExtra(event.target.value)}
          />
          <textarea
            value={input}
            rows={3}
            placeholder="Codexへメッセージを送信"
            disabled={loading || busy}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="codex-actions">
            <button
              className="primary"
              disabled={loading || busy || !input.trim() || !account?.authenticated}
              onClick={() => void send(() => window.batchStudio.codex.send(input), input)}
            >
              送信
            </button>
            <button
              disabled={!output || busy}
              onClick={() =>
                void window.batchStudio.codex
                  .saveResponse(output)
                  .catch((err) => setError(errorText(err)))
              }
            >
              回答をファイル保存して取り込む
            </button>
          </div>
          <small>
            保存したファイルは左側の工程画面で検証し、下書きへ取り込んでください。確定済みファイルはCodexから変更できません。
          </small>
        </section>
      )}
    </main>
  );
}
