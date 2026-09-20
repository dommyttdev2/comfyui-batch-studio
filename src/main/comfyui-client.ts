export interface ComfyUiPromptResult {
  prompt_id: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}
export type ComfyUiHistoryState = 'pending' | 'success' | 'error';

function normalizeEndpoint(value: string) {
  const raw = value.trim() || 'http://127.0.0.1:8188';
  const url = new URL(raw);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('ComfyUI API endpoint must use http or https.');
  url.username = '';
  url.password = '';
  url.hash = '';
  url.search = '';
  return url.toString().replace(/\/$/, '');
}
async function readJson(response: Response, label: string) {
  const text = await response.text();
  let data: any = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`${label}: invalid JSON response (HTTP ${response.status})`);
    }
  }
  if (!response.ok)
    throw new Error(
      `${label}: ${data?.error?.message ?? data?.error ?? data?.message ?? `HTTP ${response.status}`}`,
    );
  return data;
}
function queueHasPrompt(value: unknown, promptId: string): boolean {
  if (value == null) return false;
  if (typeof value === 'string' || typeof value === 'number') return String(value) === promptId;
  if (Array.isArray(value)) return value.some((item) => queueHasPrompt(item, promptId));
  if (typeof value === 'object')
    return Object.entries(value as Record<string, unknown>).some(
      ([key, item]) => key === promptId || queueHasPrompt(item, promptId),
    );
  return false;
}

export class ComfyUiClient {
  readonly endpoint: string;
  constructor(
    endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = normalizeEndpoint(endpoint);
  }
  private async request(path: string, init?: RequestInit) {
    return this.fetchImpl(this.endpoint + path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  }
  async health() {
    const response = await this.request('/system_stats');
    return readJson(response, 'ComfyUI health check failed');
  }
  async objectInfo() {
    const response = await this.request('/object_info');
    return readJson(response, 'ComfyUI object_info failed');
  }
  async prompt(graph: Record<string, unknown>, clientId: string): Promise<ComfyUiPromptResult> {
    const response = await this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: clientId }),
    });
    const data = await readJson(response, 'ComfyUI prompt submission failed');
    if (!data?.prompt_id) throw new Error('ComfyUI prompt submission returned no prompt_id.');
    return data as ComfyUiPromptResult;
  }
  async history(promptId: string) {
    const response = await this.request(`/history/${encodeURIComponent(promptId)}`);
    return readJson(response, 'ComfyUI history failed');
  }
  historyState(history: any, promptId: string): ComfyUiHistoryState {
    const entry = history?.[promptId],
      status = String(entry?.status?.status_str ?? '').toLowerCase();
    if (status === 'error') return 'error';
    if (status === 'success' || entry?.status?.completed === true) return 'success';
    return 'pending';
  }
  async queue() {
    const response = await this.request('/queue');
    return readJson(response, 'ComfyUI queue failed');
  }
  async isPromptRunning(promptId: string) {
    const queue = await this.queue();
    return queueHasPrompt(queue?.queue_running, promptId);
  }
  async isPromptQueued(promptId: string) {
    const queue = await this.queue();
    return (
      queueHasPrompt(queue?.queue_running, promptId) ||
      queueHasPrompt(queue?.queue_pending, promptId)
    );
  }
  async interrupt() {
    const response = await this.request('/interrupt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) await readJson(response, 'ComfyUI interrupt failed');
  }
}
