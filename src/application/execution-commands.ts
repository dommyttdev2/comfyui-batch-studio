import { BusinessError } from '../domain/contracts.js';
import type { ExecutionRun, PreflightResult, VastAiInstance } from '../domain/artifact-types.js';
import {
  executionState,
  planRunStop,
  isRemotePreparationPhase as isRemotePreGenerationPhase,
} from '../domain/execution-policy.js';
import { VastAiInstanceNotFoundError } from '../domain/vast-instance-errors.js';
import type { ExecutionCoordinator } from './execution-coordinator.js';
export type ExitMode = 'graceful' | 'interrupt';
const EXIT_SETTLE_POLLS = 240;
export interface LocalStopObserver {
  endpoint: string;
  findPromptBySubmissionId(id: string): Promise<string | null>;
  isPromptRunning(id: string): Promise<boolean>;
  isPromptQueued(id: string): Promise<boolean>;
  interrupt(): Promise<unknown>;
  history(id: string): Promise<unknown>;
  historyState(history: unknown, id: string): 'success' | 'error' | 'pending';
  health(): Promise<unknown>;
}
export interface ExecutionCommandPorts {
  runProjectIdentity(projectId: string): Promise<string>;
  getExecutionRun(projectId: string, runId: string): Promise<ExecutionRun | null>;
  getCurrentExecutionRun(projectId: string): Promise<ExecutionRun | null>;
  mutateExecutionRun(
    projectId: string,
    runId: string,
    update: (run: ExecutionRun) => void,
  ): Promise<ExecutionRun>;
  listExecutionRuns(projectId: string): Promise<ExecutionRun[]>;
  reconcilePersistedExecutionRuns(projectId: string): Promise<void>;
  executionCoordinator: Pick<
    ExecutionCoordinator,
    'hasActive' | 'waitForSettled' | 'releaseReservation' | 'startRemote'
  >;
  executionPreflight(projectId: string): Promise<PreflightResult>;
  compileWorkflow(projectId: string): Promise<unknown>;
  startExecutionRun(
    projectId: string,
    preflight: () => Promise<PreflightResult>,
  ): Promise<ExecutionRun>;
  resumeExecutionRun(
    projectId: string,
    runId: string,
    preflight: () => Promise<PreflightResult>,
  ): Promise<ExecutionRun>;
  resumeExecutionRunFinalization(projectId: string, runId: string): Promise<ExecutionRun>;
  startExecutionRuntime(projectId: string, run: ExecutionRun): Promise<void>;
  requestStopScheduling(projectId: string, runId: string): Promise<ExecutionRun>;
  requestForceInterrupt(projectId: string, runId: string): Promise<ExecutionRun>;
  discardExecutionRun(projectId: string, runId: string): Promise<ExecutionRun>;
  abandonExecutionRunForRemoteReplacement(
    projectId: string,
    runId: string,
    instanceId: number,
  ): Promise<ExecutionRun>;
  finalizeRemoteInstance(projectId: string, runId: string): Promise<unknown>;
  readProjectMeta(
    projectId: string,
  ): Promise<{ settings: { remoteProvider?: string; remoteInstanceId?: number | null } } | null>;
  localExecutor(): {
    waitForSettled(id: string): Promise<unknown>;
    forceInterrupt(projectId: string, id: string): Promise<unknown>;
  };
  remoteExecutor(): { disconnect(projectId: string, id: string): void };
  remoteImageExecutor(): {
    stopScheduling(projectId: string, id: string): Promise<unknown>;
    forceInterrupt(projectId: string, id: string): Promise<unknown>;
    beginDiscard(id: string): void;
    endDiscard(id: string): void;
    discardArtifacts(projectId: string, id: string): Promise<unknown>;
    waitForSettled(id: string): Promise<unknown>;
  };
  vastClient(): {
    getInstance(id: number): Promise<VastAiInstance>;
    stopInstance(id: number): Promise<unknown>;
  };
  localComfy(projectId: string): Promise<LocalStopObserver>;
  directLocalRefused(endpoint: string, error: unknown): boolean;
  confirmOfflineDiscard(run: ExecutionRun): Promise<boolean>;
  confirmRerun(runs: readonly ExecutionRun[]): Promise<boolean>;
  now(): string;
  sleep(ms: number): Promise<void>;
  maybeQuitAfterExecution(): void;
}
function safeExecutionError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(?:github_pat_|ghp_)[A-Za-z0-9_]+/gi, '[token]');
}
export class ExecutionCommands {
  constructor(private readonly ports: ExecutionCommandPorts) {
    const get = ports.getExecutionRun.bind(ports),
      mutate = ports.mutateExecutionRun.bind(ports);
    const scope = (run: ExecutionRun | null, identity: string, runId: string) => {
      if (run && (!identity || run.projectId !== identity || run.runId !== runId))
        throw new BusinessError('FORBIDDEN', 'Run scope mismatch.');
      return run;
    };
    this.ports = {
      ...ports,
      getExecutionRun: async (p, id) =>
        scope(await get(p, id), await ports.runProjectIdentity(p), id),
      getCurrentExecutionRun: async (p) => {
        const run = await ports.getCurrentExecutionRun(p);
        return scope(run, await ports.runProjectIdentity(p), run?.runId ?? '');
      },
      listExecutionRuns: async (p) => {
        const identity = await ports.runProjectIdentity(p);
        return (await ports.listExecutionRuns(p)).map((run) => scope(run, identity, run.runId)!);
      },
      mutateExecutionRun: async (p, id, work) => {
        const identity = await ports.runProjectIdentity(p);
        const result = await mutate(p, id, (run) => {
          scope(run, identity, id);
          work(run);
          scope(run, identity, id);
        });
        scope(result, identity, id);
        return result;
      },
    };
  }
  async stopAllForExit(root: string, mode: ExitMode) {
    const { listExecutionRuns } = this.ports;
    for (const run of await listExecutionRuns(root)) {
      if (
        run.lifecycle === 'RUNNING' ||
        run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN' ||
        (run.executionTarget === 'remote' &&
          (['PAUSED', 'INTERRUPTED'].includes(run.lifecycle) ||
            (run.lifecycle === 'FAILED' && run.error?.code === 'REMOTE_INSTANCE_FINALIZE_FAILED')))
      )
        await this.stopRunForExit(root, run.runId, mode);
    }
  }
  async recheck(root: string, runId: string) {
    const {
      executionCoordinator,
      getExecutionRun,
      mutateExecutionRun,
      reconcilePersistedExecutionRuns,
    } = this.ports;

    await reconcilePersistedExecutionRuns(root);
    const previous = await getExecutionRun(root, runId);
    if (
      !previous ||
      !['EXECUTION_RECOVERY_UNCERTAIN', 'LOCAL_OUTPUT_COLLECTION_FAILED'].includes(
        previous.error?.code ?? '',
      )
    )
      throw new Error(
        'Only a previously uncertain or output-collection-failed Run can be rechecked.',
      );
    const ref = { projectRoot: root, runId };
    if (executionCoordinator.hasActive(ref)) return previous;
    await mutateExecutionRun(root, runId, (current) => {
      if (
        !['EXECUTION_RECOVERY_UNCERTAIN', 'LOCAL_OUTPUT_COLLECTION_FAILED'].includes(
          current.error?.code ?? '',
        )
      )
        return;
      current.lifecycle = 'RUNNING';
      current.error = null;
      current.controls.scheduling = 'ACTIVE';
    });
    await reconcilePersistedExecutionRuns(root);
    const latest = await getExecutionRun(root, runId);
    if (!latest) throw new Error('Execution Run disappeared while reconciling.');
    return latest;
  }

