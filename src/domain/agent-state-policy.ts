export interface AgentStageSessions {
  activeSessionId: string | null;
  sessionIds: string[];
}

export function copySessions(value: AgentStageSessions | undefined): AgentStageSessions {
  if (!value) return { activeSessionId: null, sessionIds: [] };
  const sessionIds = Array.isArray(value.sessionIds)
    ? [...new Set(value.sessionIds.filter((id) => typeof id === 'string' && id.trim().length > 0))]
    : [];
  const activeSessionId =
    typeof value.activeSessionId === 'string' && sessionIds.includes(value.activeSessionId)
      ? value.activeSessionId
      : null;
  return { activeSessionId, sessionIds };
}

export function validSessionId(sessionId: string) {
  if (!sessionId.trim() || sessionId.length > 4096) throw new Error('Invalid agent session ID');
}

export function rememberAgentSession(value: AgentStageSessions | undefined, id: string) {
  validSessionId(id);
  const sessions = copySessions(value);
  sessions.sessionIds = [id, ...sessions.sessionIds.filter((existing) => existing !== id)].slice(
    0,
    100,
  );
  sessions.activeSessionId = id;
  return sessions;
}
export function activateAgentSession(value: AgentStageSessions | undefined, id: string) {
  validSessionId(id);
  const sessions = copySessions(value);
  if (!sessions.sessionIds.includes(id))
    throw new Error('Agent session is not part of this stage.');
  sessions.activeSessionId = id;
  return sessions;
}
export interface AgentModelSelection {
  model: string | null;
  reasoningEffort?: string | null;
}
export function validateAgentModelSelection(value: AgentModelSelection) {
  if (
    !value ||
    typeof value !== 'object' ||
    (value.model !== null &&
      (typeof value.model !== 'string' || !value.model.trim() || value.model.length > 256))
  )
    throw new Error('Invalid agent model selection.');
  if (
    value.reasoningEffort != null &&
    (typeof value.reasoningEffort !== 'string' ||
      !value.reasoningEffort.trim() ||
      value.reasoningEffort.length > 64)
  )
    throw new Error('Invalid reasoning effort.');
  return { ...value };
}
