// App Server only exposes model-provided reasoning *summaries*. Never forward
// reasoning/textDelta, complete assistant messages or arbitrary tool arguments
// as activity events (the latter may contain the generated artifact).
export type ActivityKind =
  | 'reasoning'
  | 'plan'
  | 'commandExecution'
  | 'fileChange'
  | 'mcpToolCall'
  | 'dynamicToolCall'
  | 'webSearch'
  | 'todoList';

export interface CodexActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  status: string;
  summary: string;
  output: string;
}
export interface CodexActivityState {
  turnId: string | null;
  items: CodexActivityItem[];
}
export interface CodexActivityEvent {
  method: string;
  turnId: string;
  itemId?: string;
  item?: Record<string, unknown>;
  delta?: string;
  summaryIndex?: number;
}
const MAX_ITEMS = 40;
const MAX_SUMMARY = 12000;
const MAX_OUTPUT = 3000;
const MAX_TITLE = 240;
const kinds = new Set<ActivityKind>([
  'reasoning',
  'plan',
  'commandExecution',
  'fileChange',
  'mcpToolCall',
  'dynamicToolCall',
  'webSearch',
  'todoList',
]);
const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const clip = (value: unknown, maximum: number): string =>
  typeof value === 'string' ? value.slice(0, maximum) : '';
const itemKind = (value: unknown): ActivityKind | null =>
  typeof value === 'string' && kinds.has(value as ActivityKind) ? (value as ActivityKind) : null;

function activityTitle(kind: ActivityKind, item: Record<string, unknown>): string {
  if (kind === 'reasoning') return '思考要約';
  if (kind === 'plan') return '作業計画';
  if (kind === 'commandExecution') return clip(item.command, MAX_TITLE) || 'コマンドを実行';
  if (kind === 'fileChange') return 'ファイルの変更';
  if (kind === 'mcpToolCall') {
    const server = clip(item.server, 80);
    const tool = clip(item.tool, 100);
    return [server, tool].filter(Boolean).join(' / ') || '外部ツール';
  }
  if (kind === 'dynamicToolCall') return clip(item.tool, MAX_TITLE) || 'ツールを実行';
  if (kind === 'webSearch') return 'Webを検索';
  return '作業手順';
}

function itemSummary(kind: ActivityKind, item: Record<string, unknown>): string {
  if (kind === 'reasoning') {
    if (typeof item.summary === 'string') return clip(item.summary, MAX_SUMMARY);
    const sections = Array.isArray(item.summary) ? item.summary : [];
    return sections
      .map((entry) => clip(asRecord(entry)?.text, MAX_SUMMARY))
      .filter(Boolean)
      .join('\n\n')
      .slice(0, MAX_SUMMARY);
  }
  if (kind === 'plan') return clip(item.summary, MAX_SUMMARY) || clip(item.text, MAX_SUMMARY);
  if (kind === 'todoList') {
    const items = Array.isArray(item.items) ? item.items : [];
    return items
      .map((entry) => clip(asRecord(entry)?.text, MAX_TITLE))
      .filter(Boolean)
      .join('\n')
      .slice(0, MAX_SUMMARY);
  }
  if (kind === 'fileChange') {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    return changes.length ? `${changes.length} 件のファイル変更` : '';
  }
  return '';
}

function toItem(
  item: Record<string, unknown>,
  previous?: CodexActivityItem,
): CodexActivityItem | null {
  const kind = itemKind(item.type);
  const id = clip(item.id, 200);
  if (!kind || !id) return null;
  const summary = itemSummary(kind, item);
  return {
    id,
    kind,
    title: clip(item.title, MAX_TITLE) || activityTitle(kind, item),
    status: clip(item.status, 40) || previous?.status || 'inProgress',
    summary: summary || previous?.summary || '',
    output:
      kind === 'commandExecution'
        ? clip(item.output, MAX_OUTPUT) ||
          clip(item.aggregatedOutput, MAX_OUTPUT) ||
          previous?.output ||
          ''
        : previous?.output || '',
  };
}

