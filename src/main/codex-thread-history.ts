/**
 * Read Codex history without resuming a thread. Newer Codex releases store
 * paginated threads which reject thread/read(includeTurns=true).
 */
export interface CodexHistoryTurn {
  id?: unknown;
  status?: unknown;
  items?: unknown[];
}
export interface CodexHistory {
  thread?: {
    historyMode?: unknown;
    turns?: CodexHistoryTurn[];
  };
}

type Request = (method: string, params: Record<string, unknown>) => Promise<unknown>;
const PAGE_LIMIT = 50;
const MAX_PAGES = 40;

export async function readCodexHistory(request: Request, threadId: string): Promise<CodexHistory> {
  let legacy: CodexHistory | null = null;
  try {
    legacy = (await request('thread/read', { threadId, includeTurns: true })) as CodexHistory;
    if (legacy.thread?.historyMode !== 'paginated') return legacy;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/paginated threads|thread\/read\(includeTurns=true\)/i.test(error.message)
    )
      throw error;
  }

  // Full items are needed for both rendered messages and exact artifact replies.
  // The API returns newest turns first; the rest of the app expects oldest first.
  const newestFirst: CodexHistoryTurn[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const response = (await request('thread/turns/list', {
      threadId,
      cursor,
      limit: PAGE_LIMIT,
      sortDirection: 'desc',
      itemsView: 'full',
    })) as { data?: CodexHistoryTurn[]; nextCursor?: string | null };
    if (!Array.isArray(response?.data))
      throw new Error('Codexのページ付き会話履歴を取得できませんでした。');
    for (const turn of response.data) {
      const id = typeof turn?.id === 'string' ? turn.id : null;
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      newestFirst.push(turn);
    }
    if (!response.nextCursor) {
      return {
        ...legacy,
        thread: { ...legacy?.thread, turns: newestFirst.reverse() },
      };
    }
    if (response.nextCursor === cursor)
      throw new Error('Codexの会話履歴でページ送りが停止しました。');
    cursor = response.nextCursor;
  }
  // Never silently present partial history as the full saved conversation.
  throw new Error('Codexの会話履歴が長すぎるため、全件を取得できませんでした。');
}
