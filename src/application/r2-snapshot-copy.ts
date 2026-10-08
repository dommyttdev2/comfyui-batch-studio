export interface R2SnapshotCopyPorts {
  begin(): Promise<string>;
  read(start: number, length: number): Promise<Uint8Array>;
  upload(uploadId: string, number: number, bytes: Uint8Array): Promise<string>;
  complete(uploadId: string, parts: { PartNumber: number; ETag: string }[]): Promise<void>;
  progress(bytes: number): Promise<void>;
  check(): void;
}
/** Copy a fixed object version with bounded parts. Conditional IO is enforced by the adapter. */
export async function copyR2Snapshot(size: number, ports: R2SnapshotCopyPorts): Promise<void> {
  if (!Number.isSafeInteger(size) || size < 1 || size > 100 * 1024 ** 3)
    throw new Error('Invalid object size.');
  ports.check();
  const uploadId = await ports.begin(),
    parts: { PartNumber: number; ETag: string }[] = [];
  const partSize = 16 * 1024 * 1024;
  for (let start = 0, number = 1; start < size; start += partSize, number++) {
    ports.check();
    const length = Math.min(partSize, size - start),
      bytes = await ports.read(start, length);
    if (bytes.byteLength !== length) throw new Error('Object range changed.');
    ports.check();
    const ETag = await ports.upload(uploadId, number, bytes);
    if (!ETag) throw new Error('Missing part ETag.');
    parts.push({ PartNumber: number, ETag });
    await ports.progress(start + length);
  }
  ports.check();
  await ports.complete(uploadId, parts);
}
