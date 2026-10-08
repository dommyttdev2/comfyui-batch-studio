import type { ExecutionRun, VastAiInstance } from '../domain/artifact-types.js';
import { validatedExecutionEvidence } from '../domain/execution-evidence.js';
import { planPersistedRecovery } from '../domain/execution-policy.js';
import { VastAiInstanceNotFoundError } from '../domain/vast-instance-errors.js';
import type { ExecutionCoordinator } from './execution-coordinator.js';
export interface RecoveryControllerPorts {
  getExecutionRun(root: string, id: string): Promise<ExecutionRun | null>;
  listExecutionRuns(root: string): Promise<ExecutionRun[]>;
  mutateExecutionRun(
    root: string,
    id: string,
    update: (run: ExecutionRun) => void,
  ): Promise<ExecutionRun>;
  executionCoordinator: ExecutionCoordinator;
  localExecutor(): { recover(root: string, id: string): Promise<unknown> };
  remoteImageExecutor(): { recover(root: string, id: string): Promise<unknown> };
  remoteLifecycle(): { finalize(root: string, id: string): Promise<unknown> };
  vastClient(): { getInstance(id: number): Promise<VastAiInstance> };
  verifyLocalOutputs(installPath: string, run: ExecutionRun): Promise<unknown>;
  settings(): Promise<{ comfyUiApiEndpoint: string; comfyUiInstallPath: string }>;
  hash(value: unknown): string;
  now(): string;
  safeExecutionError(error: unknown): string;
  warn(...args: unknown[]): void;
  maybeQuitAfterExecution(): void;
}
export class ExecutionRecoveryController {
  private readonly checks = new Map<string, Promise<void>>();
  constructor(private readonly ports: RecoveryControllerPorts) {}
  async finalizeRemoteInstance(root: string, runId: string) {
    const { mutateExecutionRun, remoteLifecycle, safeExecutionError } = this.ports;
    try {
      await remoteLifecycle().finalize(root, runId);
    } catch (error) {
      await mutateExecutionRun(root, runId, (r) => {
        const e = {
          code: 'REMOTE_INSTANCE_FINALIZE_FAILED',
          message: safeExecutionError(error),
          phase: 'CLOUD_INSTANCE_FINALIZING' as const,
          at: this.ports.now(),
          retryable: true,
        };
        r.error = e;
        r.errorHistory.push(e);
        r.lifecycle = 'FAILED';
        r.completedAt = null;
        r.controls.scheduling = 'STOPPED';
      });
    }
  }
  async markExecutionRecoveryUncertain(root: string, runId: string, reason: unknown) {
    const { mutateExecutionRun, safeExecutionError } = this.ports;
    return mutateExecutionRun(root, runId, (run) => {
      if (run.lifecycle !== 'RUNNING') return;
      const failure = {
        code: 'EXECUTION_RECOVERY_UNCERTAIN',
        message: `前回の実行状態を確定できません。既存PromptやWorkerが稼働中の可能性があるため、重複投入を防止しました。ComfyUI Queue/HistoryとVast.ai Instanceの状態を確認してください: ${safeExecutionError(reason)}`,
        phase: run.phase,
        at: this.ports.now(),
        retryable: false,
      };
      run.error = failure;
      run.errorHistory.push(failure);
      run.lifecycle = 'FAILED';
      run.controls.scheduling = 'STOPPED';
      // Preserve current.promptId, progress and evidence for manual reconciliation.
    });
  }
  async runRequiresExitGuard(root: string) {
    const { listExecutionRuns, vastClient } = this.ports;
    const runs = await listExecutionRuns(root);
    for (const run of runs) {
      if (run.lifecycle === 'RUNNING' || run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN')
        return true;
      if (
        run.executionTarget === 'remote' &&
        (['PAUSED', 'INTERRUPTED'].includes(run.lifecycle) ||
          (run.lifecycle === 'FAILED' && run.error?.code === 'REMOTE_INSTANCE_FINALIZE_FAILED'))
      ) {
        if (run.remoteLifecycle?.finalizedAt && run.remoteLifecycle.latest?.status === 'stopped')
          continue;
        if (!run.remote?.instanceId) return true;
        try {
          const instance = await vastClient().getInstance(Number(run.remote.instanceId));
          if (instance.status !== 'stopped') return true;
        } catch (error) {
          if (!(error instanceof VastAiInstanceNotFoundError)) throw error;
        }
      }
    }
    return false;
  }
  async recoverRemoteFinalization(root: string, runId: string) {
    const { getExecutionRun, mutateExecutionRun } = this.ports;
    const run = await getExecutionRun(root, runId);
    if (!run) return;
    const evidence = validatedExecutionEvidence(run, this.ports.hash).valid,
      kinds = new Set(evidence.map((item) => item.kind));
    if (!kinds.has('LOCAL_FILE_VERIFIED') || !kinds.has('CLEANUP_COMPLETED'))
      throw new Error('Completion evidence is incomplete. Refusing a finalize-only recovery.');
    await this.finalizeRemoteInstance(root, runId);
    const latest = await getExecutionRun(root, runId);
    if (latest?.remoteLifecycle?.finalizedAt && latest.lifecycle === 'RUNNING')
      await mutateExecutionRun(root, runId, (current) => {
        current.lifecycle = 'COMPLETED';
        current.phase = 'COMPLETED';
        current.completedAt = this.ports.now();
        current.controls.scheduling = 'STOPPED';
      });
  }
  async reconcilePersistedExecutionRuns(root: string) {
    const {
      getExecutionRun,
      listExecutionRuns,
      mutateExecutionRun,
      executionCoordinator,
      localExecutor,
      remoteImageExecutor,
      verifyLocalOutputs,
      safeExecutionError,
      maybeQuitAfterExecution,
    } = this.ports;
    const key = root;
    const pending = this.checks.get(key);
    if (pending) return pending;
    const check = (async () => {
      const runs = await listExecutionRuns(root);
      const settings = await this.ports.settings();
      // Claim all pre-existing uncertain resources before starting other Runs.
      for (const run of [...runs].reverse()) {
        if (run.error?.code !== 'EXECUTION_RECOVERY_UNCERTAIN') continue;
        const ref = { projectRoot: key, runId: run.runId };
        try {
          if (run.executionTarget === 'local')
            executionCoordinator.reserveLocal(ref, settings.comfyUiApiEndpoint);
          else if (run.remote?.provider === 'vastai' && run.remote.instanceId)
            executionCoordinator.reserveRemote(ref, 'vastai', run.remote.instanceId);
        } catch (error) {
          this.ports.warn(
            'Could not reserve an uncertain Execution Run resource:',
            safeExecutionError(error),
          );
        }
      }
      for (const run of [...runs].reverse()) {
        if (run.lifecycle !== 'RUNNING') continue;
        const ref = { projectRoot: key, runId: run.runId };
        if (executionCoordinator.hasActive(ref)) continue;
        const recovery = planPersistedRecovery(run);
        try {
          if (run.executionTarget === 'local') {
            const endpoint = settings.comfyUiApiEndpoint;
            if (recovery === 'recover-local') {
              void executionCoordinator
                .startLocal(ref, endpoint, async () => {
                  await localExecutor().recover(root, run.runId);
                  const latest = await getExecutionRun(root, run.runId);
                  if (latest?.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN')
                    executionCoordinator.retain(ref);
                })
                .finally(maybeQuitAfterExecution);
            } else if (recovery === 'pause-prepared') {
              // A prepared intent is durably marked before sending; no POST can
              // have occurred unless the sending transition also persisted.
              await mutateExecutionRun(root, run.runId, (current) => {
                if (current.lifecycle !== 'RUNNING' || current.submission?.status !== 'prepared')
                  return;
                current.lifecycle = 'PAUSED';
                current.controls.scheduling = 'STOPPED';
              });
            } else if (recovery === 'pause-before-submit') {
              // These phases precede every local POST /prompt.
              await mutateExecutionRun(root, run.runId, (current) => {
                if (current.lifecycle !== 'RUNNING' || current.current.promptId) return;
                current.lifecycle = 'PAUSED';
                current.controls.scheduling = 'STOPPED';
                current.error = null;
              });
            } else if (recovery === 'verify-local-output') {
              await verifyLocalOutputs(settings.comfyUiInstallPath, run);
              await mutateExecutionRun(root, run.runId, (current) => {
                if (current.lifecycle !== 'RUNNING') return;
                current.lifecycle = 'COMPLETED';
                current.completedAt = this.ports.now();
                current.controls.scheduling = 'STOPPED';
              });
            } else {
              executionCoordinator.reserveLocal(ref, endpoint);
              await this.markExecutionRecoveryUncertain(
                root,
                run.runId,
                'No persisted prompt ID; a response may have been lost after POST /prompt.',
              );
            }
            continue;
          }
          if (run.remote?.provider !== 'vastai' || !run.remote.instanceId)
            throw new Error('Remote Run has no valid instance identity.');
          void executionCoordinator
            .startRemote(ref, 'vastai', run.remote.instanceId, async () => {
              try {
                if (recovery === 'finalize-remote')
                  await this.recoverRemoteFinalization(root, run.runId);
                else await remoteImageExecutor().recover(root, run.runId);
              } catch (error) {
                await this.markExecutionRecoveryUncertain(root, run.runId, error);
              }
              const latest = await getExecutionRun(root, run.runId);
              if (latest?.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN')
                executionCoordinator.retain(ref);
            })
            .finally(maybeQuitAfterExecution);
        } catch (error) {
          await this.markExecutionRecoveryUncertain(root, run.runId, error);
        }
      }
    })().finally(() => this.checks.delete(key));
    this.checks.set(key, check);
    return check;
  }
}
