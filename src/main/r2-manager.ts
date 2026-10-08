import { uniqueDownloadNames, assertDownloadBatch } from '../domain/r2-storage-policy.js';
import { R2TransferRuntime } from '../application/r2-transfer-runtime.js';
import { sourceChanged, sameSourceStat } from '../domain/r2-transfer-policy.js';
import {
  saveR2Template,
  deleteSavedTemplate,
  type R2TemplateInput,
} from '../domain/saved-template-policy.js';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, type Stats } from 'node:fs';
import { open, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListBucketsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type {
  R2BatchDownloadTemplate,
  R2DownloadInfo,
  R2ListResult,
  R2Object,
  R2PutUrlInfo,
  R2SearchResult,
  R2UploadJob,
  R2UploadSourceFingerprint,
} from '../shared/types.js';
import {
  MAX_BATCH_TEMPLATES_PER_BUCKET,
  normalizeBatchTemplateName,
  normalizeBatchTemplateObjects,
  normalizeR2ObjectKey,
  normalizeR2PresignedExpiresIn,
  normalizeR2PutContentType,
  normalizeR2PutObjectKey,
  objectName,
} from '../shared/r2-manager-utils.js';
import { exists, readJson, withTemplateStoreLock, writeJsonAtomic } from './fs-utils.js';
import { R2ConfigStore, type R2ConnectionInput } from './r2-config.js';
import { R2ObjectIndex } from './r2-object-index.js';

const MIB = 1024 * 1024,
  DEFAULT_PART = 16 * MIB,
  MAX_PARTS = 10000,
  FIVE_GIB = 5 * 1024 * 1024 * 1024;
export const R2_SINGLE_PUT_LIMIT = FIVE_GIB - 5 * MIB;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
function sourceStat(st: Stats) {
  return {
    size: st.size,
    mtimeMs: st.mtimeMs,
    ctimeMs: st.ctimeMs,
    dev: st.dev,
    ino: st.ino,
  };
}
async function fingerprintUploadSource(
  filePath: string,
  uploadPartSize: number,
): Promise<R2UploadSourceFingerprint> {
  const before = sourceStat(await stat(filePath));
  const overall = createHash('sha256'),
    partSha256: string[] = [];
  let partHash = createHash('sha256'),
    inPart = 0,
    bytes = 0;
  // One MiB per chunk, regardless of multi-GiB source file size.
  for await (const raw of createReadStream(filePath, { highWaterMark: MIB })) {
    const chunk = raw as Buffer;
    overall.update(chunk);
    for (let offset = 0; offset < chunk.length; ) {
      const take = Math.min(uploadPartSize - inPart, chunk.length - offset);
      partHash.update(chunk.subarray(offset, offset + take));
      inPart += take;
      offset += take;
      if (inPart === uploadPartSize) {
        partSha256.push(partHash.digest('hex'));
        partHash = createHash('sha256');
        inPart = 0;
      }
    }
    bytes += chunk.length;
  }
  if (inPart > 0 || bytes === 0) partSha256.push(partHash.digest('hex'));
  if (bytes !== before.size || !sameSourceStat(before, sourceStat(await stat(filePath))))
    throw sourceChanged('ハッシュ計算中に元ファイルのサイズまたは識別情報が変わりました');
  return { ...before, sha256: overall.digest('hex'), partSha256 };
}
// The bytes supplied to S3 are verified in memory before the HTTP request;
// a source changing while an UploadPart request is in flight cannot change
// that already verified part, even on platforms where file locks are advisory.
async function verifiedUploadPart(
  filePath: string,
  start: number,
  length: number,
  baseline: R2UploadSourceFingerprint,
  partNumber: number,
): Promise<Buffer> {
  const before = sourceStat(await stat(filePath));
  if (!sameSourceStat(baseline, before))
    throw sourceChanged('Part読み込み前に元ファイルが変更されました');
  const handle = await open(filePath, 'r');
  try {
    const opened = sourceStat(await handle.stat());
    if (!sameSourceStat(baseline, opened)) throw sourceChanged('元ファイルのIDが変わりました');
    const bytes = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const result = await handle.read(bytes, read, length - read, start + read);
      if (!result.bytesRead) throw sourceChanged('Part読み込み中に元ファイルが縮小しました');
      read += result.bytesRead;
    }
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (actual !== baseline.partSha256[partNumber - 1])
      throw sourceChanged('Partの内容ハッシュが開始時と一致しません');
    if (
      !sameSourceStat(baseline, sourceStat(await handle.stat())) ||
      !sameSourceStat(baseline, sourceStat(await stat(filePath)))
    )
      throw sourceChanged('Part読み込み中に元ファイルが変更されました');
    return bytes;
  } finally {
    await handle.close();
  }
}
function partSize(size: number) {
  const required = Math.max(DEFAULT_PART, Math.ceil(Math.max(size, 1) / MAX_PARTS));
  return Math.ceil(required / MIB) * MIB;
}
function encodeKey(key: string) {
  return key.split('/').map(encodeURIComponent).join('/');
}
function publicObjectUrl(base: string, key: string) {
  return `${base.replace(/\/+$/, '')}/${encodeKey(key)}`;
}
function quote(value: string) {
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
function serializeObject(item: any, prefix = ''): R2Object {
  const key = String(item.Key ?? '');
  return {
    key,
    name: prefix && key.startsWith(prefix) ? key.slice(prefix.length) : objectName(key),
    size: Number(item.Size ?? 0),
    etag: String(item.ETag ?? '').replace(/^"|"$/g, ''),
    lastModified: item.LastModified?.toISOString?.() ?? null,
    storageClass: String(item.StorageClass ?? 'STANDARD'),
  };
}
function statusCode(error: any) {
  return Number(error?.$metadata?.httpStatusCode ?? 0);
}
function sha256Hex(value: unknown) {
  const raw = String(value ?? '').trim();
  if (/^[0-9a-f]{64}$/i.test(raw)) return raw.toLowerCase();
  try {
    const decoded = Buffer.from(raw, 'base64');
    return decoded.length === 32 ? decoded.toString('hex') : null;
  } catch {
    return null;
  }
}
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
interface UploadState {
  schemaVersion: 1;
  jobs: R2UploadJob[];
}
interface TemplateState {
  schemaVersion: 1;
  templates: R2BatchDownloadTemplate[];
}

export class R2Manager {
  private clientCache: { key: string; client: S3Client } | null = null;
  private readonly uploadsPath: string;
  private readonly templatesPath: string;
  private readonly objectIndex: R2ObjectIndex;
  private readonly transfers: R2TransferRuntime;
  constructor(
    private readonly config: R2ConfigStore,
    private readonly userData: string,
  ) {
    this.uploadsPath = path.join(userData, 'r2', 'uploads.json');
    this.templatesPath = path.join(userData, 'r2', 'batch-download-templates.json');
    this.objectIndex = new R2ObjectIndex(config, userData);
    this.transfers = new R2TransferRuntime({
      jobs: () => this.readTransferJobs(),
      save: (job) => this.saveTransferJob(job),
      request: async (operation, input) => {
        const constructors = {
          HeadObject: HeadObjectCommand,
          CopyObject: CopyObjectCommand,
          CreateMultipartUpload: CreateMultipartUploadCommand,
          UploadPartCopy: UploadPartCopyCommand,
          CompleteMultipartUpload: CompleteMultipartUploadCommand,
          DeleteObject: DeleteObjectCommand,
          AbortMultipartUpload: AbortMultipartUploadCommand,
          UploadPart: UploadPartCommand,
          PutObject: PutObjectCommand,
        };
        return (await this.clientFor()).send(
          new (constructors[operation] as new (input: any) => any)(input),
        );
      },
      exists,
      stat,
      basename: path.basename,
      fingerprint: fingerprintUploadSource,
      readVerifiedPart: verifiedUploadPart,
      now: () => new Date().toISOString(),
      nextId: randomUUID,
      sleep: async (ms) => {
        await delay(ms);
      },
      syncIndex: () => this.syncIndex(),
    });
  }
  private syncIndex() {
    void this.objectIndex.sync().catch((error) => console.warn('R2 index sync failed:', error));
  }
  async settings() {
    return this.config.status();
  }
  environment() {
    return this.config.environmentDefaults();
  }
  async saveSettings(input: R2ConnectionInput) {
    const result = await this.config.save(input, async (resolved) => {
      await (await this.clientFor(resolved)).send(new ListBucketsCommand({}));
    });
    this.clientCache = null;
    return result;
  }
  private async clientFor(input?: R2ConnectionInput) {
    const c = input ?? (await this.config.credentials());
    const secret = (c.secretAccessKey ?? '').trim();
    if (!secret) throw new Error('Secret Access Keyが必要です。');
    const key = `${c.accountId}|${c.accessKeyId}|${secret}`;
    if (!input && this.clientCache?.key === key) return this.clientCache.client;
    const client = new S3Client({
      endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: secret },
      maxAttempts: 5,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
    if (!input) this.clientCache = { key, client };
    return client;
  }
  async test(input: R2ConnectionInput) {
    const resolved = await this.config.resolveInput(input);
    const client = await this.clientFor(resolved);
    await client.send(new ListBucketsCommand({}));
  }
  async buckets() {
    const r = await (await this.clientFor()).send(new ListBucketsCommand({}));
    return (r.Buckets ?? [])
      .map((x) => ({ name: x.Name ?? '', createdAt: x.CreationDate?.toISOString() ?? null }))
      .filter((x) => x.name);
  }
  async createBucket(name: string) {
    if (!BUCKET.test(name))
      throw new Error('バケット名は3～63文字の小文字、数字、ハイフンで入力してください。');
    await (await this.clientFor()).send(new CreateBucketCommand({ Bucket: name }));
  }
  async deleteBucket(name: string) {
    const client = await this.clientFor();
    const probe = await client.send(new ListObjectsV2Command({ Bucket: name, MaxKeys: 1 }));
    if ((probe.KeyCount ?? 0) > 0) throw new Error('ファイルが存在するバケットは削除できません。');
    await client.send(new DeleteBucketCommand({ Bucket: name }));
  }
  async list(bucket: string, prefix = '', token?: string | null): Promise<R2ListResult> {
    if (!bucket) throw new Error('バケットを指定してください。');
    const r = await (await this.clientFor()).send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
        MaxKeys: 500,
        ContinuationToken: token || undefined,
      }),
    );
    return {
      folders: (r.CommonPrefixes ?? [])
        .map((x) => x.Prefix ?? '')
        .filter(Boolean)
        .map((p) => ({ prefix: p, name: p.slice(prefix.length).replace(/\/$/, '') })),
      objects: (r.Contents ?? [])
        .filter((x) => x.Key && x.Key !== prefix && !x.Key.endsWith('/'))
        .map((x) => serializeObject(x, prefix)),
      nextToken: r.NextContinuationToken ?? null,
    };
  }
  async search(bucket: string, query: string, token?: string | null): Promise<R2SearchResult> {
    const q = query.trim().toLowerCase();
    if (!q) throw new Error('検索文字列を入力してください。');
    const client = await this.clientFor();
    let continuation = token || undefined,
      scanned = 0;
    const objects: R2Object[] = [];
    for (let page = 0; page < 10 && scanned < 1000 && objects.length < 100; page++) {
      const r = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          MaxKeys: Math.min(100, 1000 - scanned),
          ContinuationToken: continuation,
        }),
      );
      scanned += (r.Contents ?? []).length;
      for (const item of r.Contents ?? []) {
        if (item.Key && !item.Key.endsWith('/') && item.Key.toLowerCase().includes(q))
          objects.push(serializeObject(item));
        if (objects.length >= 100) break;
      }
      continuation = r.NextContinuationToken;
      if (!continuation) break;
    }
    return { objects, nextToken: continuation ?? null, scanned };
  }
  async objectMetadata(bucket: string, key: string) {
    if (!bucket || !key) throw new Error('R2 bucket/object key is required.');
    const head = await (await this.clientFor()).send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    const metadataSha = head.Metadata?.sha256 ?? head.Metadata?.['sha-256'] ?? head.ChecksumSHA256;
    return {
      key,
      size: Number(head.ContentLength ?? 0),
      sha256: sha256Hex(metadataSha),
      etag: String(head.ETag ?? '').replace(/^"|"$/g, ''),
    };
  }
  async objectExists(bucket: string, key: string) {
    try {
      await this.objectMetadata(bucket, key);
      return true;
    } catch (error) {
      if (statusCode(error) === 404) return false;
      throw error;
    }
  }
  async syncObjectIndex() {
    await this.objectIndex.sync();
  }
  async resolveModelObjectKey(bucket: string, relativePath: string, prefix = '') {
    return this.objectIndex.resolveModelKey(bucket, relativePath, prefix);
  }
  private async signed(bucket: string, key: string, expiresIn = 3600) {
    const settings = await this.config.credentials();
    if (settings.publicUrl)
      return {
        url: publicObjectUrl(settings.publicUrl, key),
        public: true,
        expiresIn: null as number | null,
      };
    const url = await getSignedUrl(
      await this.clientFor(),
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn },
    );
    return { url, public: false, expiresIn };
  }
  private info(
    key: string,
    url: string,
    isPublic: boolean,
    expiresIn: number | null,
    fileName = objectName(key),
  ): R2DownloadInfo {
    return {
      key,
      url,
      public: isPublic,
      expiresIn,
      fileName,
      commands: {
        url,
        curl: `curl -L --fail --output ${quote(fileName)} ${quote(url)}`,
        wget: `wget -O ${quote(fileName)} ${quote(url)}`,
        aria2c: `aria2c -o ${quote(fileName)} ${quote(url)}`,
      },
    };
  }
  async downloadInfo(bucket: string, key: string, expiresIn = 3600) {
    const d = await this.signed(bucket, key, expiresIn);
    return this.info(key, d.url, d.public, d.expiresIn);
  }
  async batchDownloadInfo(bucket: string, keys: string[], expiresIn = 3600) {
    assertDownloadBatch(keys);
    const names = uniqueDownloadNames(keys);
    return Promise.all(
      keys.map(async (key, i) => {
        const d = await this.signed(bucket, key, expiresIn);
        return this.info(key, d.url, d.public, d.expiresIn, names[i]);
      }),
    );
  }
  async putUrlInfo(
    bucket: string,
    rawKey: string,
    expiresIn = 3600,
    rawContentType = '',
  ): Promise<R2PutUrlInfo> {
    if (!bucket) throw new Error('バケットを指定してください。');
    const key = normalizeR2PutObjectKey(rawKey),
      expires = normalizeR2PresignedExpiresIn(expiresIn),
      contentType = normalizeR2PutContentType(rawContentType);
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(contentType ? { ContentType: contentType } : {}),
    });
    const url = await getSignedUrl(await this.clientFor(), command, { expiresIn: expires });
    const fileName = objectName(key),
      contentTypeArg = contentType ? ` -H ${quote(`Content-Type: ${contentType}`)}` : '';
    return {
      key,
      url,
      expiresIn: expires,
      contentType,
      commands: {
        url,
        curl: `curl --fail -X PUT${contentTypeArg} --data-binary ${quote(`@${fileName}`)} ${quote(url)}`,
      },
    };
  }
  async beginExecutionMultipart(bucket: string, rawKey: string, size: number, sha256: string) {
    const key = normalizeR2PutObjectKey(rawKey),
      digest = sha256Hex(sha256);
    if (!bucket) throw new Error('R2 bucket is required for execution artifact upload.');
    if (!Number.isSafeInteger(size) || size <= R2_SINGLE_PUT_LIMIT)
      throw new Error('Multipart execution upload requires a package above the single PUT limit.');
    if (!digest) throw new Error('Execution artifact SHA-256 is invalid.');
    const chunk = partSize(size),
      partCount = Math.ceil(size / chunk);
    if (partCount < 2 || partCount > MAX_PARTS)
      throw new Error('Execution artifact exceeds the supported multipart part count.');
    const created = await (await this.clientFor()).send(
      new CreateMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        ContentType: 'application/zip',
        Metadata: { sha256: digest },
      }),
    );
    const uploadId = created.UploadId ?? '';
    if (!uploadId) throw new Error('R2 multipart upload did not return an upload ID.');
    return { bucket, key, uploadId, partSize: chunk, partCount, size, sha256: digest };
  }
  async executionMultipartPartUrl(
    bucket: string,
    rawKey: string,
    uploadId: string,
    partNumber: number,
    expiresIn = 900,
  ) {
    const key = normalizeR2PutObjectKey(rawKey),
      expires = normalizeR2PresignedExpiresIn(expiresIn);
    if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > MAX_PARTS)
      throw new Error('Invalid R2 multipart upload part.');
    const command = new UploadPartCommand({
      Bucket: bucket,
      Key: key,
      UploadId: uploadId,
      PartNumber: partNumber,
    });
    return {
      url: await getSignedUrl(await this.clientFor(), command, { expiresIn: expires }),
      expiresIn: expires,
    };
  }
  async completeExecutionMultipart(
    bucket: string,
    rawKey: string,
    uploadId: string,
    parts: Array<{ PartNumber: number; ETag: string }>,
  ) {
    const key = normalizeR2PutObjectKey(rawKey);
    if (
      !uploadId ||
      !parts.length ||
      parts.some((part) => !Number.isInteger(part.PartNumber) || part.PartNumber < 1 || !part.ETag)
    )
      throw new Error('Invalid R2 multipart completion payload.');
    await (await this.clientFor()).send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      }),
    );
  }
  async abortExecutionMultipart(bucket: string, rawKey: string, uploadId: string) {
    const key = normalizeR2PutObjectKey(rawKey);
    if (!uploadId) return;
    await (await this.clientFor()).send(
      new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
    );
  }
  async downloadExecutionObject(bucket: string, rawKey: string, target: string) {
    const key = normalizeR2ObjectKey(rawKey),
      response = await (await this.clientFor()).send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
    if (!response.Body) throw new Error('R2 execution artifact download returned an empty body.');
    await pipeline(response.Body as any, createWriteStream(target, { flags: 'w' }));
  }
  async deleteExecutionObject(bucket: string, rawKey: string) {
    const key = normalizeR2ObjectKey(rawKey);
    await (await this.clientFor()).send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    this.syncIndex();
  }
  async deleteObjects(bucket: string, keys: string[]) {
    if (!keys.length) throw new Error('削除するファイルを選択してください。');
    if (keys.length > 1000) throw new Error('一度に削除できるのは1,000件までです。');
    const r = await (await this.clientFor()).send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: false },
      }),
    );
    return {
      deleted: (r.Deleted ?? []).map((x) => x.Key ?? '').filter(Boolean),
      errors: r.Errors ?? [],
    };
  }
  async move(bucket: string, sourceKey: string, destinationKey: string, overwrite = false) {
    return this.transfers.move(bucket, sourceKey, destinationKey, overwrite);
  }
  async uploads() {
    return this.transfers.uploads();
  }
  async beginUpload(bucket: string, prefix: string, filePath: string, overwrite = false) {
    return this.transfers.beginUpload(bucket, prefix, filePath, overwrite);
  }
  async resumeUpload(id: string) {
    return this.transfers.resumeUpload(id);
  }
  async pauseUpload(id: string) {
    return this.transfers.pauseUpload(id);
  }
  async cancelUpload(id: string) {
    return this.transfers.cancelUpload(id);
  }
  private async readTransferJobs() {
    return (await readJson<UploadState>(this.uploadsPath))?.jobs ?? [];
  }
  private async saveTransferJob(job: R2UploadJob) {
    const jobs = await this.readTransferJobs(),
      i = jobs.findIndex((x) => x.id === job.id);
    if (i < 0) jobs.push(job);
    else jobs[i] = job;
    await writeJsonAtomic(this.uploadsPath, { schemaVersion: 1, jobs });
  }
  private async templateState() {
    return (
      (await readJson<TemplateState>(this.templatesPath)) ?? {
        schemaVersion: 1 as const,
        templates: [],
      }
    );
  }
  async templates(bucket?: string) {
    const s = await this.templateState();
    return bucket ? s.templates.filter((x) => x.bucket === bucket) : s.templates;
  }
  async saveTemplate(input: R2TemplateInput) {
    return withTemplateStoreLock(this.templatesPath, async () => {
      const s = await this.templateState();
      s.templates = saveR2Template(s.templates, input, new Date().toISOString(), randomUUID);
      await writeJsonAtomic(this.templatesPath, s);
      return s.templates;
    });
  }
  async deleteTemplate(id: string) {
    return withTemplateStoreLock(this.templatesPath, async () => {
      const s = await this.templateState();
      s.templates = deleteSavedTemplate(s.templates, id);
      await writeJsonAtomic(this.templatesPath, s);
      return s.templates;
    });
  }
  async metrics() {
    const c = await this.config.credentials();
    if (!c.cloudflareApiToken) return { configured: false };
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${c.accountId}/r2/metrics`,
      {
        headers: {
          Authorization: `Bearer ${c.cloudflareApiToken}`,
          Accept: 'application/json',
          'Cache-Control': 'no-cache',
        },
      },
    );
    if (!res.ok)
      throw new Error(
        res.status === 401 || res.status === 403
          ? 'Cloudflare API Tokenが無効か、R2読み取り権限がありません。'
          : `使用量APIがエラーを返しました（HTTP ${res.status}）。`,
      );
    const payload: any = await res.json();
    if (!payload?.success || typeof payload?.result !== 'object')
      throw new Error(
        payload?.errors?.[0]?.message || 'Cloudflare使用量APIから正常な応答がありません。',
      );
    const result = payload.result;
    const value = (group: any, state: string, field: string) =>
      Number(group?.[state]?.[field] ?? 0);
    const classes = {
      standard: result.standard ?? {},
      infrequent_access: result.infrequentAccess ?? {},
    };
    const breakdown = Object.fromEntries(
      Object.entries(classes).map(([name, g]: any) => {
        const payload = value(g, 'published', 'payloadSize'),
          metadata = value(g, 'published', 'metadataSize');
        return [
          name,
          {
            stored_bytes: payload + metadata,
            payload_bytes: payload,
            metadata_bytes: metadata,
            objects: value(g, 'published', 'objects'),
            uploading_bytes:
              value(g, 'uploaded', 'payloadSize') + value(g, 'uploaded', 'metadataSize'),
          },
        ];
      }),
    );
    const rows = Object.values(breakdown) as any[];
    return {
      configured: true,
      payload: {
        stored_bytes: rows.reduce((n, x) => n + x.stored_bytes, 0),
        payload_bytes: rows.reduce((n, x) => n + x.payload_bytes, 0),
        metadata_bytes: rows.reduce((n, x) => n + x.metadata_bytes, 0),
        objects: rows.reduce((n, x) => n + x.objects, 0),
        uploading_bytes: rows.reduce((n, x) => n + x.uploading_bytes, 0),
        storage_classes: breakdown,
      },
    };
  }
}
