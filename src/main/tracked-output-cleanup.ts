import { createHash } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';

// Only an unchanged output recorded by a previous successful export can be removed.
export async function cleanupTrackedOutput(
  file: string,
  expected: { size: number; sha256: string },
): Promise<string | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size !== expected.size)
      return '以前の成果物が手動変更されたため、削除せず保持しました。';
    const bytes = await readFile(file);
    if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256)
      return '以前の成果物が手動変更されたため、削除せず保持しました。';
    const latest = await lstat(file);
    if (
      !latest.isFile() ||
      latest.dev !== info.dev ||
      latest.ino !== info.ino ||
      latest.size !== info.size ||
      latest.mtimeMs !== info.mtimeMs ||
      latest.ctimeMs !== info.ctimeMs
    )
      return '以前の成果物が手動変更されたため、削除せず保持しました。';
    await rm(file);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return `以前の成果物を削除できませんでした: ${(error as Error).message}`;
  }
}