  async stopScheduling(root: string, runId: string) {
    const {
      getExecutionRun,
      mutateExecutionRun,
      remoteExecutor,
      remoteImageExecutor,
      requestStopScheduling,
    } = this.ports;

    const run = await requestStopScheduling(root, runId);
    if (run.executionTarget === 'remote' && isRemotePreGenerationPhase(run.phase)) {
      const paused = await mutateExecutionRun(root, runId, (r) => {
        if (r.lifecycle === 'RUNNING') {
          r.lifecycle = 'PAUSED';
          r.controls.scheduling = 'STOPPED';
          r.controls.interrupt = 'IDLE';
          r.controls.forceInterruptRequestedAt = null;
          r.current.promptId = null;
          r.error = null;
        }
      });
      remoteExecutor().disconnect(root, runId);
      return paused;
    }
    if (run.executionTarget === 'remote' && run.phase !== 'EXECUTING') {
      return mutateExecutionRun(root, runId, (r) => {
        r.controls.scheduling = 'STOPPED';
      });
    }
    try {
      if (run.executionTarget === 'remote') await remoteImageExecutor().stopScheduling(root, runId);
    } catch (error) {
      await mutateExecutionRun(root, runId, (r) => {
        if (r.lifecycle === 'RUNNING') {
          r.controls.scheduling = 'ACTIVE';
          r.controls.stopSchedulingRequestedAt = null;
        }
        const e = {
          code: 'STOP_SCHEDULING_FAILED',
          message: safeExecutionError(error),
          phase: r.phase,
          at: this.ports.now(),
          retryable: true,
        };
        r.error = e;
        r.errorHistory.push(e);
      });
      throw error;
    }
    return (await getExecutionRun(root, runId)) ?? run;
  }

