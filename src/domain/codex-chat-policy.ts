export interface CodexStageChats {
  activeThreadId: string | null;
  threadIds: string[];
}
export function copyChats(value: CodexStageChats | undefined): CodexStageChats {
  if (!value) return { activeThreadId: null, threadIds: [] };
  const threadIds = Array.isArray(value.threadIds)
    ? [...new Set(value.threadIds.filter((id) => typeof id === 'string' && id.length > 0))]
    : [];
  const activeThreadId =
    typeof value.activeThreadId === 'string' && threadIds.includes(value.activeThreadId)
      ? value.activeThreadId
      : null;
  return { activeThreadId, threadIds };
}

export function rememberCodexThread(value: CodexStageChats | undefined, threadId: string) {
  if (!threadId.trim()) throw new Error('Invalid Codex thread ID');
  const chats = copyChats(value);
  chats.threadIds = [threadId, ...chats.threadIds.filter((id) => id !== threadId)];
  chats.activeThreadId = threadId;
  return chats;
}
export function clearCodexThread(value: CodexStageChats | undefined) {
  return { ...copyChats(value), activeThreadId: null };
}