export function emptyCodexActivity(): CodexActivityState {
  return { turnId: null, items: [] };
}

// Convert only a small allowlist of App Server events to renderer-safe metadata.
export function safeCodexActivityEvent(
  method: string,
  params: Record<string, unknown>,
): CodexActivityEvent | null {
  const turnId = clip(params.turnId, 200);
  if (!turnId) return null;
  if (method === 'turn/started' || method === 'turn/completed') return { method, turnId };
  if (method === 'item/started' || method === 'item/completed') {
    const source = asRecord(params.item);
    const kind = itemKind(source?.type);
    if (!source || !kind) return null;
    const item = toItem(source);
    if (!item) return null;
    return { method, turnId, itemId: item.id, item: { ...item, type: kind } };
  }
  if (
    method !== 'item/reasoning/summaryTextDelta' &&
    method !== 'item/reasoning/summaryPartAdded' &&
    method !== 'item/plan/delta' &&
    method !== 'item/commandExecution/outputDelta'
  )
    return null;
  const itemId = clip(params.itemId, 200);
  if (!itemId) return null;
  return {
    method,
    turnId,
    itemId,
    delta: clip(params.delta, 2048),
    summaryIndex: typeof params.summaryIndex === 'number' ? params.summaryIndex : undefined,
  };
}

export function updateCodexActivity(
  state: CodexActivityState,
  event: CodexActivityEvent,
): CodexActivityState {
  if (event.method === 'turn/started') return { turnId: event.turnId, items: [] };
  if (state.turnId && state.turnId !== event.turnId) return state;
  const turnId = state.turnId ?? event.turnId;
  if (event.method === 'turn/completed') return { ...state, turnId };
  const itemId = event.itemId;
  if (!itemId) return state;
  const old = state.items.find((entry) => entry.id === itemId);
  let next: CodexActivityItem | null = null;
  if (event.item) {
    const item = event.item;
    next = toItem(item, old);
    if (next && event.method === 'item/completed')
      next.status = clip(item.status, 40) || 'completed';
  } else {
    const kind: ActivityKind = event.method.startsWith('item/reasoning/')
      ? 'reasoning'
      : event.method === 'item/plan/delta'
        ? 'plan'
        : 'commandExecution';
    if (old && old.kind !== kind) return state;
    const base = old ?? toItem({ id: itemId, type: kind });
    if (!base) return state;
    const isOutput = kind === 'commandExecution';
    next = {
      ...base,
      summary: !isOutput
        ? (base.summary + (event.delta ?? '')).slice(0, MAX_SUMMARY)
        : base.summary,
      output: isOutput ? (base.output + (event.delta ?? '')).slice(-MAX_OUTPUT) : base.output,
    };
    if (event.method === 'item/reasoning/summaryPartAdded' && old?.summary)
      next.summary = (old.summary + '\n\n').slice(0, MAX_SUMMARY);
  }
  if (!next) return state;
  const items = old
    ? state.items.map((entry) => (entry.id === itemId ? next : entry))
    : [...state.items, next].slice(-MAX_ITEMS);
  return { turnId, items };
}

export function codexActivityFromHistory(read: unknown): CodexActivityState {
  const thread = asRecord(asRecord(read)?.thread);
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const turn = asRecord(turns.at(-1));
  const turnId = clip(turn?.id, 200);
  if (!turnId) return emptyCodexActivity();
  let state: CodexActivityState = { turnId, items: [] };
  for (const raw of Array.isArray(turn?.items) ? turn.items : []) {
    const item = asRecord(raw);
    if (!item) continue;
    const kind = itemKind(item.type);
    if (!kind) continue;
    const event = safeCodexActivityEvent('item/completed', { turnId, item });
    if (event) state = updateCodexActivity(state, event);
  }
  return state;
}
