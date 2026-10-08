import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import type { R2UploadSourceFingerprint } from '../domain/integration-types.js';
import { sameSourceStat, sourceChanged } from '../domain/r2-transfer-policy.js';
export async function verifiedSourceHandle(file: string) {
  if ((await realpath(file)) !== file) throw sourceChanged('許可fileのalias');
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
    throw sourceChanged('許可fileのidentity');
  const handle = await open(file, 'r');
  try {
    const now = await handle.stat();
    if (
      now.dev !== stat.dev ||
      now.ino !== stat.ino ||
      now.nlink !== 1 ||
      (await realpath(file)) !== file
    )
      throw sourceChanged('許可fileの変更');
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}
export async function sourceFingerprint(
  file: string,
  expectedSha256: string,
  partSize: number,
  signal?: AbortSignal,
): Promise<R2UploadSourceFingerprint> {
  if (!Number.isSafeInteger(partSize) || partSize < 1 || partSize > 32 * 1024 * 1024)
    throw sourceChanged('part上限');
  const handle = await verifiedSourceHandle(file);
  try {
    const before = await handle.stat(),
      full = createHash('sha256'),
      parts: string[] = [];
    let part = createHash('sha256'),
      inPart = 0,
      bytes = 0;
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      signal?.throwIfAborted();
      const result = await handle.read(
        buffer,
        0,
        Math.min(buffer.length, partSize - inPart),
        bytes,
      );
      if (!result.bytesRead) break;
      const value = buffer.subarray(0, result.bytesRead);
      full.update(value);
      part.update(value);
      bytes += value.length;
      inPart += value.length;
      if (inPart === partSize) {
        parts.push(part.digest('hex'));
        part = createHash('sha256');
        inPart = 0;
      }
    }
    if (inPart) parts.push(part.digest('hex'));
    const sha256 = full.digest('hex'),
      after = await handle.stat();
    if (bytes !== before.size || !sameSourceStat(before, after) || sha256 !== expectedSha256)
      throw sourceChanged('登録hash/statとの不一致');
    return {
      size: before.size,
      mtimeMs: before.mtimeMs,
      ctimeMs: before.ctimeMs,
      dev: before.dev,
      ino: before.ino,
      sha256,
      partSha256: parts,
    };
  } finally {
    await handle.close();
  }
}
export async function verifiedSourcePart(
  file: string,
  start: number,
  length: number,
  baseline: R2UploadSourceFingerprint,
  partNumber: number,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(start) ||
    start < 0 ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > 32 * 1024 * 1024 ||
    !Number.isSafeInteger(partNumber) ||
    partNumber < 1 ||
    start + length > baseline.size
  )
    throw sourceChanged('part範囲');
  const handle = await verifiedSourceHandle(file);
  try {
    const before = await handle.stat();
    if (!sameSourceStat(baseline, before)) throw sourceChanged('part開始前の変更');
    const buffer = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      signal?.throwIfAborted();
      const result = await handle.read(buffer, read, length - read, start + read);
      if (!result.bytesRead) throw sourceChanged('partの切断');
      read += result.bytesRead;
    }
    const after = await handle.stat();
    if (
      !sameSourceStat(baseline, after) ||
      createHash('sha256').update(buffer).digest('hex') !== baseline.partSha256[partNumber - 1]
    )
      throw sourceChanged('part内容の変更');
    return buffer;
  } finally {
    await handle.close();
  }
}
