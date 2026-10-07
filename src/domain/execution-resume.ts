import type {
  ExecutionEvidence,
  ExecutionPhase,
  ExecutionRun,
  ExecutionRunLifecycle,
} from './artifact-types.js';

function initialPhase(target: 'local' | 'remote'): ExecutionPhase {
  return target === 'remote' ? 'CLOUD_INSTANCE_RESOLVING' : 'LOCAL_COMFYUI_CONNECTING';
}
export function resumePhase(
  run: ExecutionRun,
  evidence: ExecutionEvidence[],
): { phase: ExecutionPhase; lifecycle: ExecutionRunLifecycle } {
  const kinds = new Set(evidence.map((item) => item.kind));
  if (
    run.executionTarget === 'remote' &&
    kinds.has('LOCAL_FILE_VERIFIED') &&
    !kinds.has('CLEANUP_COMPLETED')
  )
    return { phase: 'REMOTE_CLEANUP', lifecycle: 'RUNNING' };
  if (
    run.executionTarget === 'remote' &&
    kinds.has('LOCAL_FILE_VERIFIED') &&
    kinds.has('CLEANUP_COMPLETED') &&
    (!run.remoteLifecycle?.finalizedAt || run.remoteLifecycle.latest?.status !== 'stopped')
  )
    return { phase: 'CLOUD_INSTANCE_FINALIZING', lifecycle: 'RUNNING' };
  if (kinds.has('LOCAL_FILE_VERIFIED')) return { phase: 'COMPLETED', lifecycle: 'COMPLETED' };
  if (run.executionTarget === 'remote' && kinds.has('R2_OBJECT_VERIFIED'))
    return { phase: 'LOCAL_DOWNLOADING', lifecycle: 'RUNNING' };
  if (run.executionTarget === 'remote' && kinds.has('PACKAGE_VERIFIED'))
    return { phase: 'R2_UPLOAD_URL_ISSUED', lifecycle: 'RUNNING' };
  if (kinds.has('EXECUTION_COMPLETED'))
    return {
      phase: run.executionTarget === 'remote' ? 'ARTIFACTS_COLLECTING' : 'LOCAL_OUTPUT_VERIFYING',
      lifecycle: 'RUNNING',
    };
  if (kinds.has('MODELS_VERIFIED')) return { phase: 'WORKFLOW_PREPARING', lifecycle: 'RUNNING' };
  return { phase: initialPhase(run.executionTarget), lifecycle: 'RUNNING' };
}