  async forceInterrupt(root: string, runId: string) {
    const {
      getExecutionRun,
      localExecutor,
      mutateExecutionRun,
      remoteImageExecutor,
      requestForceInterrupt,
    } = this.ports;

    const before = await getExecutionRun(root, runId);
    if (before?.executionTarget === 'remote' && before.phase !== 'EXECUTING')
      throw new Error('Force interrupt is only available while Remote Execution is EXECUTING.');
    const run = await requestForceInterrupt(root, runId);
    try {
      if (run.executionTarget === 'local') await localExecutor().forceInterrupt(root, runId);
      else await remoteImageExecutor().forceInterrupt(root, runId);
    } catch (error) {
      if (run.executionTarget === 'remote' && error instanceof VastAiInstanceNotFoundError) {
        return mutateExecutionRun(root, runId, (r) => {
          const e = {
            code: 'REMOTE_INSTANCE_MISSING',
            message: safeExecutionError(error),
            phase: r.phase,
            at: this.ports.now(),
            retryable: false,
          };
          r.error = e;
          r.errorHistory.push(e);
          r.lifecycle = 'FAILED';
          r.controls.scheduling = 'STOPPED';
          r.controls.interrupt = 'INTERRUPTED';
        });
      }
      await mutateExecutionRun(root, runId, (r) => {
        if (r.lifecycle === 'RUNNING') {
          r.controls.interrupt = 'IDLE';
          r.controls.forceInterruptRequestedAt = null;
        }
        const e = {
          code: 'FORCE_INTERRUPT_FAILED',
          message: safeExecutionError(error),
          phase: r.phase,
          at: this.ports.now(),
          retryable: true,
        };
        r.error = e;
        r.errorHistory.push(e);
      });
      throw error;
    }
    return (await getExecutionRun(root, runId)) ?? run;
  }

