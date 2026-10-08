import type { AgentConversationMessage } from './agent-runtime-types.js';
export function validConversationSessionId(id: string) {
  if (!id.trim() || id.length > 4096) throw new Error('Invalid agent session ID.');
}

export function sanitizeMessage(value: AgentConversationMessage): AgentConversationMessage {
  if (!value.id.trim() || value.id.length > 4096)
    throw new Error('Invalid conversation message ID.');
  if (value.role !== 'user' && value.role !== 'assistant')
    throw new Error('Invalid conversation message role.');
  if (typeof value.text !== 'string' || value.text.length > 2_000_000)
    throw new Error('Invalid conversation message text.');
  return { ...value };
}

export function validConversationMessages(value: unknown): AgentConversationMessage[] {
  if (!Array.isArray(value)) return [];
  const record = { messages: value as AgentConversationMessage[] };
  return record.messages
    .filter(
      (message) =>
        message &&
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.text === 'string' &&
        typeof message.at === 'number',
    )
    .map((message) => ({ ...message }));
}
export function upsertConversationMessage(
  current: unknown,
  next: AgentConversationMessage,
): AgentConversationMessage[] {
  const messages = validConversationMessages(current);
  const index = messages.findIndex((message) => message.id === next.id);
  if (index >= 0) messages[index] = { ...next };
  else messages.push({ ...next });
  return messages.slice(-500);
}
