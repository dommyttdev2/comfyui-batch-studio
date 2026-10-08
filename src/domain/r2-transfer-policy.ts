import type { R2UploadSourceFingerprint } from './integration-types.js';
export const SOURCE_CHANGED = 'R2_UPLOAD_SOURCE_CHANGED';
export function sourceChanged(reason: string) {
  return new Error(
    SOURCE_CHANGED +
      ': ' +
      reason +
      '。既存Partを再利用せず、新しいアップロードを開始してください。',
  );
}
export function sameSourceStat(
  baseline: Pick<R2UploadSourceFingerprint, 'size' | 'mtimeMs' | 'ctimeMs' | 'dev' | 'ino'>,
  current: Pick<R2UploadSourceFingerprint, 'size' | 'mtimeMs' | 'ctimeMs' | 'dev' | 'ino'>,
) {
  return (
    baseline.size === current.size &&
    baseline.mtimeMs === current.mtimeMs &&
    baseline.ctimeMs === current.ctimeMs &&
    baseline.dev === current.dev &&
    baseline.ino === current.ino
  );
}
export function assertUploadSourceBinding(
  expected: R2UploadSourceFingerprint,
  current: R2UploadSourceFingerprint,
) {
  if (
    !sameSourceStat(expected, current) ||
    current.sha256 !== expected.sha256 ||
    current.partSha256.length !== expected.partSha256.length ||
    current.partSha256.some((digest, i) => digest !== expected.partSha256[i])
  )
    throw sourceChanged('元ファイルの内容・サイズ・更新時刻・ファイルIDが変わりました');
}
