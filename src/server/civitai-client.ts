import { setTimeout as delay } from 'node:timers/promises';
import type { CatalogCollectionMeta } from '../application/civitai-catalog-sync.js';
import { HttpFailure, object } from './http.js';
import { SerialQueue } from './storage.js';

function id(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new HttpFailure(400, 'INVALID_INPUT');
  return value;
}
export class WebCivitaiClient {
  readonly metrics = { requests: 0, retries: 0, responses429: 0 };
  private readonly queue = new SerialQueue();
  constructor(
    private readonly apiKey: string,
    private readonly signal: AbortSignal,
    private readonly request: typeof fetch = fetch,
    private readonly deadlineMs = 20_000,
  ) {}
  private get(
    endpoint: string,
    params: Record<string, string | number | boolean> = {},
    mature = false,
  ): Promise<any> {
    return this.queue.run(async () => {
      this.signal.throwIfAborted();
      const url = new URL(endpoint, mature ? 'https://civitai.red' : 'https://civitai.com');
      if (
        !['https://civitai.com', 'https://civitai.red'].includes(url.origin) ||
        !url.pathname.startsWith('/api/')
      )
        throw new HttpFailure(400, 'ENDPOINT_REJECTED');
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
      const deadline = AbortSignal.timeout(this.deadlineMs);
      const signal = AbortSignal.any([this.signal, deadline]);
      for (let attempt = 0; attempt < 4; attempt++) {
        signal.throwIfAborted();
        this.metrics.requests++;
        const response = await this.request(url, {
          method: 'GET',
          redirect: 'error',
          headers: {
            Authorization: 'Bearer ' + this.apiKey,
            Accept: 'application/json',
            'User-Agent': 'comfyui-batch-studio/web',
          },
          signal,
        });
        if (response.status === 429) {
          this.metrics.responses429++;
          await response.body?.cancel();
          if (attempt === 3) throw new HttpFailure(429, 'CIVITAI_RATE_LIMIT');
          const raw = response.headers.get('retry-after');
          const ms =
            raw === null
              ? 1000 * 2 ** attempt
              : /^\d+(?:\.\d+)?$/.test(raw)
                ? Number(raw) * 1000
                : Date.parse(raw) - Date.now();
          if (!Number.isFinite(ms) || ms < 0 || ms > 60_000)
            throw new HttpFailure(429, 'CIVITAI_RATE_LIMIT');
          this.metrics.retries++;
          await delay(ms, undefined, { signal });
          continue;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new HttpFailure(
            response.status === 401 || response.status === 403 ? 503 : 502,
            'CIVITAI_REJECTED',
          );
        }
        if (
          !response.headers.get('content-type')?.split(';')[0].endsWith('json') ||
          !response.body
        ) {
          await response.body?.cancel();
          throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        const cancel = () => {
          void reader.cancel().catch(() => {});
        };
        signal.addEventListener('abort', cancel, { once: true });
        try {
          for (;;) {
            signal.throwIfAborted();
            const result = await reader.read();
            signal.throwIfAborted();
            if (result.done) break;
            bytes += result.value.length;
            if (bytes > 4 * 1024 * 1024) throw new HttpFailure(502, 'CIVITAI_RESPONSE_LIMIT');
            chunks.push(result.value);
          }
          const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
          // External responses must not echo an integration credential into cache or public DTOs.
          if (raw.includes(this.apiKey)) throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
          return JSON.parse(raw);
        } finally {
          signal.removeEventListener('abort', cancel);
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      throw new HttpFailure(429, 'CIVITAI_RATE_LIMIT');
    });
  }
  private async trpc(procedure: string, payload: Record<string, unknown>, mature = false) {
    const raw = await this.get(
      '/api/trpc/' + procedure,
      { input: JSON.stringify({ json: payload }) },
      mature,
    );
    if (raw?.result?.data?.json === undefined) throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
    return raw.result.data.json;
  }
  async getCollections(): Promise<CatalogCollectionMeta[]> {
    const rows = await this.trpc('collection.getAllUser', {});
    if (!Array.isArray(rows) || rows.length > 1000) throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
    return rows
      .filter((r) => r?.type === 'Model')
      .map((r) => ({
        id: id(r.id),
        name: String(r.name).slice(0, 256),
        description: typeof r.description === 'string' ? r.description.slice(0, 8192) : null,
        read: String(r.read),
        type: 'Model',
        imageId: r.imageId == null ? null : id(r.imageId),
      }));
  }
  async getCollectionItems(collectionId: number) {
    id(collectionId);
    const items: any[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const value = await this.trpc(
        'collection.getAllCollectionItems',
        { collectionId, limit: 100, browsingLevel: 31, ...(cursor ? { cursor } : {}) },
        true,
      );
      if (!Array.isArray(value?.collectionItems) || value.collectionItems.length > 100)
        throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
      items.push(...value.collectionItems);
      if (Buffer.byteLength(JSON.stringify(items)) > 32 * 1024 * 1024)
        throw new HttpFailure(502, 'CIVITAI_RESPONSE_LIMIT');
      if (value.nextCursor == null) return { pages: page + 1, items };
      if (
        typeof value.nextCursor !== 'string' ||
        value.nextCursor.length > 256 ||
        seen.has(value.nextCursor)
      )
        throw new HttpFailure(502, 'CIVITAI_CURSOR');
      cursor = value.nextCursor as string;
      seen.add(cursor);
    }
    throw new HttpFailure(502, 'CIVITAI_PAGE_LIMIT');
  }
  async getModel(modelId: number) {
    const value = object(await this.get('/api/v1/models/' + id(modelId)));
    if (value.id !== modelId || !Array.isArray(value.modelVersions))
      throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
    return value;
  }
  async getModelVersion(versionId: number) {
    const value = object(await this.get('/api/v1/model-versions/' + id(versionId)));
    if (value.id !== versionId) throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
    return value;
  }
  async getImages(versionId: number) {
    const value = await this.get('/api/v1/images', {
      modelVersionId: id(versionId),
      withMeta: true,
      sort: 'Newest',
      limit: 200,
    });
    if (!Array.isArray(value?.items) || value.items.length > 200)
      throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
    return value.items as unknown[];
  }
  async getImageUrl(imageId: number): Promise<string | null> {
    const value = await this.get('/api/v1/images', { imageId: id(imageId), limit: 1 });
    if (!Array.isArray(value?.items)) throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
    if (!value.items.length) return null;
    const url = new URL(value.items[0].url);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !['image.civitai.com', 'imagecache.civitai.com'].includes(url.hostname)
    )
      throw new HttpFailure(502, 'CIVITAI_PROTOCOL');
    return url.href;
  }
}
