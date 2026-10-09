import { randomUUID } from 'node:crypto';
import { HttpFailure } from './http.js';
import type { R2Port } from './r2-gateway.js';
export const r2InternalPrefix = '.batch-studio/';
export async function verifyR2ConditionalDelete(
  port: R2Port,
  bucket: string,
  receipt: string,
): Promise<void> {
  const key = r2InternalPrefix + 'probes/' + receipt + '-' + randomUUID();
  const created = await port.send('PutObject', {
    Bucket: bucket,
    Key: key,
    Body: Buffer.from('x'),
    ContentLength: 1,
    IfNoneMatch: '*',
    Metadata: { 'batch-operation': receipt },
  });
  if (typeof created.ETag !== 'string') throw new HttpFailure(502, 'R2_PROTOCOL');
  let rejected = false;
  try {
    await port.send('DeleteObject', {
      Bucket: bucket,
      Key: key,
      IfMatch: '"never-match-' + randomUUID() + '"',
    });
  } catch (error) {
    if ((error as any)?.$metadata?.httpStatusCode === 412) rejected = true;
    else throw error;
  }
  if (!rejected) throw new HttpFailure(503, 'R2_CONDITIONAL_DELETE_UNAVAILABLE');
  const observed = await port.send('HeadObject', { Bucket: bucket, Key: key });
  if (
    observed.ETag !== created.ETag ||
    observed.ContentLength !== 1 ||
    observed.Metadata?.['batch-operation'] !== receipt
  )
    throw new HttpFailure(409, 'R2_PROBE_CHANGED');
  await port.send('DeleteObject', { Bucket: bucket, Key: key, IfMatch: created.ETag });
}
export async function verifyR2ConditionalCompletion(
  port: R2Port,
  bucket: string,
  receipt: string,
): Promise<void> {
  const key = r2InternalPrefix + 'probes/' + receipt + '-' + randomUUID(),
    metadata = { 'batch-operation': receipt };
  const existing = await port.send('PutObject', {
    Bucket: bucket,
    Key: key,
    Body: Buffer.from('x'),
    ContentLength: 1,
    IfNoneMatch: '*',
    Metadata: metadata,
  });
  if (typeof existing.ETag !== 'string') throw new HttpFailure(502, 'R2_PROTOCOL');
  const started = await port.send('CreateMultipartUpload', {
    Bucket: bucket,
    Key: key,
    ContentType: 'application/octet-stream',
    Metadata: metadata,
  });
  if (typeof started.UploadId !== 'string' || !started.UploadId)
    throw new HttpFailure(502, 'R2_PROTOCOL');
  const part = await port.send('UploadPart', {
    Bucket: bucket,
    Key: key,
    UploadId: started.UploadId,
    PartNumber: 1,
    Body: Buffer.from('y'),
    ContentLength: 1,
  });
  if (typeof part.ETag !== 'string') throw new HttpFailure(502, 'R2_PROTOCOL');
  let rejected = false;
  try {
    await port.send('CompleteMultipartUpload', {
      Bucket: bucket,
      Key: key,
      UploadId: started.UploadId,
      IfNoneMatch: '*',
      MultipartUpload: { Parts: [{ PartNumber: 1, ETag: part.ETag }] },
    });
  } catch (error) {
    if ((error as any)?.$metadata?.httpStatusCode === 412) rejected = true;
    else throw error;
  }
  if (!rejected) throw new HttpFailure(503, 'R2_CONDITIONAL_COMPLETE_UNAVAILABLE');
  const observed = await port.send('HeadObject', { Bucket: bucket, Key: key });
  if (observed.ETag !== existing.ETag || observed.Metadata?.['batch-operation'] !== receipt)
    throw new HttpFailure(409, 'R2_PROBE_CHANGED');
  await port.send('AbortMultipartUpload', { Bucket: bucket, Key: key, UploadId: started.UploadId });
  await port.send('DeleteObject', { Bucket: bucket, Key: key, IfMatch: existing.ETag });
}
