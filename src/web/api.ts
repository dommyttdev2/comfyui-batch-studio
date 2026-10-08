declare const __WEB_BUILD_ID__: string;
export interface Artifact {
  key: string;
  content: string;
  status: 'draft' | 'confirmed' | 'stale';
  validation: { valid: boolean; issues: { code: string; message: string }[] };
}
export interface Project {
  id: string;
  schema: string;
  revision: number;
  artifacts: Record<string, Artifact>;
  drafts: Record<string, Artifact>;
  lease: null | { ownedByCurrentSession: boolean; expiresAt: number; leaseId?: string };
  runSummaries: { id: string; state: string }[];
}
export interface Job {
  id: string;
  projectId: string;
  kind: string;
  state: string;
  progress: number;
}
export interface Packet {
  type: string;
  sequence?: number;
  code?: string;
  projectId?: string;
  revision?: number;
  projects?: { id: string; revision: number }[];
  jobs?: Job[];
  job?: Job;
}
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}
export class Api {
  buildId = '';
  userId = '';
  projectIds: string[] = [];
  private csrf = '';
  private socket?: WebSocket;
  private cursor?: number;
  private subscribed = '';
  private receiver?: (p: Packet) => void;
  onInvalidSession = () => {};
  async ready() {
    const r = await fetch('/api/v1/health', { cache: 'no-store' });
    const health = await r.json();
    if (health.apiVersion !== '1' || health.webBuildId !== __WEB_BUILD_ID__)
      throw new ApiError('BUILD_MISMATCH', 409);
    this.buildId = health.buildId;
  }
  async request<T>(
    path: string,
    body?: unknown,
    operationId = crypto.randomUUID(),
    extra: Record<string, string> = {},
  ): Promise<T> {
    const response = await fetch('/api/v1' + path, {
      method: body === undefined ? 'GET' : 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'content-type': 'application/json',
        'x-batch-api-version': '1',
        'x-batch-build-id': this.buildId,
        'x-request-id': crypto.randomUUID(),
        'x-csrf-token': this.csrf,
        'idempotency-key': operationId,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) {
      const error = new ApiError(value.error?.code ?? 'REQUEST_FAILED', response.status);
      if (response.status === 401) this.onInvalidSession();
      throw error;
    }
    return value as T;
  }
  async login(token: string) {
    await this.ready();
    const v = await this.request<{ userId: string; projectIds: string[]; csrfToken: string }>(
      '/session',
      {},
      crypto.randomUUID(),
      { authorization: 'Bearer ' + token },
    );
    this.userId = v.userId;
    this.projectIds = v.projectIds;
    this.csrf = v.csrfToken;
    this.cursor = undefined;
  }
  subscribe(ids: string[], receive: (p: Packet) => void, after?: number) {
    this.socket?.close();
    this.receiver = receive;
    const scope = [...new Set(ids)].sort().join(',');
    if (scope !== this.subscribed) this.cursor = undefined;
    this.subscribed = scope;
    if (after !== undefined) this.cursor = after;
    if (!ids.length) return;
    const url = new URL('/api/v1/events', location.href);
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ids.forEach((id) => url.searchParams.append('projectId', id));
    if (this.cursor !== undefined) url.searchParams.set('after', String(this.cursor));
    const ws = new WebSocket(url, 'batch.v1.' + this.buildId);
    this.socket = ws;
    ws.onmessage = (event) => {
      if (this.socket !== ws) return;
      const packet = JSON.parse(event.data) as Packet;
      if (packet.type === 'error') {
        receive(packet);
        return;
      }
      if (packet.sequence !== undefined) this.cursor = packet.sequence;
      receive(packet);
    };
    ws.onclose = (event) => {
      if (this.socket !== ws) return;
      if (event.code === 1008 && event.reason === 'Session unavailable.') this.onInvalidSession();
      else receive({ type: 'connection.closed' });
    };
    ws.onerror = () => {
      if (this.socket === ws) receive({ type: 'connection.error' });
    };
  }
  reconnect(fresh = false) {
    if (fresh) this.cursor = undefined;
    this.subscribe(this.subscribed.split(',').filter(Boolean), this.receiver ?? (() => {}));
  }
  disconnect() {
    const ws = this.socket;
    this.socket = undefined;
    ws?.close();
    this.receiver = undefined;
    this.cursor = undefined;
  }
}
export const api = new Api();