  async resume(root: string, runId: string) {
    const {
      executionCoordinator,
      executionPreflight,
      finalizeRemoteInstance,
      getExecutionRun,
      listExecutionRuns,
      mutateExecutionRun,
      reconcilePersistedExecutionRuns,
      resumeExecutionRun,
      resumeExecutionRunFinalization,
      startExecutionRuntime,
      maybeQuitAfterExecution,
    } = this.ports;

    await reconcilePersistedExecutionRuns(root);
    const previous = await getExecutionRun(root, runId);
    if (!previous) throw new Error(`Execution Run ${runId} was not found.`);
    const retryingStop =
      previous.executionTarget === 'remote' &&
      previous.lifecycle === 'FAILED' &&
      previous.error?.code === 'REMOTE_INSTANCE_FINALIZE_FAILED';
    // A finalize-only retry needs neither a changed Workflow nor a live SSH /
    // ComfyUI connection. It must never regenerate or redownload the Run.
    const run = retryingStop
      ? await resumeExecutionRunFinalization(root, runId)
      : await resumeExecutionRun(root, runId, () => executionPreflight(root));
    if (run.lifecycle === 'RUNNING' && run.phase === 'CLOUD_INSTANCE_FINALIZING') {
      const instanceId = Number(run.remote?.instanceId);
      if (run.remote?.provider !== 'vastai' || !Number.isInteger(instanceId) || instanceId < 1)
        throw new Error('Finalization retry has no valid Vast.ai Instance.');
      const conflicting = (await listExecutionRuns(root)).find(
        (other) =>
          other.runId !== runId &&
          other.executionTarget === 'remote' &&
          other.remote?.provider === 'vastai' &&
          Number(other.remote.instanceId) === instanceId &&
          ['RUNNING', 'PAUSED', 'INTERRUPTED'].includes(other.lifecycle),
      );
      const restoreRetryableFailure = async (reason: unknown) => {
        await mutateExecutionRun(root, runId, (current) => {
          current.lifecycle = 'FAILED';
          current.phase = 'CLOUD_INSTANCE_FINALIZING';
          current.error = previous.error ?? {
            code: 'REMOTE_INSTANCE_FINALIZE_FAILED',
            message: safeExecutionError(reason),
            phase: 'CLOUD_INSTANCE_FINALIZING',
            at: this.ports.now(),
            retryable: true,
          };
          current.controls.scheduling = 'STOPPED';
        });
      };
      if (conflicting) {
        const error = new Error(
          `Cannot stop Vast.ai Instance ${instanceId}: Run ${conflicting.runId} is still active.`,
        );
        await restoreRetryableFailure(error);
        throw error;
      }
      const ref = { projectRoot: root, runId };
      let task: Promise<void>;
      try {
        task = executionCoordinator.startRemote(ref, 'vastai', instanceId, async () => {
          await finalizeRemoteInstance(root, runId);
          const finalized = await getExecutionRun(root, runId);
          if (
            finalized?.lifecycle === 'RUNNING' &&
            finalized.remoteLifecycle?.finalizedAt &&
            finalized.remoteLifecycle.latest?.status === 'stopped'
          )
            await mutateExecutionRun(root, runId, (current) => {
              current.lifecycle = 'COMPLETED';
              current.phase = 'COMPLETED';
              current.error = null;
              current.completedAt = this.ports.now();
              current.controls.scheduling = 'STOPPED';
            });
        });
      } catch (error) {
        await restoreRetryableFailure(error);
        throw error;
      }
      void task.finally(maybeQuitAfterExecution).catch(() => {});
      return run;
    }
    if (run.lifecycle === 'RUNNING') await startExecutionRuntime(root, run);
    return run;
  }

  async replaceRemote(root: string, runId: string) {
    const {
      abandonExecutionRunForRemoteReplacement,
      executionPreflight,
      finalizeRemoteInstance,
      getExecutionRun,
      readProjectMeta,
      remoteExecutor,
      startExecutionRun,
      startExecutionRuntime,
    } = this.ports;

    const current = await getExecutionRun(root, runId);
    if (!current) throw new Error(`Execution Run ${runId} was not found.`);
    if (current.executionTarget !== 'remote' || current.remote?.provider !== 'vastai')
      throw new Error('Only Vast.ai Remote Runs can be restarted on another Instance.');
    if (!isRemotePreGenerationPhase(current.phase))
      throw new Error('Instance replacement is only available before generation starts.');
    const meta = await readProjectMeta(root),
      replacementId =
        meta?.settings.remoteProvider === 'vastai' ? Number(meta.settings.remoteInstanceId) : NaN;
    if (!Number.isInteger(replacementId) || replacementId < 1)
      throw new Error('Select a replacement Vast.ai Instance first.');
    if (replacementId === Number(current.remote.instanceId))
      throw new Error('Select a different Vast.ai Instance before starting a replacement Run.');
    const preflight = await executionPreflight(root);
    if (preflight.state !== 'READY')
      throw new Error(
        `Execution cannot restart: Preflight is BLOCKED: ${preflight.blocking.map((item) => item.message).join(' / ')}`,
      );
    await abandonExecutionRunForRemoteReplacement(root, runId, replacementId);
    remoteExecutor().disconnect(root, runId);
    void finalizeRemoteInstance(root, runId);
    const next = await startExecutionRun(root, async () => preflight);
    if (
      next.executionTarget !== 'remote' ||
      next.remote?.provider !== 'vastai' ||
      Number(next.remote.instanceId) !== replacementId
    )
      throw new Error('Replacement Run did not capture the selected Vast.ai Instance.');
    await startExecutionRuntime(root, next);
    return next;
  }

