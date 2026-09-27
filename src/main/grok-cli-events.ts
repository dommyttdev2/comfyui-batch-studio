import type { AgentEvent } from '../shared/types.js';

type RecordValue = Record<string, unknown>;

type ToolState = {
  name: string;
  path: string | null;
  mutatesFile: boolean;
};

export interface GrokCliNormalizedLine {
  events: AgentEvent[];
  sessionId?: string;
  terminal?: 'completed' | 'failed' | 'cancelled';
  error?: string;
}

export class GrokCliProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GrokCliProtocolError';
  }
}

function record(value: unknown): RecordValue | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function toolPath(rawInput: unknown) {
  const input = record(rawInput);
  if (!input) return null;
  for (const key of ['path', 'file_path', 'filePath', 'target', 'filename']) {
    const value = text(input[key]);
    if (value) return value;
  }
  return null;
}

function planDetail(entries: unknown) {
  if (!Array.isArray(entries)) return '';
  return entries
    .map((entry) => {
      const value = record(entry);
      if (!value) return null;
      const label = text(value.content) || text(value.text) || text(value.title);
      if (!label) return null;
      const status = text(value.status);
      return status ? `[${status}] ${label}` : label;
    })
    .filter((value): value is string => Boolean(value))
    .join('\n');
}

export class GrokCliEventParser {
  private readonly tools = new Map<string, ToolState>();
  private message = '';

  parseLine(line: string, turnId: string, expectedSessionId: string, now = Date.now()): GrokCliNormalizedLine {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new GrokCliProtocolError('Grok CLIが不正なstreaming-jsonを返しました。');
    }
    const value = record(parsed);
    const type = text(value?.type);
    if (!value || !type) throw new GrokCliProtocolError('Grok CLIイベントの形式が不正です。');

    if (type === 'text') {
      const data = text(value.data);
      if (!data) return { events: [] };
      this.message += data;
      return { events: [{ type: 'message.delta', at: now, text: data }] };
    }

    if (type === 'thought') {
      // Do not expose raw chain-of-thought. The shared UI receives only a safe activity signal.
      return { events: [{ type: 'activity', at: now, label: 'Grok is reasoning' }] };
    }

    if (type === 'tool_call') {
      const id = text(value.toolCallId);
      const toolName = text(value.toolName);
      const kind = text(value.kind);
      const name = toolName || text(value.title) || kind || 'tool';
      const mutationToken = `${kind} ${toolName}`.toLowerCase();
      const mutatesFile =
        /(?:write|edit|delete|rename|move|patch|replace|create)/.test(mutationToken);
      if (id) this.tools.set(id, { name, path: toolPath(value.rawInput), mutatesFile });
      return { events: [{ type: 'tool.started', at: now, name }] };
    }

    if (type === 'tool_call_update') {
      const id = text(value.toolCallId);
      const stored = id ? this.tools.get(id) : undefined;
      const name = stored?.name ?? (text(value.toolName) || text(value.title) || 'tool');
      const status = text(value.status);
      if (!['completed', 'failed', 'cancelled'].includes(status)) return { events: [] };
      const normalized: AgentEvent[] = [
        { type: 'tool.completed', at: now, name, success: status === 'completed' },
      ];
      if (status === 'completed' && stored?.mutatesFile && stored.path)
        normalized.push({ type: 'file.changed', at: now, path: stored.path });
      if (id) this.tools.delete(id);
      return { events: normalized };
    }

    if (type === 'plan') {
      const detail = planDetail(value.entries);
      return {
        events: [
          {
            type: 'activity',
            at: now,
            label: 'Grok plan',
            ...(detail ? { detail } : {}),
          },
        ],
      };
    }

    if (type === 'error') {
      const message = text(value.message) || 'Grok CLI stream failed.';
      return {
        terminal: 'failed',
        error: message,
        events: [{ type: 'turn.failed', at: now, error: message }],
      };
    }

    if (type === 'end') {
      const sessionId = text(value.sessionId);
      if (!sessionId) throw new GrokCliProtocolError('Grok CLIのsession IDを取得できません。');
      if (sessionId.toLowerCase() !== expectedSessionId.toLowerCase())
        throw new GrokCliProtocolError(
          `Grok CLIのsession IDが要求値と一致しません。expected=${expectedSessionId}, returned=${sessionId}`,
        );
      const stopReason = text(value.stopReason);
      const normalized: AgentEvent[] = [];
      if (this.message)
        normalized.push({ type: 'message.completed', at: now, text: this.message });

      if (stopReason === 'cancelled') {
        normalized.push({ type: 'turn.cancelled', at: now, turnId });
        return { sessionId, terminal: 'cancelled', events: normalized };
      }
      if (!stopReason || stopReason === 'end_turn') {
        normalized.push({ type: 'turn.completed', at: now, turnId });
        return { sessionId, terminal: 'completed', events: normalized };
      }
      const message = `Grok CLI ended with stopReason=${stopReason}`;
      normalized.push({ type: 'turn.failed', at: now, error: message });
      return { sessionId, terminal: 'failed', error: message, events: normalized };
    }

    // usage / available_commands / auto_compact_* / max_turns_reached and future event types
    // are intentionally ignored unless they map to a provider-neutral semantic event.
    return { events: [] };
  }
}
