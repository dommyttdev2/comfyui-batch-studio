import { createHash } from 'node:crypto';
import { lstat, readFile, rm } from 'node:fs/promises';
import {
  CHANGED_OUTPUT_WARNING,
  sameObservedFile,
  trackedOutputMatches,
} from '../domain/output-tracking-policy.js';

// Only an unchanged output recorded by a previous successful export can be removed.
export async function cleanupTrackedOutput(
  file: string,
  expected: { size: number; sha256: string },
): Promise<string | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.size !== expected.size) return CHANGED_OUTPUT_WARNING;
    const bytes = await readFile(file);
    if (
      !trackedOutputMatches(expected, {
        isFile: info.isFile(),
        size: info.size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    )
      return CHANGED_OUTPUT_WARNING;
    const latest = await lstat(file);
    if (
      !sameObservedFile({ ...info, isFile: info.isFile() }, { ...latest, isFile: latest.isFile() })
    )
      return CHANGED_OUTPUT_WARNING;
    await rm(file);
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return `以前の成果物を削除できませんでした: ${(error as Error).message}`;
  }
}
