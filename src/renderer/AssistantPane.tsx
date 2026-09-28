import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AgentConversationMessage,
  AgentEvent,
  AgentModelSelection,
  AssistantPaneSnapshot,
} from '../shared/types';
import './assistant-pane.css';

type ActivityItem = {
  id: string;
  label: string;
  status: 'running' | 'completed' | 'failed';
  detail?: string;
};

const stageTitles: Record<NonNullable<AssistantPaneSnapshot['context']>['stage'], string> = {
  story: 'ストーリー',
  models: 'LoRA選定',
  'prompt-plan': 'プロンプト設計',
  caption: 'キャプション',
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function providerLabel(snapshot: AssistantPaneSnapshot | null) {
  return snapshot?.context?.provider === 'grok' ? 'Grok' : 'Codex';
}

export function AssistantPane() {
  const [snapshot, setSnapshot] = useState<AssistantPaneSnapshot | null>(null);
  const [messages, setMessages] = useState<AgentConversationMessage[]>([]);
  const [stream, setStream] = useState('');
  const [input, setInput] = useState('');
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextKey = useRef('');

  const refresh = useCallback(async () => {
    const value = await window.batchStudio.assistant.snapshot();
    const key = value.context
      ? value.context.root + '\0' + value.context.stage + '\0' + value.context.provider
      : '';
    contextKey.current = key;
    setSnapshot(value);
    setMessages(value.messages);
    setBusy(value.busy);
    return value;
  }, []);

  const switchContext = useCallback(
    async (context: AssistantPaneSnapshot['context']) => {
      const key = context ? context.root + '\0' + context.stage + '\0' + context.provider : '';
      contextKey.current = key;
      setSnapshot(null);
      setMessages([]);
      setStream('');
      setActivity([]);
      setBusy(false);
      setStopping(false);
      setError('');
      if (!context) return;
      setLoading(true);
      try {
        await refresh();
      } catch (err) {
        if (contextKey.current === key) setError(errorText(err));
      } finally {
        if (contextKey.current === key) setLoading(false);
      }
    },
    [refresh],
  );

  useEffect(() => {
    const offContext = window.batchStudio.assistant.onContext((context) => {
      void switchContext(context);
    });
    const offEvent = window.batchStudio.assistant.onEvent((envelope) => {
      const context = snapshot?.context;
      if (
        !context ||
        envelope.provider !== context.provider ||
        envelope.root !== context.root ||
        envelope.stage !== context.stage
      )
        return;
      const event = envelope.event;
      projectEvent(event);
    });
    void window.batchStudio.assistant
      .context()
      .then((context) => switchContext(context))
      .catch((err) => setError(errorText(err)));
    return () => {
      offContext();
      offEvent();
    };
  }, [snapshot?.context, switchContext]);

  const projectEvent = (event: AgentEvent) => {
    if (event.type === 'turn.started') {
      setBusy(true);
      setStopping(false);
      setStream('');
      setActivity([]);
      return;
    }
    if (event.type === 'message.delta') {
      setStream((value) => value + event.text);
      return;
    }
    if (event.type === 'message.completed') {
      setStream(event.text);
      return;
    }
    if (event.type === 'activity') {
      setActivity((items) => [
        ...items,
        {
          id: `activity-${event.at}-${items.length}`,
          label: event.label,
          detail: event.detail,
          status: 'completed',
        },
      ]);
      return;
    }
    if (event.type === 'tool.started') {
      setActivity((items) => [
        ...items,
        {
          id: `tool-${event.name}-${event.at}`,
          label: event.name,
          status: 'running',
        },
      ]);
      return;
    }
    if (event.type === 'tool.completed') {
      setActivity((items) => {
        const index = [...items]
          .reverse()
          .findIndex((item) => item.label === event.name && item.status === 'running');
        if (index < 0)
          return [
            ...items,
            {
              id: `tool-${event.name}-${event.at}`,
              label: event.name,
              status: event.success ? 'completed' : 'failed',
            },
          ];
        const actualIndex = items.length - 1 - index;
        return items.map((item, itemIndex) =>
          itemIndex === actualIndex
            ? { ...item, status: event.success ? 'completed' : 'failed' }
            : item,
        );
      });
      return;
    }
    if (event.type === 'file.changed' || event.type === 'artifact.ready') {
      const filePath = event.type === 'file.changed' ? event.path : event.path;
      setActivity((items) => [
        ...items,
        {
          id: `file-${event.at}-${items.length}`,
          label: event.type === 'artifact.ready' ? `成果物: ${event.fileName}` : 'ファイル更新',
          detail: filePath,
          status: 'completed',
        },
      ]);
      return;
    }
    if (event.type === 'turn.failed') {
      setBusy(false);
      setStopping(false);
      setError(event.error);
      return;
    }
    if (event.type === 'turn.cancelled') {
      setBusy(false);
      setStopping(false);
      return;
    }
    if (event.type === 'turn.completed') {
      setBusy(false);
      setStopping(false);
      void refresh()
        .then(() => setStream(''))
        .catch((err) => setError(errorText(err)));
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, stream, activity]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError('');
    setBusy(true);
    setStream('');
    setActivity([]);
    setMessages((current) => [
      ...current,
      { id: `pending-${Date.now()}`, role: 'user', text, at: Date.now() },
    ]);
    try {
      await window.batchStudio.assistant.send(text);
      setInput('');
      await refresh();
    } catch (err) {
      setBusy(false);
      setError(errorText(err));
      await refresh().catch(() => {});
    }
  };

  const stop = async () => {
    setStopping(true);
    setError('');
    try {
      await window.batchStudio.assistant.stopTurn();
    } catch (err) {
      setStopping(false);
      setError(errorText(err));
    }
  };

  const selectConversation = async (sessionId: string) => {
    setLoading(true);
    setError('');
    try {
      const value = sessionId
        ? await window.batchStudio.assistant.restoreConversation(sessionId)
        : await window.batchStudio.assistant.newConversation();
      setSnapshot(value);
      setMessages(value.messages);
      setStream('');
      setActivity([]);
      setBusy(value.busy);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const chooseModel = async (selection: AgentModelSelection) => {
    if (busy || modelSaving) return;
    setModelSaving(true);
    setError('');
    try {
      const saved = await window.batchStudio.assistant.selectModel(selection);
      setSnapshot((current) =>
        current?.modelSettings
          ? {
              ...current,
              modelSettings: { ...current.modelSettings, selection: saved },
            }
          : current,
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setModelSaving(false);
    }
  };

  const context = snapshot?.context ?? null;
  const label = providerLabel(snapshot);
  const selectedModel = snapshot?.modelSettings?.models.find(
    (model) => model.id === snapshot.modelSettings?.selection.model,
  );
  const availability = snapshot?.availability;
  const available = availability?.state === 'available';

  return (
    <main className="assistant-pane assistant-pane">
      <header className="assistant-heading">
        <div>
          <strong>{context ? label : 'AI Assistant'}</strong>
          <small>{context ? stageTitles[context.stage] : '工程を選択してください'}</small>
        </div>
        {context && (
          <div className="assistant-account">
            <small>
              {availability
                ? availability.state === 'available'
                  ? `CLI ${availability.version ?? '利用可能'}`
                  : (availability.message ?? availability.state)
                : 'CLI状態を確認中…'}
            </small>
          </div>
        )}
      </header>

      {context && snapshot?.capabilities?.modelSelection && (
        <section className="assistant-runtime" aria-label="AIモデル設定">
          <div className="assistant-model-controls">
            <label>
              使用するモデル
              <select
                aria-label="AIモデル"
                value={snapshot.modelSettings?.selection.model ?? ''}
                disabled={!snapshot.modelSettings || busy || loading || modelSaving}
                onChange={(event) =>
                  void chooseModel({
                    model: event.target.value || null,
                    reasoningEffort: snapshot.modelSettings?.selection.reasoningEffort,
                  })
                }
              >
                {!snapshot.modelSettings && <option value="">モデル一覧を取得できません</option>}
                {snapshot.modelSettings?.models.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>
            {snapshot.capabilities.reasoningEffort &&
            selectedModel?.supportedReasoningEfforts?.length ? (
              <label>
                推論の強度
                <select
                  aria-label="AI推論強度"
                  value={snapshot.modelSettings?.selection.reasoningEffort ?? ''}
                  disabled={busy || loading || modelSaving}
                  onChange={(event) =>
                    void chooseModel({
                      model: snapshot.modelSettings?.selection.model ?? null,
                      reasoningEffort: event.target.value || null,
                    })
                  }
                >
                  {selectedModel.supportedReasoningEfforts.map((effort) => (
                    <option key={effort} value={effort}>
                      {effort}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        </section>
      )}

      {context && (
        <section className="assistant-history">
          <label htmlFor="assistant-chat-history">この工程の会話履歴</label>
          <select
            id="assistant-chat-history"
            value={snapshot?.activeSessionId ?? ''}
            disabled={loading || busy}
            onChange={(event) => void selectConversation(event.target.value)}
          >
            <option value="">新しい会話</option>
            {snapshot?.sessionIds.map((id, index) => (
              <option key={id} value={id}>
                {index + 1}. {id.slice(0, 12)}…
              </option>
            ))}
          </select>
          <button disabled={loading || busy} onClick={() => void selectConversation('')}>
            新しい会話
          </button>
        </section>
      )}

      {error && (
        <div className="assistant-error" role="alert">
          {error}
        </div>
      )}

      <div className="assistant-messages" ref={scrollRef} role="log" aria-live="polite">
        {loading && <p>会話履歴を復元しています…</p>}
        {!context && <p>企画工程を開くと、選択中のAI providerの会話を表示します。</p>}
        {context && !loading && messages.length === 0 && !stream && (
          <p>この工程の{label}会話を開始できます。</p>
        )}
        {messages.map((message) => (
          <article key={message.id} className={'assistant-message ' + message.role}>
            <strong>{message.role === 'user' ? 'あなた' : label}</strong>
            <p>{message.text}</p>
          </article>
        ))}
        {stream && (
          <article className="assistant-message assistant">
            <strong>{label} · 回答中</strong>
            <p>{stream}</p>
          </article>
        )}
        {(activity.length > 0 || busy) && (
          <section className="assistant-activity" aria-label="AIの作業状況">
            <div className="assistant-activity-heading">
              <strong>作業状況</strong>
              {busy && <span>進行中</span>}
            </div>
            {activity.length === 0 ? (
              <p>作業イベントを待っています。</p>
            ) : (
              <ol className="assistant-activity-list">
                {activity.map((item) => (
                  <li key={item.id} className="assistant-activity-item">
                    <div className="assistant-activity-item-heading">
                      <strong>{item.label}</strong>
                      <small>
                        {item.status === 'running'
                          ? '処理中'
                          : item.status === 'completed'
                            ? '完了'
                            : '失敗'}
                      </small>
                    </div>
                    {item.detail && <pre>{item.detail}</pre>}
                  </li>
                ))}
              </ol>
            )}
            <small>providerから受け取った安全なactivity/tool/fileイベントのみを表示します。</small>
          </section>
        )}
      </div>

      {context && (
        <section className="assistant-compose">
          {!available && availability && (
            <div className="assistant-task-disabled-reason" role="status">
              {availability.message ?? `${label} CLIを利用できません。`}
            </div>
          )}
          <textarea
            value={input}
            rows={3}
            placeholder={`${label}へメッセージを送信`}
            disabled={loading || busy || !available}
            onChange={(event) => setInput(event.target.value)}
          />
          <div className="assistant-actions">
            <button
              className="primary"
              disabled={loading || busy || !available || !input.trim()}
              onClick={() => void send()}
            >
              送信
            </button>
            {busy && (
              <button disabled={stopping} onClick={() => void stop()}>
                {stopping ? '中止中…' : '現在の回答を中止'}
              </button>
            )}
            <small>工程成果物の生成・修正・再実行は左側の工程から操作します。</small>
          </div>
        </section>
      )}
    </main>
  );
}
