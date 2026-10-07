import type { ExecutionRun } from '../domain/artifact-types.js';
import { validatedExecutionEvidence } from '../domain/execution-evidence.js';
import { LOCAL_FILE_SCOPE } from '../domain/local-output-policy.js';
export async function verifyGeneratedLocalOutputs(
  run: ExecutionRun,
  hash: (value: unknown) => string,
  observe: (relativePath: string) => Promise<{ isFile: boolean; size: number; sha256: string }>,
) {
  const evidence = validatedExecutionEvidence(run, hash).valid.filter(
    (item) => item.kind === 'CUSTOM' && item.scope === LOCAL_FILE_SCOPE,
  );
  const unique = new Map<string, (typeof evidence)[number]>();
  for (const item of evidence) {
    const relative = item.data.relativePath;
    if (typeof relative === 'string' && relative) unique.set(relative, item);
  }
  if (unique.size < run.progress.overall.total)
    throw new Error(
      `Generated output verification failed: expected ${run.progress.overall.total} Run-owned images, found ${unique.size} verified prompt output references.`,
    );
  for (const [relative, item] of unique) {
    const actual = await observe(relative);
    if (
      !actual.isFile ||
      actual.size < 1 ||
      actual.size !== Number(item.data.size) ||
      actual.sha256 !== item.data.sha256
    )
      throw new Error(
        `Generated output verification failed: missing or modified image ${relative}.`,
      );
  }
  return { count: unique.size };
}