  async rerunPlan(root: string, runId: string) {
    const {
      compileWorkflow,
      discardExecutionRun,
      executionCoordinator,
      executionPreflight,
      finalizeRemoteInstance,
      getExecutionRun,
      listExecutionRuns,
      localExecutor,
      remoteExecutor,
      remoteImageExecutor,
      requestStopScheduling,
      startExecutionRun,
      startExecutionRuntime,
    } = this.ports;

    const current = await getExecutionRun(root, runId);
    if (!current) throw new Error(`Execution Run ${runId} was not found.`);

    const runs = await listExecutionRuns(root);
    const restartable = runs.filter(
      (candidate) =>
        ['RUNNING', 'PAUSED', 'INTERRUPTED'].includes(candidate.lifecycle) ||
        (candidate.runId === runId && candidate.lifecycle === 'FAILED'),
    );
    if (
      restartable.some((candidate) =>
        ['EXECUTION_RECOVERY_UNCERTAIN', 'LOCAL_OUTPUT_COLLECTION_FAILED'].includes(
          candidate.error?.code ?? '',
        ),
      )
    )
      throw new Error(
        '復旧不確定なRunを自動で再実行できません。「現在のRunを破棄」でQueue/HistoryまたはRemote停止の確認を行ってください。',
      );
    const unsafeRemote = restartable.find(
      (candidate) =>
        candidate.executionTarget === 'remote' &&
        candidate.lifecycle === 'RUNNING' &&
        !isRemotePreGenerationPhase(candidate.phase) &&
        candidate.phase !== 'EXECUTING',
    );
    if (unsafeRemote)
      throw new Error(
        `Run ${unsafeRemote.runId} は生成完了後のArtifact処理中です。処理完了または失敗後に最新Prompt Planで再実行してください。`,
      );

    if (!(await this.ports.confirmRerun(restartable))) return current;
    if (JSON.stringify(await listExecutionRuns(root)) !== JSON.stringify(runs))
      throw new BusinessError('TARGET_CHANGED', 'Runs changed after rerun confirmation.');

    for (const candidate of restartable) {
      if (candidate.executionTarget === 'remote') {
        const executor = remoteImageExecutor();
        executor.beginDiscard(candidate.runId);
        try {
          if (candidate.lifecycle === 'RUNNING' && candidate.phase === 'EXECUTING') {
            await executor.stopScheduling(root, candidate.runId).catch(() => false);
            await executor.forceInterrupt(root, candidate.runId).catch(() => false);
          }
          await executor.discardArtifacts(root, candidate.runId);
          await discardExecutionRun(root, candidate.runId);
          remoteExecutor().disconnect(root, candidate.runId);
          await executor.waitForSettled(candidate.runId);
          await finalizeRemoteInstance(root, candidate.runId);
          await executionCoordinator.waitForSettled({
            projectRoot: root,
            runId: candidate.runId,
          });
          await discardExecutionRun(root, candidate.runId);
        } finally {
          executor.endDiscard(candidate.runId);
        }
        continue;
      }

      if (candidate.lifecycle === 'RUNNING') {
        await requestStopScheduling(root, candidate.runId).catch(() => candidate);
        await localExecutor()
          .forceInterrupt(root, candidate.runId)
          .catch(() => false);
        for (let poll = 0; poll < 120; poll++) {
          const latest = await getExecutionRun(root, candidate.runId);
          if (!latest || latest.lifecycle !== 'RUNNING') break;
          await this.ports.sleep(250);
        }
        const latest = await getExecutionRun(root, candidate.runId);
        if (latest?.lifecycle === 'RUNNING')
          throw new Error(
            `Local Run ${candidate.runId} の停止完了を確認できませんでした。Runの状態を確認して再実行してください。`,
          );
      }
      await localExecutor().waitForSettled(candidate.runId);
      await executionCoordinator.waitForSettled({
        projectRoot: root,
        runId: candidate.runId,
      });
      await discardExecutionRun(root, candidate.runId);
    }

    await compileWorkflow(root);
    const preflight = await executionPreflight(root);
    if (preflight.state !== 'READY')
      throw new Error(
        `Execution cannot restart with latest Prompt Plan: Preflight is BLOCKED: ${preflight.blocking.map((item) => item.message).join(' / ')}`,
      );
    const next = await startExecutionRun(root, async () => preflight);
    await startExecutionRuntime(root, next);
    return next;
  }

