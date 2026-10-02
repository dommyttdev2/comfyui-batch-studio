import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerExecutionIpc(dependencies: IpcRegistrationDependencies) {
  const {
    IPC,
    VastAiInstanceNotFoundError,
    abandonExecutionRunForRemoteReplacement,
    checkAvailability,
    checkLoraFileAvailability,
    compileWorkflow,
    dialog,
    discardCurrentExecutionRun,
    discardExecutionRun,
    ensureExecutionStatusReconciled,
    ensureProjectWritable,
    executionCoordinator,
    executionPreflight,
    finalizeRemoteInstance,
    getCurrentExecutionRunFast,
    getExecutionRun,
    handleIpc,
    inspectExecutionRunStorage,
    isRemotePreGenerationPhase,
    listExecutionRuns,
    localExecutor,
    maybeQuitAfterExecution,
    mutateExecutionRun,
    path,
    projectWindowForSender,
    r2LookupFor,
    readProjectMeta,
    reconcilePersistedExecutionRuns,
    remoteExecutor,
    remoteImageExecutor,
    requestForceInterrupt,
    requestStopScheduling,
    restoreExecutionRunBackup,
    resumeExecutionRun,
    resumeExecutionRunFinalization,
    safeExecutionError,
    settingsStore,
    startExecutionRun,
    startExecutionRuntime,
    statusSnapshots,
    stopRunForExit,
  } = dependencies;
  const validRoot: IpcRegistrationDependencies['validRoot'] = dependencies.validRoot;

  handleIpc(IPC.WORKFLOW_COMPILE, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return compileWorkflow(root);
  });
  handleIpc(IPC.AVAILABILITY_CHECK, async (_e, root: unknown) => {
    validRoot(root);
    const settings = await settingsStore().status();
    return checkAvailability(root, await r2LookupFor(root), settings.modelsPath);
  });
  handleIpc(IPC.AVAILABILITY_CHECK_LORA_FILES, async (_e, root: unknown, fileNames: unknown) => {
    validRoot(root);
    if (!Array.isArray(fileNames) || fileNames.some((x) => typeof x !== 'string'))
      throw new Error('Invalid LoRA file names');
    const settings = await settingsStore().status();
    return checkLoraFileAvailability(root, fileNames, await r2LookupFor(root), settings.modelsPath);
  });
  handleIpc(IPC.AVAILABILITY_OPEN_R2, async () => {});
  handleIpc(IPC.PREFLIGHT_RUN, async (_e, root: unknown) => {
    validRoot(root);
    return executionPreflight(root);
  });
  handleIpc(IPC.EXECUTION_START, async (_e, root: unknown) => {
    validRoot(root);
    await reconcilePersistedExecutionRuns(root);
    const run = await startExecutionRun(root, () => executionPreflight(root));
    await startExecutionRuntime(root, run);
    return run;
  });
  handleIpc(IPC.EXECUTION_STATUS, async (_e, root: unknown) => {
    validRoot(root);
    const fallbackRunId = await ensureExecutionStatusReconciled(root);
    return getCurrentExecutionRunFast(root, fallbackRunId);
  });
  handleIpc(IPC.EXECUTION_STORAGE_DIAGNOSTICS, async (event, root: unknown) => {
    validRoot(root);
    if (projectWindowForSender(event.sender).projectRoot !== path.resolve(root))
      throw new Error('Project mismatch.');
    return inspectExecutionRunStorage(root);
  });
  handleIpc(IPC.EXECUTION_RESTORE_BACKUP, async (event, root: unknown, runId: unknown) => {
    validRoot(root);
    const state = projectWindowForSender(event.sender);
    if (state.projectRoot !== path.resolve(root)) throw new Error('Project mismatch.');
    if (runId !== null && typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    const decision = await dialog.showMessageBox(state.window, {
      type: 'warning',
      title: 'Runバックアップを復元',
      message: '検証済みのバックアップからRunを復元しますか？',
      detail:
        '現在の破損ファイルは別名で保全します。バックアップ以降の状態は戻りません。復元後に実行資源の状態を確認してください。',
      buttons: ['キャンセル', '復元する'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (decision.response !== 1) return null;
    const restored = await restoreExecutionRunBackup(root, runId);
    statusSnapshots.delete(path.resolve(root));
    return restored;
  });
  handleIpc(IPC.EXECUTION_LEAVE, async (event, root: unknown) => {
    validRoot(root);
    const state = projectWindowForSender(event.sender);
    if (state.projectRoot !== path.resolve(root)) throw new Error('Project mismatch.');
    // Stage browsing does not leave the project and must not stop a Run.
    // Window close, project switch and app exit retain their stop confirmation.
    return true;
  });
  handleIpc(
    IPC.EXECUTION_STOP_FOR_EDIT,
    async (_e, root: unknown, runId: unknown, interrupt: unknown) => {
      validRoot(root);
      if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
      return stopRunForExit(root, runId, interrupt === true ? 'interrupt' : 'graceful');
    },
  );
  handleIpc(IPC.EXECUTION_DISCARD_FOR_EDIT, async (event, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    const owner = projectWindowForSender(event.sender).window;
    const decision = await dialog.showMessageBox(owner, {
      type: 'warning',
      title: '現在のRunを破棄',
      message: '現在のRunを破棄しますか？',
      detail:
        '現在のRunは再開できなくなります。生成済みのローカル画像は削除しません。Remoteの未回収画像は失われる可能性があります。破棄後は任意の工程を変更して、実行工程のStartから新しいRunを開始できます。',
      buttons: ['キャンセル', 'Runを破棄する'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (decision.response !== 1) return null;
    return discardCurrentExecutionRun(root, runId, owner);
  });
  handleIpc(IPC.EXECUTION_RECONCILE, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
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
    const ref = { projectRoot: path.resolve(root), runId };
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
  });
  handleIpc(IPC.EXECUTION_GET, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return getExecutionRun(root, runId);
  });
  handleIpc(IPC.EXECUTION_STOP_SCHEDULING, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
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
          at: new Date().toISOString(),
          retryable: true,
        };
        r.error = e;
        r.errorHistory.push(e);
      });
      throw error;
    }
    return (await getExecutionRun(root, runId)) ?? run;
  });
  handleIpc(IPC.EXECUTION_FORCE_INTERRUPT, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
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
            at: new Date().toISOString(),
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
          at: new Date().toISOString(),
          retryable: true,
        };
        r.error = e;
        r.errorHistory.push(e);
      });
      throw error;
    }
    return (await getExecutionRun(root, runId)) ?? run;
  });
  handleIpc(IPC.EXECUTION_RESUME, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    await reconcilePersistedExecutionRuns(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
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
            at: new Date().toISOString(),
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
      const ref = { projectRoot: path.resolve(root), runId };
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
              current.completedAt = new Date().toISOString();
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
  });
  handleIpc(IPC.EXECUTION_RESTART_REMOTE, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
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
  });
  handleIpc(IPC.EXECUTION_RESTART_FROM_SCRATCH, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
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

    const confirm = await dialog.showMessageBox({
      type: 'warning',
      title: '最新のPrompt Planで最初から実行',
      message: '未完了のRunを停止して、最新のprompt_plan.jsonで最初から実行しますか？',
      detail: `${restartable.length}件の未完了Runを破棄し、最新prompt_plan.jsonからWorkflow/API graphを再生成して、新しいRun IDで0から実行します。旧RunのRemote/R2一時成果物は削除しますが、Localへ回収済みの成果物は削除しません。`,
      buttons: ['キャンセル', '最新のPrompt Planで実行'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (confirm.response !== 1) return current;

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
            projectRoot: path.resolve(root),
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
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const latest = await getExecutionRun(root, candidate.runId);
        if (latest?.lifecycle === 'RUNNING')
          throw new Error(
            `Local Run ${candidate.runId} の停止完了を確認できませんでした。Runの状態を確認して再実行してください。`,
          );
      }
      await localExecutor().waitForSettled(candidate.runId);
      await executionCoordinator.waitForSettled({
        projectRoot: path.resolve(root),
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
  });
}
