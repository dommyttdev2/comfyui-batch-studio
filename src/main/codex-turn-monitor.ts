import type { CodexTurnStatus } from '../shared/types.js';

const idle = (): CodexTurnStatus => ({
  phase: 'idle',
  startedAt: null,
  updatedAt: null,
  finishedAt: null,
  error: null,
});

type TurnNotification = {
  method: string;
  params: Record<string, unknown>;
};

function resultStatus(value: unknown): 'completed' | 'failed' | 'interrupted' | 'unknown' {
  if (value === 'completed' || value === 'failed' || value === 'interrupted') return value;
  return 'unknown';
}

function turnResult(params: Record<string, unknown>) {
  const turn =
    params.turn && typeof params.turn === 'object'
      ? (params.turn as Record<string, unknown>)
      : null;
  const status = resultStatus(turn?.status);
  const error =
    turn?.error && typeof turn.error === 'object' ? (turn.error as Record<string, unknown>) : null;
  return {
    status,
    error:
      status === 'failed' && typeof error?.message === 'string'
        ? error.message.slice(0, 1000)
        : null,
  };
}

export function statusFromThreadRead(result: unknown): CodexTurnStatus {
  const thread =
    result && typeof result === 'object' ? (result as Record<string, unknown>).thread : null;
  const turns =
    thread && typeof thread === 'object' ? (thread as Record<string, unknown>).turns : null;
  if (!Array.isArray(turns) || turns.length === 0) return idle();
  const last = turns[turns.length - 1] as Record<string, unknown> | null;
  const status = resultStatus(last?.status);
  // The App Server process might have restarted. A persisted "inProgress" turn
  // is not proof that it is still running; likewise, messages alone do not
  // prove that a turn completed successfully.
  if (status === 'unknown') return { ...idle(), phase: 'unknown' };
  const error =
    last?.error && typeof last.error === 'object' ? (last.error as Record<string, unknown>) : null;
  return {
    phase: status,
    startedAt: null,
    updatedAt: null,
    finishedAt: null,
    error:
      status === 'failed' && typeof error?.message === 'string'
        ? error.message.slice(0, 1000)
        : null,
  };
}

export class CodexTurnMonitor {
  private statuses = new Map<string, CodexTurnStatus>();

  get(threadId: string): CodexTurnStatus | null {
    return this.statuses.get(threadId) ?? null;
  }

  sending(threadId: string): CodexTurnStatus {
    const previous = this.get(threadId);
    if (previous && (previous.phase === 'processing' || previous.phase === 'streaming'))
      return previous;
    const now = Date.now();
    const next: CodexTurnStatus = {
      phase: 'sending',
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
      error: null,
    };
    this.statuses.set(threadId, next);
    return next;
  }

  started(threadId: string): CodexTurnStatus {
    const previous = this.get(threadId);
    if (
      previous &&
      (previous.phase === 'completed' ||
        previous.phase === 'failed' ||
        previous.phase === 'interrupted')
    )
      return previous;
    const now = Date.now();
    const next: CodexTurnStatus = {
      phase: previous?.phase === 'streaming' ? 'streaming' : 'processing',
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
      finishedAt: null,
      error: null,
    };
    this.statuses.set(threadId, next);
    return next;
  }

  notification(threadId: string, notification: TurnNotification): CodexTurnStatus | null {
    if (notification.method === 'turn/started') return this.started(threadId);
    if (notification.method === 'item/agentMessage/delta') {
      const previous = this.get(threadId);
      if (!previous || !['sending', 'processing', 'streaming'].includes(previous.phase))
        return null;
      if (typeof notification.params.delta !== 'string' || !notification.params.delta) return null;
      const next: CodexTurnStatus = {
        ...previous,
        phase: 'streaming',
        updatedAt: Date.now(),
      };
      this.statuses.set(threadId, next);
      return next;
    }
    if (notification.method === 'turn/completed') {
      const previous = this.get(threadId);
      const now = Date.now();
      const result = turnResult(notification.params);
      const next: CodexTurnStatus = {
        phase: result.status,
        startedAt: previous?.startedAt ?? null,
        updatedAt: now,
        finishedAt: now,
        error: result.error,
      };
      this.statuses.set(threadId, next);
      return next;
    }
    return null;
  }

  failedToSend(threadId: string, message: string): CodexTurnStatus {
    const previous = this.get(threadId);
    const now = Date.now();
    const next: CodexTurnStatus = {
      phase: 'failed',
      startedAt: previous?.startedAt ?? now,
      updatedAt: now,
      finishedAt: now,
      error: message.slice(0, 1000),
    };
    this.statuses.set(threadId, next);
    return next;
  }

  disconnected(): void {
    for (const [id, status] of this.statuses) {
      if (['sending', 'processing', 'streaming'].includes(status.phase))
        this.statuses.set(id, {
          ...status,
          phase: 'unknown',
          updatedAt: Date.now(),
          finishedAt: null,
          error: 'Codexとの接続が切れたため、終了状態を確認できません。',
        });
    }
  }

  // Use the live state while App Server is connected. When only persisted
  // history is available, display only the explicitly recorded turn result.
  fromRead(threadId: string, result: unknown): CodexTurnStatus {
    const live = this.get(threadId);
    if (live && live.phase !== 'unknown') return live;
    const persisted = statusFromThreadRead(result);
    if (persisted.phase === 'idle' || persisted.phase === 'unknown') return live ?? persisted;
    return persisted;
  }
}
