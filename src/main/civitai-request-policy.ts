const abortError = (signal?: AbortSignal) =>
  signal?.reason instanceof Error ? signal.reason : new Error('Civitai request aborted.');
const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError(signal));
    };
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export interface CivitaiRequestMetrics {
  requests: number;
  retries: number;
  responses429: number;
  responses5xx: number;
  networkErrors: number;
  currentIntervalMs: number;
  requestsByEndpoint: Record<string, number>;
}

export interface CivitaiRateLimitState {
  waiting: boolean;
  retryAt: number | null;
  retryAfterSeconds: number;
  consecutive429: number;
  metrics: CivitaiRequestMetrics;
}

function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function normalizedHosts() {
  const values = [
    process.env.CIVITAI_BASE_URL ?? 'https://civitai.com',
    process.env.CIVITAI_MATURE_BASE_URL ?? 'https://civitai.red',
  ];
  const hosts = new Set<string>();
  for (const value of values) {
    try {
      hosts.add(new URL(value).hostname.toLowerCase());
    } catch {}
  }
  return hosts;
}

function combineSignals(a?: AbortSignal | null, b?: AbortSignal | null) {
  if (!a) return { signal: b ?? undefined, cleanup: () => {} };
  if (!b) return { signal: a, cleanup: () => {} };
  const controller = new AbortController();
  const onA = () => controller.abort(a.reason),
    onB = () => controller.abort(b.reason);
  if (a.aborted) controller.abort(a.reason);
  else a.addEventListener('abort', onA, { once: true });
  if (b.aborted && !controller.signal.aborted) controller.abort(b.reason);
  else if (!b.aborted) b.addEventListener('abort', onB, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      a.removeEventListener('abort', onA);
      b.removeEventListener('abort', onB);
    },
  };
}

function endpointKey(input: RequestInfo | URL) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const url = new URL(raw),
      path = url.pathname;
    if (/^\/api\/v1\/models\/\d+$/.test(path)) return '/api/v1/models/:id';
    if (/^\/api\/v1\/model-versions\/\d+$/.test(path)) return '/api/v1/model-versions/:id';
    return path;
  } catch {
    return 'unknown';
  }
}

function isCollectionTrpcRequest(input: RequestInfo | URL) {
  try {
    const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
    const path = new URL(raw).pathname;
    return (
      path === '/api/trpc/collection.getAllUser' ||
      path === '/api/trpc/collection.getAllCollectionItems'
    );
  } catch {
    return false;
  }
}

let activePolicy: CivitaiRequestPolicy | null = null;

export class CivitaiRequestPolicy {
  private readonly originalFetch: typeof fetch;
  private readonly hosts: Set<string>;
  private readonly requestIntervalMs: number;
  private readonly collectionRequestIntervalMs: number;
  private readonly minRetryMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private nextRequestAt = 0;
  private blockedUntil = 0;
  private transientUntil = 0;
  private gate: Promise<void> = Promise.resolve();
  private consecutive429 = 0;
  private installed = false;
  private metricsValue: CivitaiRequestMetrics;

  constructor(originalFetch: typeof fetch = globalThis.fetch) {
    this.originalFetch = originalFetch;
    this.hosts = normalizedHosts();
    this.requestIntervalMs = Math.max(0, Number(process.env.CIVITAI_REQUEST_INTERVAL_MS ?? 350));
    this.collectionRequestIntervalMs = Math.max(
      this.requestIntervalMs,
      Number(process.env.CIVITAI_COLLECTION_REQUEST_INTERVAL_MS ?? 1000),
    );
    this.minRetryMs = Math.max(1, Number(process.env.CIVITAI_MIN_RETRY_MS ?? 1000));
    this.timeoutMs = Math.max(1000, Number(process.env.CIVITAI_TIMEOUT ?? 20) * 1000);
    this.maxRetries = Math.max(0, Math.floor(Number(process.env.CIVITAI_MAX_RETRIES ?? 5)));
    this.metricsValue = this.emptyMetrics();
  }

  private emptyMetrics(): CivitaiRequestMetrics {
    return {
      requests: 0,
      retries: 0,
      responses429: 0,
      responses5xx: 0,
      networkErrors: 0,
      currentIntervalMs: this.requestIntervalMs,
      requestsByEndpoint: {},
    };
  }

