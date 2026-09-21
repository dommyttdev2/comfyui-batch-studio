import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CodexAccountStatus,
  CodexContext,
  CodexMessage,
  CodexSnapshot,
  CodexModelSettings,
  CodexModelSelection,
  CodexTurnStatus,
  AutoArtifactEvent,
  CodexSendResult,
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
const idleStatus: CodexTurnStatus = {
  phase: 'idle',
  startedAt: null,
  updatedAt: null,
  finishedAt: null,
  error: null,
};
const phaseLabel: Record<CodexTurnStatus['phase'], string> = {
  idle: '待機中',
  sending: '送信中…',
  processing: 'Codexが処理中…',
  streaming: '回答を出力中…',
  completed: '回答完了',
  failed: '処理失敗',
  interrupted: '中断',
  unknown: '終了状態を確認できません',
};
function formatDuration(milliseconds: number) {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes ? minutes + '分' + String(seconds % 60).padStart(2, '0') + '秒' : seconds + '秒';
}

export function CodexPane() {
  const [context, setContext] = useState<CodexContext | null>(null);
  const [account, setAccount] = useState<CodexAccountStatus | null>(null);
  const [snapshot, setSnapshot] = useState<CodexSnapshot | null>(null);
  const [messages, setMessages] = useState<CodexMessage[]>([]);
  const [stream, setStream] = useState('');
  const [autoArtifact, setAutoArtifact] = useState<AutoArtifactEvent | null>(null);
  const artifactTaskRef = useRef(false);
  const [input, setInput] = useState('');
  const [extra, setExtra] = useState('');
  const [task, setTask] = useState<GrokTask['stage']>('story-finalize');
  const [busy, setBusy] = useState(false);
  const [turnStatus, setTurnStatus] = useState<CodexTurnStatus>(idleStatus);
  const [clock, setClock] = useState(Date.now());
  const [modelSettings, setModelSettings] = useState<CodexModelSettings | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const currentContext = useRef('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const refreshAccount = useCallback(async () => {
    const status = await window.batchStudio.codex.status();
    setAccount(status);
    return status;
  }, []);
  const refreshModels = useCallback(async (key: string) => {
    if (!key || currentContext.current !== key) return;
    setModelLoading(true);
    setModelError('');
    try {
      const available = await window.batchStudio.codex.models();
      if (currentContext.current === key) setModelSettings(available);
    } catch (err) {
      if (currentContext.current === key) {
        setModelSettings(null);
        setModelError(errorText(err));
      }
    } finally {
      if (currentContext.current === key) setModelLoading(false);
    }
  }, []);
  const refresh = useCallback(async (key: string) => {
    const value = await window.batchStudio.codex.snapshot();
    if (currentContext.current !== key) return value;
    setSnapshot(value);
    setMessages(value.messages);
    setBusy(value.busy);
    if (value.artifact) setAutoArtifact(value.artifact);
    artifactTaskRef.current = value.busy && value.artifact?.phase === 'waiting';
    setTurnStatus(value.status);
    if (value.historyUnavailable)
      setError(
        'この会話の保存済み履歴を取得できません。履歴を再読み込みするか、「新しいチャット」を選択してください。以前の会話IDは保持されています。',
      );
    return value;
  }, []);
  const switchContext = useCallback(
    async (next: CodexContext | null) => {
      const key = next ? next.root + '\0' + next.stage : '';
      currentContext.current = key;
      setContext(next);
      setSnapshot(null);
      setMessages([]);
      setStream('');
      setAutoArtifact(null);
      artifactTaskRef.current = false;
      setError('');
      setBusy(false);
      setTurnStatus(idleStatus);
      setModelSettings(null);
      setModelError('');
      if (!next) return;
      setTask(stageTasks[next.stage][0].value);
      setLoading(true);
      setModelLoading(true);
      try {
        // History restoration must not block account or model loading:
        // paginated/older threads may be temporarily unreadable.
        const status = await refreshAccount();
        if (status.authenticated) await refreshModels(key);
        try {
          await refresh(key);
        } catch (err) {
          if (currentContext.current === key) setError(errorText(err));
        }
      } catch (err) {
        if (currentContext.current === key) setError(errorText(err));
      } finally {
        if (currentContext.current === key) {
          setLoading(false);
          setModelLoading(false);
        }
      }
    },
    [refresh, refreshAccount, refreshModels],
  );

  useEffect(() => {
    const offContext = window.batchStudio.codex.onContext((next) => {
      void switchContext(next);
    });
    const offStageTask = window.batchStudio.codex.onStageTaskSelected((selected) => {
      const contextStage = currentContext.current.split('\0').at(-1) as CodexContext['stage'];
      if (!currentContext.current || !stageTasks[contextStage]?.some((item) => item.value === selected))
        return;
      setTask(selected);
      setExtra('');
      setError('');
    });
    const offArtifact = window.batchStudio.autoArtifact.onEvent((event) => {
      if (
        event.provider !== 'codex' ||
        !currentContext.current ||
        currentContext.current !==
          event.root +
            '\0' +
            (event.stage.startsWith('story-')
              ? 'story'
              : event.stage.startsWith('models')
                ? 'models'
                : event.stage.startsWith('prompt-plan')
                  ? 'prompt-plan'
                  : 'caption')
      )
        return;
      setAutoArtifact(event);
      if (event.phase === 'imported' || event.phase === 'duplicate')
        artifactTaskRef.current = false;
    });
    const offEvent = window.batchStudio.codex.onEvent((event) => {
      if (event.method === 'account/updated' || event.method === 'account/login/completed') {
        const key = currentContext.current;
        void refreshAccount()
          .then((status) => {
            if (currentContext.current !== key) return;
            if (status.authenticated) return refreshModels(key);
            setModelSettings(null);
            setModelLoading(false);
          })
          .catch((err) => {
            if (currentContext.current === key) setError(errorText(err));
          });
        return;
      }
      if (event.method === 'disconnected') {
        setBusy(false);
        setTurnStatus((previous) =>
          ['sending', 'processing', 'streaming'].includes(previous.phase)
            ? {
                ...previous,
                phase: 'unknown',
                error: 'Codexとの接続が切れたため、終了状態を確認できません。',
              }
            : previous,
        );
        setError(String(event.params.message ?? 'Codexとの接続が切れました。'));
        return;
      }
      if (event.method === 'batch-studio/turn-status') {
        const status = event.params.status;
        if (status && typeof status === 'object' && 'phase' in status)
          setTurnStatus(status as CodexTurnStatus);
        return;
      }
      if (event.method === 'turn/started') setBusy(true);
      if (
        event.method === 'item/agentMessage/delta' &&
        !artifactTaskRef.current &&
        typeof event.params.delta === 'string'
      )
        setStream((text) => text + event.params.delta);
      if (event.method === 'turn/completed') {
        setBusy(false);
        const key = currentContext.current;
        void refresh(key)
          .then((value) => {
            if (currentContext.current === key && !value.historyUnavailable) setStream('');
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
      offStageTask();
      offEvent();
      offArtifact();
    };
  }, [refresh, refreshAccount, refreshModels, switchContext]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, stream]);
  useEffect(() => {
    if (!['sending', 'processing', 'streaming'].includes(turnStatus.phase)) return;
    const ticker = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(ticker);
  }, [turnStatus.phase]);

  const send = async (
    request: () => Promise<CodexSendResult>,
    text: string,
    artifactStage?: GrokTask['stage'],
  ) => {
    const key = currentContext.current;
    setError('');
    artifactTaskRef.current = Boolean(artifactStage && artifactStage !== 'story-initial');
    setAutoArtifact(null);
    setBusy(true);
    setTurnStatus({
      ...idleStatus,
      phase: 'sending',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    setStream('');
    setMessages((before) => [...before, { id: 'pending-' + Date.now(), role: 'user', text }]);
    try {
      const threads = await request();
      if (key === currentContext.current) {
        setInput('');
        setExtra('');
        // A newly started thread has an ID immediately, but no persisted rollout
        // until its turn finishes. Update history selection without reading it.
        setSnapshot((previous) => (previous ? { ...previous, ...threads } : previous));
        setTurnStatus(threads.status);
        setAutoArtifact(threads.artifact ?? null);
      }
    } catch (err) {
      if (key === currentContext.current) {
        artifactTaskRef.current = false;
        setBusy(false);
        setTurnStatus({
          ...idleStatus,
          phase: 'failed',
          finishedAt: Date.now(),
          error: errorText(err),
        });
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
        setAutoArtifact(next.artifact ?? null);
        artifactTaskRef.current = next.busy && next.artifact?.phase === 'waiting';
        setTurnStatus(next.status);
        setBusy(next.busy);
        setStream('');
      }
    } catch (err) {
      if (key === currentContext.current) setError(errorText(err));
    } finally {
      if (key === currentContext.current) setLoading(false);
    }
  };
  const chooseModel = async (next: CodexModelSelection) => {
    if (!modelSettings || loading || busy || modelSaving) return;
    const key = currentContext.current;
    setModelSaving(true);
    setModelError('');
    try {
      const selection = await window.batchStudio.codex.selectModel(next);
      if (key === currentContext.current)
        setModelSettings((previous) => (previous ? { ...previous, selection } : previous));
    } catch (err) {
      if (key === currentContext.current) setModelError(errorText(err));
    } finally {
      if (key === currentContext.current) setModelSaving(false);
    }
  };
  const selectedModel = modelSettings?.models.find(
    (item) => item.id === modelSettings.selection.model,
  );
  const activeTurn = ['sending', 'processing', 'streaming'].includes(turnStatus.phase);
  const elapsed =
    turnStatus.startedAt !== null
      ? formatDuration(
          (activeTurn ? clock : (turnStatus.finishedAt ?? turnStatus.updatedAt ?? clock)) -
            turnStatus.startedAt,
        )
      : null;
  const latestAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
  const output = autoArtifact || artifactTaskRef.current ? '' : (latestAssistant?.text ?? stream);
  const taskSendDisabledReason = loading
    ? '工程の会話履歴を読み込み中です。'
    : busy
      ? 'Codexが回答中です。完了後に送信できます。'
      : !account?.authenticated
        ? 'CodexでChatGPTにログインしてください。'
        : modelLoading
          ? '利用可能なCodexモデルを取得中です。'
          : modelSaving
            ? 'モデル設定の保存中です。'
            : !modelSettings
              ? 'Codexモデルを取得できません。モデル一覧を再取得してください。'
              : null;

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
        <section className="codex-runtime" aria-label="Codexの実行状態">
          <div
            className={'codex-runtime-state codex-runtime-' + turnStatus.phase}
            role="status"
            aria-live="polite"
          >
            <span className="codex-runtime-indicator" aria-hidden="true" />
            <strong>{phaseLabel[turnStatus.phase]}</strong>
            {elapsed && <small>経過時間: {elapsed}</small>}
            {turnStatus.finishedAt && (
              <small>終了: {new Date(turnStatus.finishedAt).toLocaleTimeString('ja-JP')}</small>
            )}
            {turnStatus.error && <small>{turnStatus.error}</small>}
          </div>
          <div className="codex-model-controls">
            <label>
              使用するモデル
              <select
                aria-label="Codexモデル"
                value={modelSettings?.selection.model ?? ''}
                disabled={!modelSettings || modelLoading || modelSaving || loading || busy}
                onChange={(event) => {
                  const selected = modelSettings?.models.find(
                    (item) => item.id === event.target.value,
                  );
                  if (selected)
                    void chooseModel({
                      model: selected.id,
                      effort: selected.defaultReasoningEffort,
                    });
                }}
              >
                {!modelSettings && (
                  <option value="">
                    {modelLoading ? 'モデル一覧を読み込み中…' : 'モデルを取得できません'}
                  </option>
                )}
                {modelSettings?.models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              推論の強度
              <select
                aria-label="Codex推論強度"
                value={modelSettings?.selection.effort ?? ''}
                disabled={!selectedModel || modelLoading || modelSaving || loading || busy}
                onChange={(event) => {
                  if (modelSettings)
                    void chooseModel({
                      ...modelSettings.selection,
                      effort: event.target.value,
                    });
                }}
              >
                {!selectedModel && <option value="">未選択</option>}
                {selectedModel?.supportedReasoningEfforts.map((option) => (
                  <option key={option.reasoningEffort} value={option.reasoningEffort}>
                    {option.reasoningEffort}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {modelSettings && (
            <small className="codex-model-note">
              次の依頼に適用: {selectedModel?.displayName ?? modelSettings.selection.model} ·{' '}
              {modelSettings.selection.effort}
            </small>
          )}
          {modelError && (
            <div className="codex-error" role="alert">
              {modelError}
              <button
                disabled={loading || busy || modelLoading || !account?.authenticated}
                onClick={() => void refreshModels(currentContext.current)}
              >
                モデル一覧を再取得
              </button>
            </div>
          )}
        </section>
      )}
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
          {snapshot?.historyUnavailable && (
            <button
              disabled={loading || busy}
              onClick={() => {
                setError('');
                void refresh(currentContext.current).catch((err) => setError(errorText(err)));
              }}
            >
              履歴を再読み込み
            </button>
          )}
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
        {stream && !autoArtifact && (
          <article className="codex-message assistant">
            <strong>Codex · 回答中</strong>
            <p>{stream}</p>
          </article>
        )}
        {activeTurn && <p className="codex-processing">{phaseLabel[turnStatus.phase]}</p>}
        {autoArtifact && (
          <section className="codex-artifact-result" aria-live="polite">
            <strong>{autoArtifact.fileName}</strong>
            <span>
              {autoArtifact.phase === 'waiting'
                ? '成果物の生成を待っています…'
                : autoArtifact.phase === 'detected'
                  ? '成果物を検出しました'
                  : autoArtifact.phase === 'validating'
                    ? '成果物を検証しています…'
                    : autoArtifact.phase === 'imported'
                      ? 'ファイルに保存し、下書きへ取り込みました（未確定）'
                      : autoArtifact.phase === 'duplicate'
                        ? '取り込み済みの成果物です'
                        : (autoArtifact.message ?? '成果物を取り込めませんでした')}
            </span>
            {autoArtifact.issues?.map((issue, index) => (
              <small key={index}>{issue.message}</small>
            ))}
            {autoArtifact.filePath && (
              <button
                onClick={() => void window.batchStudio.file.showInFolder(autoArtifact.filePath!)}
              >
                ファイルの場所を開く
              </button>
            )}
            {(autoArtifact.phase === 'invalid' || autoArtifact.phase === 'failed') && (
              <button
                disabled={busy}
                onClick={() =>
                  void window.batchStudio.codex
                    .retryArtifact()
                    .then((value) => {
                      if (value) setAutoArtifact(value);
                    })
                    .catch((err) => setError(errorText(err)))
                }
              >
                成果物の取り込みを再試行
              </button>
            )}
          </section>
        )}
        {['completed', 'failed', 'interrupted', 'unknown'].includes(turnStatus.phase) && (
          <p className="codex-turn-result">{phaseLabel[turnStatus.phase]}</p>
        )}
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
              disabled={Boolean(taskSendDisabledReason)}
              title={taskSendDisabledReason ?? '選択した工程の依頼を送信します'}
              onClick={() =>
                void send(
                  () => window.batchStudio.codex.sendTask(task, extra),
                  '工程の依頼: ' +
                    stageTasks[context.stage].find((value) => value.value === task)?.label +
                    (extra ? '\n' + extra : ''),
                  task,
                )
              }
            >
              工程用の依頼を送信
            </button>
          </div>
          {taskSendDisabledReason && (
            <div className="codex-task-disabled-reason" role="status">
              {taskSendDisabledReason}
              {!loading &&
                !busy &&
                !modelLoading &&
                account?.authenticated &&
                !modelSettings &&
                !modelError && (
                  <button onClick={() => void refreshModels(currentContext.current)}>
                    モデル一覧を再取得
                  </button>
                )}
            </div>
          )}
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
              disabled={
                loading || busy || !modelSettings || !input.trim() || !account?.authenticated
              }
              onClick={() => void send(() => window.batchStudio.codex.send(input), input)}
            >
              送信
            </button>
          </div>
          {!autoArtifact && Boolean(output) && (
            <details className="codex-manual-fallback">
              <summary>通常の回答をファイルとして保存（手動）</summary>
              <p>
                工程用の依頼は自動的に検証・取り込まれます。この操作は通常の回答を保存するだけで、
                下書きへの取り込みは行いません。
              </p>
              <button
                disabled={!output || busy}
                onClick={() =>
                  void window.batchStudio.codex
                    .saveResponse(output)
                    .catch((err) => setError(errorText(err)))
                }
              >
                回答をファイル保存
              </button>
            </details>
          )}
          <div className="codex-auto-import-note">
            工程用の依頼は回答完了後に自動で検証・保存され、左側の工程の下書きに反映されます。確定操作は別途必要です。
          </div>
        </section>
      )}
    </main>
  );
}