  async stopVastInstanceForExit(run: ExecutionRun, root: string) {
    const { mutateExecutionRun, vastClient } = this.ports;
    const id = Number(run.remote?.instanceId);
    if (!Number.isInteger(id) || id < 1) throw new Error('Remote Run has no Vast.ai Instance ID.');
    const client = vastClient();
    let instance: VastAiInstance;
    try {
      instance = await client.getInstance(id);
    } catch (error) {
      if (error instanceof VastAiInstanceNotFoundError) return;
      throw error;
    }
    if (instance.id !== id) throw new Error('Vast.ai Instance identity mismatch.');
    if (instance.status !== 'stopped') await client.stopInstance(id);
    for (let attempt = 0; attempt < EXIT_SETTLE_POLLS; attempt++) {
      instance = await client.getInstance(id);
      if (instance.id !== id) throw new Error('Vast.ai Instance identity mismatch.');
      if (instance.status === 'stopped') {
        await mutateExecutionRun(root, run.runId, (current) => {
          if (!current.remoteLifecycle) return;
          current.remoteLifecycle.latest = {
            provider: 'vastai',
            instanceId: id,
            status: instance.status,
            rawStatus: instance.rawStatus,
            intendedStatus: instance.intendedStatus,
            curState: instance.curState,
            nextState: instance.nextState,
            statusMessage: instance.statusMessage,
            sshHost: instance.sshHost,
            sshPort: instance.sshPort,
            comfyUiPort: instance.comfyUiPort,
            resolvedAt: this.ports.now(),
          };
          current.remoteLifecycle.finalizedAt = this.ports.now();
        });
        return;
      }
      await this.ports.sleep(1000);
    }
    throw new BusinessError(
      'RUNTIME_UNCERTAIN',
      `Vast.ai Instance #${id} の停止完了を確認できません。課金状態を確認してください。`,
    );
  }

