export interface TrackedOutput {
  size: number;
  sha256: string;
}
export interface FileObservation {
  isFile: boolean;
  size: number;
  dev: number;
  ino: number;
  mtimeMs: number;
  ctimeMs: number;
}
export const CHANGED_OUTPUT_WARNING = '以前の成果物が手動変更されたため、削除せず保持しました。';
export function trackedOutputMatches(
  expected: TrackedOutput,
  observed: { isFile: boolean; size: number; sha256: string },
) {
  return observed.isFile && observed.size === expected.size && observed.sha256 === expected.sha256;
}
export function sameObservedFile(a: FileObservation, b: FileObservation) {
  return (
    b.isFile &&
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
export type ThumbnailOutputRecord = TrackedOutput & { fileName: string };
export interface ThumbnailOutputManifest {
  schemaVersion: 1;
  outputs: Record<string, ThumbnailOutputRecord>;
}
export function thumbnailOutputName(id: number, format: 'png' | 'jpeg') {
  if (!Number.isSafeInteger(id) || id < 1 || !['png', 'jpeg'].includes(format))
    throw new Error('Invalid thumbnail document or format');
  return `thumbnail-${String(id).padStart(2, '0')}.${format === 'png' ? 'png' : 'jpg'}`;
}
export function mayCleanThumbnail(
  previous: ThumbnailOutputRecord | undefined,
  id: number,
  nextName: string,
) {
  const old = previous?.fileName && /^thumbnail-(\d+)\.(png|jpe?g)$/i.exec(previous.fileName);
  return !!(old && Number(old[1]) === id && previous?.fileName !== nextName);
}
