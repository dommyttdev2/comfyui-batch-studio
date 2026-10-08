import { VastOfferUseCases } from '../application/vast-offer-use-cases.js';
import { VastAiInstanceNotFoundError } from '../domain/vast-instance-errors.js';
import {
  normalizeComfyUiTemplate,
  normalizeVastInstance,
  normalizeVastOffer,
} from '../domain/vast-observation-policy.js';
import { HttpFailure, type JsonObject, object } from './http.js';
export function vastId(raw: unknown): number {
  if (!Number.isSafeInteger(raw) || (raw as number) < 1)
    throw new HttpFailure(400, 'INVALID_INPUT');
  return raw as number;
}
export class WebVastClient {
  readonly offers: VastOfferUseCases;
  constructor(
    private readonly key: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly deadlineMs = 20_000,
  ) {
    this.offers = new VastOfferUseCases({
      templates: async (hashId) => {
        const filters: JsonObject = {
          name: { eq: 'ComfyUI' },
          recommended: { eq: true },
          use_ssh: { eq: true },
          ssh_direct: { eq: true },
        };
        if (hashId) filters.hash_id = { eq: hashId };
        const payload = object(
          await this.request(
            '/api/v0/template/?' + new URLSearchParams({ select_filters: JSON.stringify(filters) }),
          ),
        );
        if (!Array.isArray(payload.templates) || payload.templates.length > 1000)
          throw new HttpFailure(502, 'VAST_PROTOCOL');
        return payload.templates.map((raw) => {
          const item = object(raw);
          if (
            typeof item.hash_id !== 'string' ||
            !item.hash_id ||
            typeof item.name !== 'string' ||
            !Number.isFinite(item.recommended_disk_space) ||
            (item.recommended_disk_space as number) <= 0
          )
            throw new HttpFailure(502, 'VAST_PROTOCOL');
          return normalizeComfyUiTemplate(item);
        });
      },
      offers: async (criteria) => {
        const payload = object(await this.request('/api/v0/bundles/', 'POST', criteria));
        if (!Array.isArray(payload.offers) || payload.offers.length > 1000)
          throw new HttpFailure(502, 'VAST_PROTOCOL');
        return payload.offers.map((raw) => {
          const item = object(raw);
          vastId(item.id);
          return normalizeVastOffer(item);
        });
      },
      rent: async (id, hash, disk) => {
        const payload = object(
          await this.request('/api/v0/asks/' + vastId(id) + '/', 'PUT', {
            template_hash_id: hash,
            disk,
            target_state: 'running',
            label: 'ComfyUI Batch Studio',
          }),
        );
        if (payload.success !== true) throw new HttpFailure(502, 'VAST_REJECTED');
        return vastId(payload.new_contract);
      },
      rememberCreated: () => {},
    });
  }
  private async request(endpoint: string, method = 'GET', body?: JsonObject): Promise<unknown> {
    const url = new URL(endpoint, 'https://console.vast.ai');
    if (
      url.origin !== 'https://console.vast.ai' ||
      !/^\/api\/v[01]\//.test(url.pathname) ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new HttpFailure(400, 'ENDPOINT_REJECTED');
    const signal = AbortSignal.timeout(this.deadlineMs);
    const response = await this.fetcher(url, {
      method,
      redirect: 'error',
      signal,
      headers: {
        Authorization: 'Bearer ' + this.key,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404) throw new HttpFailure(404, 'VAST_NOT_FOUND');
      throw new HttpFailure(
        response.status === 401 || response.status === 403 ? 503 : 502,
        'VAST_REJECTED',
      );
    }
    if (!response.body || !response.headers.get('content-type')?.split(';')[0].endsWith('json')) {
      await response.body?.cancel();
      throw new HttpFailure(502, 'VAST_PROTOCOL');
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    let bytes = 0;
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        signal.throwIfAborted();
        const next = await reader.read();
        signal.throwIfAborted();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 4 * 1024 * 1024) throw new HttpFailure(502, 'VAST_RESPONSE_LIMIT');
        chunks.push(next.value);
      }
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.includes(this.key)) throw new HttpFailure(502, 'VAST_PROTOCOL');
      try {
        return JSON.parse(raw);
      } catch {
        throw new HttpFailure(502, 'VAST_PROTOCOL');
      }
    } finally {
      signal.removeEventListener('abort', cancel);
      await reader.cancel().catch(() => {});
    }
  }
  async instances() {
    const results: ReturnType<typeof normalizeVastInstance>[] = [];
    const seen = new Set<string>();
    let token: string | null = null;
    do {
      const params = new URLSearchParams({ limit: '25' });
      if (token) params.set('after_token', token);
      const payload = object(await this.request('/api/v1/instances/?' + params));
      if (!Array.isArray(payload.instances) || payload.instances.length > 25)
        throw new HttpFailure(502, 'VAST_PROTOCOL');
      for (const raw of payload.instances) results.push(this.instanceDto(raw));
      if (
        payload.next_token !== null &&
        payload.next_token !== undefined &&
        (typeof payload.next_token !== 'string' ||
          !payload.next_token ||
          payload.next_token.length > 2048)
      )
        throw new HttpFailure(502, 'VAST_PROTOCOL');
      token = (payload.next_token as string | null | undefined) ?? null;
      if (token) {
        if (seen.has(token) || seen.size >= 100) throw new HttpFailure(502, 'VAST_PROTOCOL');
        seen.add(token);
      }
    } while (token);
    if (new Set(results.map((i) => i.id)).size !== results.length)
      throw new HttpFailure(502, 'VAST_PROTOCOL');
    return results;
  }
  private instanceDto(raw: unknown) {
    const item = object(raw);
    vastId(item.id);
    if (typeof item.actual_status !== 'string') throw new HttpFailure(502, 'VAST_PROTOCOL');
    const instance = normalizeVastInstance(item);
    const ports =
      item.ports && typeof item.ports === 'object' && !Array.isArray(item.ports)
        ? (item.ports as JsonObject)
        : {};
    const mappings = ports['22/tcp'];
    if (
      typeof item.public_ipaddr !== 'string' ||
      !item.public_ipaddr ||
      !Array.isArray(mappings) ||
      !mappings.some((raw) => {
        const value = object(raw);
        const number = Number(value.HostPort);
        return Number.isInteger(number) && number > 0 && number <= 65535;
      })
    ) {
      instance.sshHost = null;
      instance.sshPort = null;
    }
    return instance;
  }
  async instance(id: number) {
    try {
      const payload = object(await this.request('/api/v0/instances/' + vastId(id) + '/'));
      const instance = this.instanceDto(payload.instances);
      if (instance.id !== id) throw new HttpFailure(502, 'VAST_PROTOCOL');
      return instance;
    } catch (error) {
      if (error instanceof HttpFailure && error.status === 404)
        throw new VastAiInstanceNotFoundError(id);
      throw error;
    }
  }
  async action(
    id: number,
    action: 'start-instance' | 'stop-instance' | 'reboot-instance' | 'delete-instance',
  ) {
    const endpoint =
      action === 'reboot-instance'
        ? '/api/v0/instances/reboot/' + vastId(id) + '/'
        : '/api/v0/instances/' + vastId(id) + '/';
    const payload = object(
      await this.request(
        endpoint,
        action === 'delete-instance' ? 'DELETE' : 'PUT',
        action === 'start-instance' || action === 'stop-instance'
          ? { state: action === 'start-instance' ? 'running' : 'stopped' }
          : undefined,
      ),
    );
    if (payload.success !== true) throw new HttpFailure(502, 'VAST_REJECTED');
  }
  private async keys(endpoint: string): Promise<string[]> {
    const payload = await this.request(endpoint);
    if (!Array.isArray(payload) || payload.length > 1000)
      throw new HttpFailure(502, 'VAST_PROTOCOL');
    return payload.map((raw) => {
      const row = object(raw);
      if (typeof row.ssh_key !== 'string' || row.ssh_key.length > 16384)
        throw new HttpFailure(502, 'VAST_PROTOCOL');
      const parts = row.ssh_key.trim().split(/\s+/);
      if (parts.length < 2) throw new HttpFailure(502, 'VAST_PROTOCOL');
      return parts[0] + ' ' + parts[1];
    });
  }
  async hasSshAccess(id: number, key: string): Promise<boolean> {
    const [account, instance] = await Promise.all([
      this.keys('/api/v0/ssh/'),
      this.keys('/api/v0/instances/' + vastId(id) + '/ssh/'),
    ]);
    return account.includes(key) && instance.includes(key);
  }
  async provision(id: number, key: string) {
    for (const endpoint of ['/api/v0/ssh/', '/api/v0/instances/' + vastId(id) + '/ssh/']) {
      if (!(await this.keys(endpoint)).includes(key)) {
        const result = object(await this.request(endpoint, 'POST', { ssh_key: key }));
        if (result.success !== true) throw new HttpFailure(502, 'VAST_REJECTED');
      }
    }
  }
}
