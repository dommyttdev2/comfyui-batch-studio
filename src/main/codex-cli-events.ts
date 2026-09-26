import type { AgentEvent } from '../shared/types.js';

type UnknownRecord = Record<string, unknown>;

export interface CodexCliNormalizedLine {
  events: AgentEvent[];
  threadId?: string;
  terminal?: 'completed' | 'failed';
  error?: string;
}

export class CodexCliProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CodexCliProtocolError';
  }
}

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function itemName(item: UnknownRecord) {
  const type = stringValue(item.type);
  if (type === 'command_execution') return stringValue(item.command) || 'command';
  if (type === 'mcp_tool_call') {
    const server = stringValue(item.server);
    const tool = stringValue(item.tool);
    return [server, tool].filter(Boolean).join('/') || 'mcp_tool';
  }
  if (type === 'collab_tool_call') return stringValue(item.tool) || 'collab_tool';
  if (type === 'web_search') return 'web_search';
  return type || 'tool';
}

function todoDetail(item: UnknownRecord) {
  const todos = Array.isArray(item.items) ? item.items : [];
  return todos
    .map((value) => {
      const todo = record(value);
      if (!todo) return null;
      const text = stringValue(todo.text);
      if (!text) return null;
      return `${todo.completed === true ? '✓' : '•'} ${text}`;
    })
    .filter((value): value is string => Boolean(value))
    .join('\n');
}

export class CodexCliEventParser {
  private readonly messageText = new Map<string, string>();

  parseLine(line: string, turnId: string, now = Date.now()): CodexCliNormalizedLine {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new CodexCliProtocolError('Codex CLIが不正なJSONLを返しました。');
    }
    const value = record(parsed);
    if (!value || typeof value.type !== 'string')
      throw new CodexCliProtocolError('Codex CLIイベントの形式が不正です。');

    if (value.type === 'thread.started') {
      const threadId = stringValue(value.thread_id);
      if (!threadId) throw new CodexCliProtocolError('Codex CLIのsession IDを取得できません。');
      return {
        threadId,
        events: [{ type: 'session.started', at: now, sessionId: threadId }],
      };
    }
    if (value.type === 'turn.started')
      return { events: [{ type: 'turn.started', at: now, turnId }] };
    if (value.type === 'turn.completed')
      return {
        terminal: 'completed',
        events: [{ type: 'turn.completed', at: now, turnId }],
      };
    if (value.type === 'turn.failed') {
      const error = record(value.error);
      const message = stringValue(error?.message) || 'Codex CLI turn failed.';
      return {
        terminal: 'failed',
        error: message,
        events: [{ type: 'turn.failed', at: now, error: message }],
      };
    }
    if (value.type === 'error') {
      const message = stringValue(value.message) || 'Codex CLI stream failed.';
      return {
        terminal: 'failed',
        error: message,
        events: [{ type: 'turn.failed', at: now, error: message }],
      };
    }

    if (!['item.started', 'item.updated', 'item.completed'].includes(value.type))
      return { events: [] };
    const item = record(value.item);
    if (!item) throw new CodexCliProtocolError('Codex CLI itemイベントの形式が不正です。');

    const phase = value.type.split('.')[1] as 'started' | 'updated' | 'completed';
    const itemType = stringValue(item.type);
    const id = stringValue(item.id);
    const normalized: AgentEvent[] = [];

    if (itemType === 'agent_message') {
      const text = stringValue(item.text);
      const previous = id ? (this.messageText.get(id) ?? '') : '';
      if (text && text.startsWith(previous)) {
        const delta = text.slice(previous.length);
        if (delta) normalized.push({ type: 'message.delta', at: now, text: delta });
      }
      if (id) this.messageText.set(id, text);
      if (phase === 'completed') {
        normalized.push({ type: 'message.completed', at: now, text });
        if (id) this.messageText.delete(id);
      }
      return { events: normalized };
    }

    if (itemType === 'reasoning') {
      const detail = stringValue(item.text);
      if (detail)
        normalized.push({
          type: 'activity',
          at: now,
          label: 'Codex reasoning summary',
          detail,
        });
      return { events: normalized };
    }

    if (itemType === 'todo_list') {
      const detail = todoDetail(item);
      normalized.push({
        type: 'activity',
        at: now,
        label: 'Codex plan',
        ...(detail ? { detail } : {}),
      });
      return { events: normalized };
    }

    if (itemType === 'file_change') {
      if (phase !== 'completed') return { events: [] };
      for (const changeValue of Array.isArray(item.changes) ? item.changes : []) {
        const change = record(changeValue);
        const filePath = stringValue(change?.path);
        if (filePath) normalized.push({ type: 'file.changed', at: now, path: filePath });
      }
      return { events: normalized };
    }

    if (itemType === 'error') {
      const detail = stringValue(item.message);
      normalized.push({
        type: 'activity',
        at: now,
        label: 'Codex non-fatal error',
        ...(detail ? { detail } : {}),
      });
      return { events: normalized };
    }

    if (
      ['command_execution', 'mcp_tool_call', 'collab_tool_call', 'web_search'].includes(itemType)
    ) {
      const name = itemName(item);
      if (phase === 'started')
        normalized.push({ type: 'tool.started', at: now, name });
      if (phase === 'completed') {
        const status = stringValue(item.status);
        normalized.push({
          type: 'tool.completed',
          at: now,
          name,
          success: status !== 'failed' && status !== 'declined',
        });
      }
      return { events: normalized };
    }

    return { events: [] };
  }
}