  async stopUncertainLocalRunForEdit(root: string, runId: string, mode: ExitMode) {
    const { executionCoordinator, getExecutionRun, localExecutor, mutateExecutionRun } = this.ports;
    const ref = { projectRoot: root, runId };
    await localExecutor().waitForSettled(runId);
    await executionCoordinator.waitForSettled(ref);
    const run = await getExecutionRun(root, runId);
    if (
      !run ||
      run.executionTarget !== 'local' ||
      run.lifecycle !== 'FAILED' ||
      run.error?.code !== 'EXECUTION_RECOVERY_UNCERTAIN'
    )
      throw new Error('実行状態が変わりました。Runを再確認してください。');
    const comfy = await this.ports.localComfy(root);
    let promptId = run.current.promptId ?? run.submission?.promptId ?? null;
    if (!promptId && run.submission?.status === 'sending')
      promptId = await comfy.findPromptBySubmissionId(run.submission.attemptId);
    if (!promptId)
      throw new Error(
        '受理された可能性のあるPrompt IDを特定できません。Runの破棄またはQueue/Historyの確認が必要です。',
      );
    for (let poll = 0; poll < EXIT_SETTLE_POLLS; poll++) {
      const running = await comfy.isPromptRunning(promptId);
      const queued = running || (await comfy.isPromptQueued(promptId));
      if (queued) {
        if (mode === 'interrupt') {
          if (!running)
            throw new Error(
              '既存PromptがQueue待機中です。他のPromptを消さずに停止できません。ComfyUI上で対象Promptを取り除いてください。',
            );
          await comfy.interrupt();
        }
      } else {
        const history = await comfy.history(promptId);
        const state = comfy.historyState(history, promptId);
        if (state === 'success' || state === 'error') {
          const stopped = await mutateExecutionRun(root, runId, (current) => {
            if (
              current.lifecycle !== 'FAILED' ||
              current.error?.code !== 'EXECUTION_RECOVERY_UNCERTAIN'
            )
              throw new Error('Run changed during stop verification.');
            current.current.promptId = promptId;
            current.controls.scheduling = 'STOPPED';
            current.controls.interrupt = state === 'error' ? 'INTERRUPTED' : 'IDLE';
            const code =
              state === 'success'
                ? 'LOCAL_OUTPUT_COLLECTION_FAILED'
                : 'LOCAL_RECOVERED_PROMPT_FAILED';
            const error = {
              code,
              message:
                state === 'success'
                  ? 'Promptの完了をHistoryで確認しました。保存済み画像は未回収です。「既存Runの状態を再確認」で回収するかRunを破棄してください。'
                  : '既存Promptの失敗をHistoryで確認しました。新しいPromptは送信していません。',
              phase: current.phase,
              at: this.ports.now(),
              retryable: false,
            };
            current.error = error;
            current.errorHistory.push(error);
          });
          executionCoordinator.releaseReservation(ref);
          return stopped;
        }
      }
      await this.ports.sleep(250);
    }
    throw new Error(
      '既存Promptの終了を確認できません。新しいPromptを投入せず、停止操作を中止しました。',
    );
  }

