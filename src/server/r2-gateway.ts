import {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  CreateBucketCommand,
  DeleteBucketCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  UploadPartCopyCommand,
  ListPartsCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { IntegrationSettings } from './integration-settings.js';
import { HttpFailure } from './http.js';
const commands = {
  ListBuckets: ListBucketsCommand,
  ListObjectsV2: ListObjectsV2Command,
  HeadObject: HeadObjectCommand,
  GetObject: GetObjectCommand,
  PutObject: PutObjectCommand,
  CreateBucket: CreateBucketCommand,
  DeleteBucket: DeleteBucketCommand,
  DeleteObject: DeleteObjectCommand,
  DeleteObjects: DeleteObjectsCommand,
  CopyObject: CopyObjectCommand,
  CreateMultipartUpload: CreateMultipartUploadCommand,
  UploadPart: UploadPartCommand,
  UploadPartCopy: UploadPartCopyCommand,
  ListParts: ListPartsCommand,
  CompleteMultipartUpload: CompleteMultipartUploadCommand,
  AbortMultipartUpload: AbortMultipartUploadCommand,
};
export type R2OperationName = keyof typeof commands;
export interface R2Port {
  send(name: R2OperationName, input: Record<string, unknown>, signal?: AbortSignal): Promise<any>;
  signed(
    name: 'GetObject' | 'PutObject',
    input: Record<string, unknown>,
    expiresIn: number,
  ): Promise<string>;
}
export class R2Gateway implements R2Port {
  readonly metrics = { requests: 0, errors: 0 };
  private client: S3Client | undefined;
  private fingerprint = '';
  constructor(private readonly settings: IntegrationSettings) {}
  private resolve(): S3Client {
    const config = this.settings.resolve('r2');
    if (config.fingerprint !== this.fingerprint) {
      this.client?.destroy();
      this.client = new S3Client({
        region: 'auto',
        endpoint: 'https://' + config.account + '.r2.cloudflarestorage.com',
        forcePathStyle: true,
        followRegionRedirects: false,
        maxAttempts: 1,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        credentials: {
          accessKeyId: config.secrets.accessKeyId,
          secretAccessKey: config.secrets.secretAccessKey,
        },
      });
      this.fingerprint = config.fingerprint;
    }
    return this.client!;
  }
  async send(
    name: R2OperationName,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<any> {
    const client = this.resolve();
    const command = commands[name];
    if (!command) throw new HttpFailure(400, 'INVALID_INPUT');
    this.metrics.requests++;
    try {
      return await client.send(new (command as new (input: any) => any)(input), {
        abortSignal: AbortSignal.any([
          AbortSignal.timeout(name === 'GetObject' ? 30 * 60_000 : 30_000),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch (e) {
      this.metrics.errors++;
      throw e;
    }
  }
  async signed(
    name: 'GetObject' | 'PutObject',
    input: Record<string, unknown>,
    expiresIn: number,
  ): Promise<string> {
    return getSignedUrl(
      this.resolve(),
      name === 'GetObject'
        ? new GetObjectCommand(input as any)
        : new PutObjectCommand(input as any),
      { expiresIn },
    );
  }
  close(): void {
    this.client?.destroy();
  }
}
