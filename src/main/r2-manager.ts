import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
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
const UPLOAD_CONCURRENCY = 3,
  UPLOAD_RETRIES = 3;
const BUCKET = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const SOURCE_CHANGED = 'R2_UPLOAD_SOURCE_CHANGED';
function sourceStat(st: Awaited<ReturnType<typeof stat>>) {
  return {
    size: st.size,
    mtimeMs: st.mtimeMs,
    ctimeMs: st.ctimeMs,
    dev: st.dev,
    ino: st.ino,
  };
}
function sameSourceStat(
  baseline: Pick<R2UploadSourceFingerprint, 'size' | 'mtimeMs' | 'ctimeMs' | 'dev' | 'ino'>,
  current: ReturnType<typeof sourceStat>,
) {
  return (
    baseline.size === current.size &&
    baseline.mtimeMs === current.mtimeMs &&
    baseline.ctimeMs === current.ctimeMs &&
    baseline.dev === current.dev &&
    baseline.ino === current.ino
  );
}
function sourceChanged(reason: string): Error {
  return new Error(
    `${SOURCE_CHANGED}: ${reason}。既存Partを再利用せず、新しいアップロードを開始してください。`,
  );
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
async function assertSourceFingerprint(
  filePath: string,
  expected: R2UploadSourceFingerprint,
  uploadPartSize: number,
) {
  const current = await fingerprintUploadSource(filePath, uploadPartSize);
  if (
    !sameSourceStat(expected, current) ||
    current.sha256 !== expected.sha256 ||
    current.partSha256.length !== expected.partSha256.length ||
    current.partSha256.some((digest, i) => digest !== expected.partSha256[i])
  )
    throw sourceChanged('元ファイルの内容・サイズ・更新時刻・ファイルIDが変わりました');
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
function uniqueNames(keys: string[]) {
  const used = new Map<string, number>();
  return keys.map((key) => {
    const raw = objectName(key),
      lower = raw.toLowerCase(),
      count = (used.get(lower) ?? 0) + 1;
    used.set(lower, count);
    if (count === 1) return raw;
    const dot = raw.lastIndexOf('.');
    return dot > 0 ? `${raw.slice(0, dot)} (${count})${raw.slice(dot)}` : `${raw} (${count})`;
  });
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
function legacyTemplate(value: unknown, fallbackId: string): R2BatchDownloadTemplate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>,
    bucket = String(v.bucket ?? '').trim(),
    name = String(v.name ?? '').trim();
  if (
    !bucket ||
    !name ||
    !Array.isArray(v.objects) ||
    v.objects.length < 1 ||
    v.objects.length > 500
  )
    return null;
  const objects: Array<{ key: string; name: string; size?: number }> = [];
  const seen = new Set<string>();
  for (const raw of v.objects) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>,
      key = String(item.key ?? '').trim();
    if (!key || seen.has(key) || Buffer.byteLength(key) > 1024) continue;
    seen.add(key);
    const size = Number(item.size ?? 0);
    objects.push({
      key,
      name: objectName(key),
      size: Number.isFinite(size) && size >= 0 ? size : 0,
    });
  }
  if (!objects.length) return null;
  const now = new Date().toISOString(),
    created = String(v.created_at ?? v.createdAt ?? now),
    updated = String(v.updated_at ?? v.updatedAt ?? created);
  const id = String(v.id ?? fallbackId).trim() || randomUUID();
  return { id, name, bucket, createdAt: created, updatedAt: updated, objects };
}

interface UploadControl {
  paused: boolean;
  cancelled: boolean;
  completing: boolean;
  generation: string;
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
  private readonly templateMigration: Promise<void>;
  private readonly objectIndex: R2ObjectIndex;
  private controls = new Map<string, UploadControl>();
  private readonly startingUploads = new Map<string, Promise<R2UploadJob>>();
  private readonly activeUploads = new Map<string, Promise<void>>();
  private readonly cancellingUploads = new Map<string, Promise<R2UploadJob | undefined>>();
  private readonly cancellationRequested = new Set<string>();
  private activeMoveJobs = new Set<string>();
  private saveQueue: Promise<void> = Promise.resolve();
  constructor(
    private readonly config: R2ConfigStore,
    private readonly userData: string,
  ) {
    this.uploadsPath = path.join(userData, 'r2', 'uploads.json');
    this.templatesPath = path.join(userData, 'r2', 'batch-download-templates.json');
    this.objectIndex = new R2ObjectIndex(config, userData);
    this.templateMigration = this.migrateLegacyTemplates().catch((error) => {
      console.warn('Legacy R2 template migration failed:', error);
    });
  }
  private syncIndex() {
    void this.objectIndex.sync().catch((error) => console.warn('R2 index sync failed:', error));
  }
  private async migrateLegacyTemplates() {
    const localAppData = process.env.LOCALAPPDATA?.trim();
    if (!localAppData) return;
    const legacyPath = path.join(localAppData, 'R2 File Manager', 'batch_download_templates.json');
    if (!(await exists(legacyPath))) return;
    const raw = await readJson<Record<string, unknown>>(legacyPath);
    if (!raw || Array.isArray(raw) || typeof raw !== 'object') return;
    await withTemplateStoreLock(this.templatesPath, async () => {
      const current = (await readJson<TemplateState>(this.templatesPath)) ?? {
        schemaVersion: 1 as const,
        templates: [],
      };
      const ids = new Set(current.templates.map((x) => x.id));
      const names = new Set(
        current.templates.map((x) => `${x.bucket}\u0000${x.name.toLocaleLowerCase()}`),
      );
      let changed = false;
      for (const [fallbackId, value] of Object.entries(raw)) {
        const converted = legacyTemplate(value, fallbackId);
        if (!converted) continue;
        const nameKey = `${converted.bucket}\u0000${converted.name.toLocaleLowerCase()}`;
        if (ids.has(converted.id) || names.has(nameKey)) continue;
        current.templates.push(converted);
        ids.add(converted.id);
        names.add(nameKey);
        changed = true;
      }
      if (changed) await writeJsonAtomic(this.templatesPath, current);
    });
  }
  async settings() {
    return this.config.status();
  }
  environment() {
    return this.config.environmentDefaults();
  }
  async saveSettings(input: R2ConnectionInput) {
    await this.test(input);
    this.clientCache = null;
    return this.config.save(input);
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
    if (!keys.length || keys.length > 500)
      throw new Error('一度に生成できるダウンロードURLは1～500件です。');
    const names = uniqueNames(keys);
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
    const destination = normalizeR2ObjectKey(destinationKey);
    if (!sourceKey || sourceKey === destination)
      throw new Error('移動元と異なる移動先を指定してください。');
    const client = await this.clientFor();
    if (!overwrite) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: destination }));
        throw new Error('移動先に同名のファイルが存在します。');
      } catch (e: any) {
        if (e instanceof Error && e.message.includes('同名')) throw e;
        if (statusCode(e) !== 404 && e?.name !== 'NotFound') throw e;
      }
    }
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: sourceKey }));
    const size = Number(head.ContentLength ?? 0),
      now = new Date().toISOString();
    const job: any = {
      id: randomUUID(),
      kind: 'move',
      bucket,
      key: destination,
      filePath: '',
      fileName: objectName(destination),
      sourceKey,
      destinationKey: destination,
      size,
      contentType: 'application/octet-stream',
      uploadId: null,
      partSize: 0,
      completedParts: {},
      status: 'uploading',
      transferredBytes: 0,
      error: '',
      createdAt: now,
      startedAt: now,
      initialTransferredBytes: 0,
    };
    await this.saveUpload(job);
    this.activeMoveJobs.add(job.id);
    void this.runMove(job, sourceKey, destination, size);
    return job;
  }
  private async runMove(job: any, sourceKey: string, destinationKey: string, size: number) {
    const client = await this.clientFor(),
      copySource = `${job.bucket}/${encodeKey(sourceKey)}`;
    let multipartUploadId: string | null = null;
    try {
      if (size <= FIVE_GIB) {
        await client.send(
          new CopyObjectCommand({
            Bucket: job.bucket,
            Key: destinationKey,
            CopySource: copySource,
          }),
        );
        job.transferredBytes = size;
        await this.saveUpload(job);
      } else {
        const chunk = Math.max(64 * MIB, partSize(size));
        const create = await client.send(
          new CreateMultipartUploadCommand({ Bucket: job.bucket, Key: destinationKey }),
        );
        multipartUploadId = create.UploadId ?? null;
        if (!multipartUploadId) throw new Error('Multipart copyを開始できませんでした。');
        const parts = [] as Array<{ ETag?: string; PartNumber: number }>;
        for (let start = 0, n = 1; start < size; start += chunk, n++) {
          const end = Math.min(size - 1, start + chunk - 1);
          const p = await client.send(
            new UploadPartCopyCommand({
              Bucket: job.bucket,
              Key: destinationKey,
              UploadId: multipartUploadId,
              PartNumber: n,
              CopySource: copySource,
              CopySourceRange: `bytes=${start}-${end}`,
            }),
          );
          parts.push({ PartNumber: n, ETag: p.CopyPartResult?.ETag });
          job.transferredBytes = Math.min(size, end + 1);
          await this.saveUpload(job);
        }
        await client.send(
          new CompleteMultipartUploadCommand({
            Bucket: job.bucket,
            Key: destinationKey,
            UploadId: multipartUploadId,
            MultipartUpload: { Parts: parts },
          }),
        );
      }
      await client.send(new DeleteObjectCommand({ Bucket: job.bucket, Key: sourceKey }));
      job.status = 'complete';
      job.transferredBytes = size;
      job.completedAt = new Date().toISOString();
      await this.saveUpload(job);
      this.syncIndex();
    } catch (e) {
      if (multipartUploadId)
        await client
          .send(
            new AbortMultipartUploadCommand({
              Bucket: job.bucket,
              Key: destinationKey,
              UploadId: multipartUploadId,
            }),
          )
          .catch(() => {});
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      job.completedAt = new Date().toISOString();
      await this.saveUpload(job);
    } finally {
      this.activeMoveJobs.delete(job.id);
    }
  }
  private async uploadState() {
    return (
      (await readJson<UploadState>(this.uploadsPath)) ?? { schemaVersion: 1 as const, jobs: [] }
    );
  }
  private async saveUploadNow(job: R2UploadJob) {
    const s = await this.uploadState(),
      i = s.jobs.findIndex((x) => x.id === job.id);
    if (i >= 0) s.jobs[i] = { ...job };
    else s.jobs.push({ ...job });
    await writeJsonAtomic(this.uploadsPath, s);
  }
  private async saveUpload(job: R2UploadJob) {
    // Capture the state at enqueue time: later worker mutations must not
    // rewrite an earlier save with an unintended newer status.
    const snapshot = structuredClone(job);
    const task = this.saveQueue.then(() => this.saveUploadNow(snapshot));
    this.saveQueue = task.catch(() => {});
    return task;
  }
  async uploads() {
    const s = await this.uploadState();
    return s.jobs.map((j: any) =>
      j.kind === 'move' && j.status === 'uploading' && !this.activeMoveJobs.has(j.id)
        ? {
            ...j,
            status: 'failed' as const,
            error: 'アプリ再起動により移動処理が中断されました。状態を確認して再実行してください。',
          }
        : j.kind !== 'move' && j.status === 'uploading' && !this.controls.has(j.id)
          ? { ...j, status: 'paused' as const }
          : j,
    );
  }
  async beginUpload(bucket: string, prefix: string, filePath: string, overwrite = false) {
    if (!(await exists(filePath))) throw new Error('アップロード元ファイルが見つかりません。');
    const st = await stat(filePath),
      sourceFingerprint = await fingerprintUploadSource(filePath, partSize(st.size)),
      name = path.basename(filePath),
      key = `${prefix.replace(/^\/+|\/+$/g, '')}${prefix ? '/' : ''}${name}`;
    if (Buffer.byteLength(key) > 1024)
      throw new Error('オブジェクト名が1,024バイトを超えています。');
    const client = await this.clientFor();
    if (!overwrite) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        throw new Error('同名のファイルが存在します。');
      } catch (e: any) {
        if (e instanceof Error && e.message.includes('同名')) throw e;
        if (statusCode(e) !== 404 && e?.name !== 'NotFound') throw e;
      }
    }
    let uploadId: string | null = null;
    if (st.size > 0) {
      const r = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: 'application/octet-stream',
        }),
      );
      uploadId = r.UploadId ?? null;
      if (!uploadId) throw new Error('Multipart uploadを開始できませんでした。');
    }
    const job: any = {
      id: randomUUID(),
      kind: 'upload',
      bucket,
      key,
      filePath,
      fileName: name,
      size: st.size,
      sourceFingerprint,
      hashProgressBytes: st.size,
      contentType: 'application/octet-stream',
      uploadId,
      partSize: partSize(st.size),
      completedParts: {},
      status: 'paused',
      transferredBytes: 0,
      error: '',
      createdAt: new Date().toISOString(),
    };
    await this.saveUpload(job);
    void this.resumeUpload(job.id);
    return job;
  }
  async resumeUpload(id: string): Promise<R2UploadJob> {
    const inFlight = this.startingUploads.get(id);
    if (inFlight) return inFlight;
    if (this.cancellationRequested.has(id))
      throw new Error('このアップロードはキャンセル処理中です。');
    const active = this.controls.get(id);
    if (active) {
      const state = await this.uploadState();
      const job = state.jobs.find((item) => item.id === id);
      if (!job) throw new Error('アップロードセッションが見つかりません。');
      return job;
    }
    const control: UploadControl = {
      paused: false,
      cancelled: false,
      completing: false,
      generation: randomUUID(),
    };
    // Register synchronously before the first await. Both IPC duplicate Resume
    // and concurrent Pause/Cancel now reference the same worker control.
    this.controls.set(id, control);
    const starter = this.startUpload(id, control).finally(() => {
      if (this.startingUploads.get(id) === starter) this.startingUploads.delete(id);
    });
    this.startingUploads.set(id, starter);
    return starter;
  }
  private async startUpload(id: string, control: UploadControl): Promise<R2UploadJob> {
    try {
      const state = await this.uploadState(),
        job = state.jobs.find((item) => item.id === id);
      if (!job) throw new Error('アップロードセッションが見つかりません。');
      if (job.kind === 'move') throw new Error('移動ジョブは再開操作できません。');
      if (job.status === 'complete' || job.status === 'cancelled') return job;
      if (!(await exists(job.filePath))) throw new Error('元ファイルが見つかりません。');
      if (!job.sourceFingerprint) {
        if (Object.keys(job.completedParts).length)
          throw sourceChanged(
            '旧形式のジョブには完了済みPartの内容ハッシュがないため再開できません',
          );
        job.sourceFingerprint = await fingerprintUploadSource(job.filePath, job.partSize);
        job.hashProgressBytes = job.size;
        await this.saveUpload(job);
      } else {
        await assertSourceFingerprint(job.filePath, job.sourceFingerprint, job.partSize);
        job.hashProgressBytes = job.size;
      }
      if (control.cancelled || control.paused) return job;
      job.status = 'uploading';
      job.error = '';
      job.startedAt = new Date().toISOString();
      job.initialTransferredBytes = job.transferredBytes;
      await this.saveUpload(job);
      const worker = this.runUpload(job, control).finally(() => {
        if (this.activeUploads.get(id) === worker) this.activeUploads.delete(id);
        if (this.controls.get(id) === control) this.controls.delete(id);
      });
      this.activeUploads.set(id, worker);
      return job;
    } catch (error) {
      if (this.controls.get(id) === control) this.controls.delete(id);
      throw error;
    } finally {
      // No worker was started for terminal/invalid jobs.
      if (!this.activeUploads.has(id) && this.controls.get(id) === control)
        this.controls.delete(id);
    }
  }
  private async uploadPartWithRetry(
    job: any,
    number: number,
    client: S3Client,
    control: UploadControl,
  ) {
    const start = (number - 1) * job.partSize,
      end = Math.min(job.size - 1, start + job.partSize - 1),
      length = end - start + 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= UPLOAD_RETRIES; attempt++) {
      if (control.cancelled || control.paused) return false;
      try {
        const r = await client.send(
          new UploadPartCommand({
            Bucket: job.bucket,
            Key: job.key,
            UploadId: job.uploadId ?? undefined,
            PartNumber: number,
            Body: await verifiedUploadPart(
              job.filePath,
              start,
              length,
              job.sourceFingerprint,
              number,
            ),
            ContentLength: length,
          }),
        );
        if (!r.ETag) throw new Error(`Part ${number} のETagを取得できませんでした。`);
        job.completedParts[String(number)] = r.ETag;
        job.transferredBytes = Math.min(
          job.size,
          Object.keys(job.completedParts).reduce((total, key) => {
            const n = Number(key),
              partStart = (n - 1) * job.partSize,
              partEnd = Math.min(job.size, partStart + job.partSize);
            return total + Math.max(0, partEnd - partStart);
          }, 0),
        );
        await this.saveUpload(job);
        return true;
      } catch (e) {
        lastError = e;
        if (attempt < UPLOAD_RETRIES) await delay(700 * 2 ** (attempt - 1));
      }
    }
    throw lastError;
  }
  private async runUpload(job: any, control: UploadControl) {
    try {
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      const client = await this.clientFor();
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      if (job.size === 0) {
        if (control.cancelled || control.paused) return;
        control.completing = true;
        await client.send(
          new PutObjectCommand({
            Bucket: job.bucket,
            Key: job.key,
            Body: new Uint8Array(0),
            ContentType: job.contentType,
          }),
        );
        job.status = 'complete';
        job.completedAt = new Date().toISOString();
        await this.saveUpload(job);
        this.syncIndex();
        return;
      }
      if (!job.uploadId) throw new Error('Upload IDがありません。');
      const count = Math.ceil(job.size / job.partSize),
        queue: number[] = [];
      for (let n = 1; n <= count; n++) if (!job.completedParts[String(n)]) queue.push(n);
      let cursor = 0,
        failure: unknown = null;
      const worker = async () => {
        while (cursor < queue.length && !failure && !control.cancelled && !control.paused) {
          const number = queue[cursor++];
          try {
            await this.uploadPartWithRetry(job, number, client, control);
          } catch (e) {
            failure = e;
          }
        }
      };
      await Promise.all(
        Array.from({ length: Math.min(UPLOAD_CONCURRENCY, Math.max(queue.length, 1)) }, () =>
          worker(),
        ),
      );
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      if (failure) throw failure;
      await assertSourceFingerprint(job.filePath, job.sourceFingerprint, job.partSize);
      if (control.cancelled) return;
      if (control.paused) {
        job.status = 'paused';
        await this.saveUpload(job);
        return;
      }
      // Claim the completion phase synchronously with the final cancellation
      // check. Cancel waits for this request and never aborts a completed upload.
      control.completing = true;
      const parts = Array.from({ length: count }, (_, i) => ({
        PartNumber: i + 1,
        ETag: job.completedParts[String(i + 1)],
      }));
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: job.bucket,
          Key: job.key,
          UploadId: job.uploadId,
          MultipartUpload: { Parts: parts },
        }),
      );
      job.status = 'complete';
      job.transferredBytes = job.size;
      job.completedAt = new Date().toISOString();
      await this.saveUpload(job);
      this.syncIndex();
    } catch (e) {
      if (control.cancelled) return;
      job.status = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      job.completedAt = new Date().toISOString();
      await this.saveUpload(job);
      if (job.error.startsWith(SOURCE_CHANGED) && job.uploadId) {
        try {
          await (await this.clientFor()).send(
            new AbortMultipartUploadCommand({
              Bucket: job.bucket,
              Key: job.key,
              UploadId: job.uploadId,
            }),
          );
          job.uploadId = null;
          job.completedParts = {};
          await this.saveUpload(job);
        } catch {
          // Retain the upload ID so Cancel can retry cleanup if R2 is unavailable.
        }
      }
    }
  }
  async pauseUpload(id: string) {
    const control = this.controls.get(id);
    if (control) control.paused = true;
    // Wait for startup and every in-flight UploadPart/Complete request. Once
    // this returns, the previous generation cannot write any more state.
    await this.startingUploads.get(id)?.catch(() => {});
    await this.activeUploads.get(id)?.catch(() => {});
    const state = await this.uploadState(),
      job = state.jobs.find((item) => item.id === id);
    if (!job) throw new Error('アップロードセッションが見つかりません。');
    if (job.kind === 'move') throw new Error('移動ジョブは一時停止できません。');
    if (this.cancellationRequested.has(id)) return job;
    if (job.status === 'complete' || job.status === 'cancelled') return job;
    job.status = 'paused';
    await this.saveUpload(job);
    return job;
  }
  async cancelUpload(id: string): Promise<R2UploadJob | undefined> {
    const existing = this.cancellingUploads.get(id);
    if (existing) return existing;
    this.cancellationRequested.add(id);
    const control = this.controls.get(id);
    if (control) control.cancelled = true;
    const task = this.cancelUploadAfterDrain(id).finally(() => {
      if (this.cancellingUploads.get(id) === task) this.cancellingUploads.delete(id);
      this.cancellationRequested.delete(id);
    });
    this.cancellingUploads.set(id, task);
    return task;
  }
  private async cancelUploadAfterDrain(id: string): Promise<R2UploadJob | undefined> {
    await this.startingUploads.get(id)?.catch(() => {});
    await this.activeUploads.get(id)?.catch(() => {});
    const state = await this.uploadState(),
      job = state.jobs.find((item) => item.id === id);
    if (!job) return undefined;
    if (job.kind === 'move') throw new Error('移動ジョブはキャンセルできません。');
    // CompleteMultipartUpload may have entered S3 before Cancel was requested.
    // An already completed object is never relabeled cancelled or aborted.
    if (job.status === 'complete' || job.status === 'cancelled') return job;
    if (job.uploadId)
      await (await this.clientFor()).send(
        new AbortMultipartUploadCommand({
          Bucket: job.bucket,
          Key: job.key,
          UploadId: job.uploadId,
        }),
      );
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    await this.saveUpload(job);
    return job;
  }
  private async templateState() {
    await this.templateMigration;
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
  async saveTemplate(input: {
    id?: string;
    name: string;
    bucket: string;
    objects: Array<{ key: string; name: string; size?: number }>;
  }) {
    const name = normalizeBatchTemplateName(input.name),
      bucket = String(input.bucket ?? '').trim(),
      objects = normalizeBatchTemplateObjects(input.objects);
    if (!bucket) throw new Error('バケットを指定してください。');
    await this.templateMigration;
    return withTemplateStoreLock(this.templatesPath, async () => {
      const s = await this.templateState(),
        now = new Date().toISOString(),
        i = input.id ? s.templates.findIndex((x) => x.id === input.id) : -1;
      if (input.id && i < 0) throw new Error('テンプレートが見つかりません。');
      if (
        s.templates.some(
          (x, index) =>
            index !== i &&
            x.bucket === bucket &&
            x.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw new Error('同名のテンプレートがすでに存在します。');
      if (
        i < 0 &&
        s.templates.filter((x) => x.bucket === bucket).length >= MAX_BATCH_TEMPLATES_PER_BUCKET
      )
        throw new Error('1つのバケットに保存できるテンプレートは100件までです。');
      if (i >= 0 && s.templates[i].bucket !== bucket)
        throw new Error('テンプレートのバケットが一致しません。');
      const t: R2BatchDownloadTemplate = {
        id: input.id || randomUUID(),
        name,
        bucket,
        createdAt: i >= 0 ? s.templates[i].createdAt : now,
        updatedAt: now,
        objects,
      };
      if (i >= 0) s.templates[i] = t;
      else s.templates.push(t);
      await writeJsonAtomic(this.templatesPath, s);
      return s.templates;
    });
  }
  async deleteTemplate(id: string) {
    await this.templateMigration;
    return withTemplateStoreLock(this.templatesPath, async () => {
      const s = await this.templateState();
      s.templates = s.templates.filter((x) => x.id !== id);
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
