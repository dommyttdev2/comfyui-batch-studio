import {
  mayCleanThumbnail,
  type ThumbnailOutputManifest,
  type TrackedOutput,
  thumbnailOutputName,
} from '../domain/output-tracking-policy.js';
export interface ThumbnailOutputIO {
  directory(projectId: string): Promise<string>;
  join(...parts: string[]): string;
  exclusive<T>(projectId: string, work: () => Promise<T>): Promise<T>;
  readManifest(projectId: string): Promise<ThumbnailOutputManifest>;
  writeManifest(projectId: string, value: ThumbnailOutputManifest): Promise<void>;
  writeImage(
    projectId: string,
    id: number,
    path: string,
    bytes: Uint8Array,
    format: 'png' | 'jpeg',
  ): Promise<void>;
  hash(bytes: Uint8Array): string;
  cleanup(path: string, expected: TrackedOutput): Promise<string | null>;
  remove(path: string): Promise<void>;
}
export async function exportThumbnailOutput(
  io: ThumbnailOutputIO,
  projectId: string,
  id: number,
  format: 'png' | 'jpeg',
  bytes: Uint8Array,
) {
  const name = thumbnailOutputName(id, format);
  if (!bytes.length || bytes.length > 50 * 1024 * 1024)
    throw new Error('サムネイル画像データのサイズが正しくありません。');
  const directory = await io.directory(projectId),
    path = io.join(directory, name);
  return io.exclusive(projectId, async () => {
    const manifest = await io.readManifest(projectId),
      previous = manifest.outputs[String(id)];
    await io.writeImage(projectId, id, path, bytes, format);
    manifest.outputs[String(id)] = { fileName: name, size: bytes.length, sha256: io.hash(bytes) };
    await io.writeManifest(projectId, manifest);
    const warning =
      previous && mayCleanThumbnail(previous, id, name)
        ? await io.cleanup(io.join(directory, previous.fileName), previous)
        : null;
    return { path, cleanupWarning: warning ?? undefined };
  });
}
export async function deleteThumbnailOutput(io: ThumbnailOutputIO, projectId: string, id: number) {
  thumbnailOutputName(id, 'png');
  const directory = await io.directory(projectId);
  await io.exclusive(projectId, async () => {
    for (const extension of ['png', 'jpg', 'jpeg'])
      await io.remove(io.join(directory, `thumbnail-${String(id).padStart(2, '0')}.${extension}`));
    const manifest = await io.readManifest(projectId);
    delete manifest.outputs[String(id)];
    await io.writeManifest(projectId, manifest);
  });
}