  install() {
    if (this.installed) return;
    this.installed = true;
    activePolicy = this;
    const self = this;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      self.fetch(input, init)) as typeof fetch;
  }

  resetMetrics() {
    this.metricsValue = this.emptyMetrics();
  }

  status(): CivitaiRateLimitState {
    const now = Date.now(),
      waiting = this.blockedUntil > now;
    return {
      waiting,
      retryAt: waiting ? this.blockedUntil : null,
      retryAfterSeconds: waiting ? Math.max(1, Math.ceil((this.blockedUntil - now) / 1000)) : 0,
      consecutive429: this.consecutive429,
      metrics: structuredClone(this.metricsValue),
    };
  }

  private isCivitai(input: RequestInfo | URL) {
    try {
      const raw = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      return this.hosts.has(new URL(raw).hostname.toLowerCase());
    } catch {
      return false;
    }
  }

  private requestInterval(input: RequestInfo | URL) {
    return isCollectionTrpcRequest(input)
      ? this.collectionRequestIntervalMs
      : this.requestIntervalMs;
  }

  private async waitForSlot(input: RequestInfo | URL, signal?: AbortSignal) {
    const intervalMs = this.requestInterval(input);
    const task = this.gate.then(async () => {
      const now = Date.now(),
        wait = Math.max(
          0,
          this.nextRequestAt - now,
          this.blockedUntil - now,
          this.transientUntil - now,
        );
      if (wait > 0) await sleep(wait, signal);
      this.nextRequestAt = Date.now() + intervalMs;
    });
    this.gate = task.catch(() => {});
    await task;
  }

  private markRequest(input: RequestInfo | URL) {
    this.metricsValue.requests += 1;
    const key = endpointKey(input);
    this.metricsValue.requestsByEndpoint[key] =
      (this.metricsValue.requestsByEndpoint[key] ?? 0) + 1;
  }

  private retryDelay(response: Response, attempt: number) {
    const fromHeader = parseRetryAfter(response.headers.get('Retry-After'));
    if (fromHeader != null) return Math.max(this.minRetryMs, fromHeader);
    const exponential = Math.min(30_000, this.minRetryMs * 2 ** Math.min(attempt, 5));
    return exponential + Math.floor(Math.random() * Math.min(1000, this.minRetryMs));
  }

  private transientDelay(attempt: number) {
    const exponential = Math.min(30_000, this.minRetryMs * 2 ** Math.min(attempt, 5));
    return exponential + Math.floor(Math.random() * Math.min(1000, this.minRetryMs));
  }

  private retryableMethod(init?: RequestInit) {
    const method = String(init?.method ?? 'GET').toUpperCase();
    return method === 'GET' || method === 'HEAD';
  }

  private async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    if (!this.isCivitai(input)) return this.originalFetch(input, init);
    const retryable = this.retryableMethod(init);
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (init?.signal?.aborted) throw abortError(init.signal);
      await this.waitForSlot(input, init?.signal ?? undefined);
      const controller = new AbortController(),
        timer = setTimeout(
          () =>
            controller.abort(
              new Error(`Civitai request attempt timed out after ${this.timeoutMs} ms.`),
            ),
          this.timeoutMs,
        );
      const combined = combineSignals(init?.signal, controller.signal);
      let response: Response;
      try {
        this.markRequest(input);
        response = await this.originalFetch(input, { ...init, signal: combined.signal });
      } catch (error) {
        if (init?.signal?.aborted) throw abortError(init.signal);
        this.metricsValue.networkErrors += 1;
        if (!retryable || attempt >= this.maxRetries) throw error;
        this.metricsValue.retries += 1;
        const delay = this.transientDelay(attempt);
        this.transientUntil = Math.max(this.transientUntil, Date.now() + delay);
        continue;
      } finally {
        clearTimeout(timer);
        combined.cleanup();
      }

      if (response.status === 429) {
        this.metricsValue.responses429 += 1;
        this.consecutive429 += 1;
        const delay = this.retryDelay(response, attempt);
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + delay);
        if (!retryable || attempt >= this.maxRetries) return response;
        this.metricsValue.retries += 1;
        continue;
      }

      if (response.status >= 500 && response.status <= 599) {
        this.metricsValue.responses5xx += 1;
        if (retryable && attempt < this.maxRetries) {
          this.metricsValue.retries += 1;
          const delay = this.transientDelay(attempt);
          this.transientUntil = Math.max(this.transientUntil, Date.now() + delay);
          continue;
        }
      }

      this.consecutive429 = 0;
      this.blockedUntil = 0;
      this.transientUntil = 0;
      return response;
    }
    throw new Error('Civitai request retry loop exited unexpectedly.');
  }
}

export function getActiveCivitaiRequestState() {
  return activePolicy?.status() ?? null;
}
export function resetActiveCivitaiRequestMetrics() {
  activePolicy?.resetMetrics();
}
export { parseRetryAfter };