  async stopRunForExit(root: string, runId: string, mode: ExitMode) {
    const {
      executionCoordinator,
      getExecutionRun,
      localExecutor,
      mutateExecutionRun,
      remoteImageExecutor,
      requestForceInterrupt,
      requestStopScheduling,
    } = this.ports;
    let run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run disappeared during stop.');
    const stopPlan = planRunStop(executionState(run));
    if (stopPlan === 'recover-local') return this.stopUncertainLocalRunForEdit(root, runId, mode);
    if (run.lifecycle === 'RUNNING') {
      if (stopPlan === 'pause-preparation') {
        await mutateExecutionRun(root, runId, (current) => {
          if (current.lifecycle !== 'RUNNING') return;
          current.lifecycle = 'PAUSED';
          current.controls.scheduling = 'STOPPED';
          current.controls.interrupt = 'IDLE';
        });
        await executionCoordinator.waitForSettled({ projectRoot: root, runId });
      } else {
        await requestStopScheduling(root, runId);
        if (run.executionTarget === 'remote') {
          await remoteImageExecutor().stopScheduling(root, runId);
          if (mode === 'interrupt') {
            await requestForceInterrupt(root, runId);
            await remoteImageExecutor().forceInterrupt(root, runId);
          }
        } else if (mode === 'interrupt') {
          await requestForceInterrupt(root, runId);
          await localExecutor().forceInterrupt(root, runId);
        }
        for (let attempt = 0; attempt < EXIT_SETTLE_POLLS; attempt++) {
          run = await getExecutionRun(root, runId);
          if (!run || run.lifecycle !== 'RUNNING') break;
          await this.ports.sleep(250);
        }
        run = await getExecutionRun(root, runId);
        if (!run || run.lifecycle === 'RUNNING')
          throw new BusinessError(
            'RUNTIME_UNCERTAIN',
            'Runの停止完了を確認できません。実行画面から停止状態を確認してください。',
          );
        if (run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN')
          throw new Error('Promptの状態が不確定です。自動的に安全な停止と判定できません。');
        await executionCoordinator.waitForSettled({ projectRoot: root, runId });
      }
    }
    run = await getExecutionRun(root, runId);
    if (!run || run.lifecycle === 'RUNNING') throw new Error('Run is still running.');
    if (run.executionTarget === 'remote' && run.lifecycle !== 'DISCARDED')
      await this.stopVastInstanceForExit(run, root);
    return (await getExecutionRun(root, runId))!;
  }

  async confirmOfflineLocalRunDiscard(
    root: string,
    run: ExecutionRun,
    comfy: LocalStopObserver,
    error: unknown,
  ) {
    const { executionCoordinator } = this.ports;
    const ref = { projectRoot: root, runId: run.runId };
    if (
      !this.ports.directLocalRefused(comfy.endpoint, error) ||
      run.lifecycle === 'RUNNING' ||
      executionCoordinator.hasActive(ref)
    )
      throw error;
    if (!(await this.ports.confirmOfflineDiscard(run))) return false;
    // Recheck at the moment of discard; a newly restarted ComfyUI must be
    // inspected through Queue/History instead of this offline exception.
    try {
      await comfy.health();
    } catch (retry) {
      if (this.ports.directLocalRefused(comfy.endpoint, retry)) return true;
      throw retry;
    }
    throw new Error('ComfyUIが再起動されました。Queue/Historyを再確認してから破棄してください。');
  }

  async discardCurrentExecutionRun(root: string, runId: string) {
    const {
      discardExecutionRun,
      executionCoordinator,
      getCurrentExecutionRun,
      getExecutionRun,
      remoteExecutor,
    } = this.ports;
    const current = await getCurrentExecutionRun(root);
    if (!current || current.runId !== runId) throw new Error('現在のRunのみ破棄できます。');
    if (current.lifecycle === 'COMPLETED' || current.lifecycle === 'DISCARDED')
      throw new Error('既に終了したRunは破棄対象ではありません。');
    if (current.lifecycle === 'RUNNING') await this.stopRunForExit(root, runId, 'interrupt');
    const run = await getExecutionRun(root, runId);
    if (!run) throw new Error('Execution Run disappeared.');
    if (run.executionTarget === 'local') {
      const comfy = await this.ports.localComfy(root);
      try {
        let promptId = run.current.promptId ?? run.submission?.promptId ?? null;
        if (!promptId && run.submission?.status === 'sending')
          promptId = await comfy.findPromptBySubmissionId(run.submission.attemptId);
        if (!promptId && ['sending', 'acknowledged'].includes(run.submission?.status ?? ''))
          throw new Error('送信済みPromptのIDを確認できません。Queue/Historyの確認が必要です。');
        if (promptId) {
          if (await comfy.isPromptQueued(promptId))
            throw new Error(
              `Prompt ${promptId} がComfyUIのQueueに残っています。停止してから破棄してください。`,
            );
          const history = await comfy.history(promptId);
          if (comfy.historyState(history, promptId) === 'pending')
            throw new Error(
              `Prompt ${promptId} の完了または失敗をHistoryで確認できません。破棄を中止しました。`,
            );
        }
      } catch (error) {
        if (!(await this.confirmOfflineLocalRunDiscard(root, run, comfy, error))) return null;
      }
    } else {
      // Even an unreachable Remote Worker can no longer submit once the provider
      // confirms that its entire GPU Instance is stopped.
      await this.stopVastInstanceForExit(run, root);
      remoteExecutor().disconnect(root, runId);
    }
    const discarded = await discardExecutionRun(root, runId);
    executionCoordinator.releaseReservation({ projectRoot: root, runId });
    return discarded;
  }
}
