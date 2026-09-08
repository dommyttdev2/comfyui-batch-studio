import path from 'node:path';
import { ListBucketsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import type { R2Object, R2SearchResult } from '../shared/types.js';
import { readJson, writeJsonAtomic } from './fs-utils.js';
import { R2ConfigStore } from './r2-config.js';

interface R2ObjectIndexState {
  schemaVersion: 1;
  syncedAt: string | null;
  buckets: Record<string, R2Object[]>;
}

const PAGE_SIZE = 250;

function serialize(item: any): R2Object {
  const key = String(item.Key ?? '');
  return {
    key,
    name: key.split('/').pop() || key,
    size: Number(item.Size ?? 0),
    etag: String(item.ETag ?? '').replace(/^"|"$/g, ''),
    lastModified: item.LastModified?.toISOString?.() ?? null,
    storageClass: String(item.StorageClass ?? 'STANDARD'),
  };
}

export class R2ObjectIndex {
  private readonly filePath: string;
  private syncing: Promise<void> | null = null;

  constructor(private readonly config: R2ConfigStore, userData: string) {
    this.filePath = path.join(userData, 'r2', 'object-index.json');
  }

  private async read(): Promise<R2ObjectIndexState> {
    const value = await readJson<R2ObjectIndexState>(this.filePath);
    return value?.schemaVersion === 1 ? value : { schemaVersion: 1, syncedAt: null, buckets: {} };
  }

  async sync(): Promise<void> {
    if (this.syncing) return this.syncing;
    this.syncing = this.doSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }

  private async doSync(): Promise<void> {
    const c = await this.config.credentials();
    const client = new S3Client({
      endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
      maxAttempts: 5,
    });
    const listed = await client.send(new ListBucketsCommand({}));
    const buckets: Record<string, R2Object[]> = {};
    for (const bucket of listed.Buckets ?? []) {
      const name = bucket.Name ?? '';
      if (!name) continue;
      let token: string | undefined;
      const objects: R2Object[] = [];
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket: name, MaxKeys: 1000, ContinuationToken: token }));
        for (const item of page.Contents ?? []) {
          if (item.Key && !item.Key.endsWith('/')) objects.push(serialize(item));
        }
        token = page.NextContinuationToken;
      } while (token);
      buckets[name] = objects;
    }
    await writeJsonAtomic(this.filePath, { schemaVersion: 1, syncedAt: new Date().toISOString(), buckets } satisfies R2ObjectIndexState);
  }

  async search(bucket: string, query: string, token?: string | null): Promise<R2SearchResult> {
    const state = await this.read();
    const all = state.buckets[bucket] ?? [];
    const q = query.trim().normalize('NFKC').toLocaleLowerCase();
    if (!q) return { objects: [], nextToken: null, scanned: all.length };
    const matches = all.filter(o => o.key.normalize('NFKC').toLocaleLowerCase().includes(q));
    const offset = token?.startsWith('local:') ? Math.max(0, Number(token.slice(6)) || 0) : 0;
    const objects = matches.slice(offset, offset + PAGE_SIZE);
    const next = offset + objects.length;
    return { objects, nextToken: next < matches.length ? `local:${next}` : null, scanned: all.length };
  }

  async containsFile(bucket: string, fileName: string, prefix = ''): Promise<boolean> {
    const state = await this.read();
    const normalizedPrefix = prefix.replace(/^\/+/, '');
    return (state.buckets[bucket] ?? []).some(o => path.basename(o.key) === fileName && (!normalizedPrefix || o.key.startsWith(normalizedPrefix)));
  }
}
