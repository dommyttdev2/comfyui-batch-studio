import type { ExecutionEvidence, ExecutionRun } from './artifact-types.js';
export function validatedExecutionEvidence(run: ExecutionRun, hash: (value: unknown) => string) {
  const valid: ExecutionEvidence[] = [],
    invalid: string[] = [];
  for (const evidence of run.evidence) {
    const expected = hash({
      runIdentity: run.snapshot.runIdentity,
      kind: evidence.kind,
      scope: evidence.scope,
      data: evidence.data ?? {},
    });
    if (evidence.runIdentity === run.snapshot.runIdentity && evidence.fingerprint === expected)
      valid.push(evidence);
    else invalid.push(evidence.id);
  }
  return { valid, invalid };
}
