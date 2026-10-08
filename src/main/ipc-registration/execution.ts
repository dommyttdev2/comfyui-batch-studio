import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerExecutionIpc(dependencies: IpcRegistrationDependencies) {
  const {
    IPC,
    executionCommands,
    checkAvailability,
    checkLoraFileAvailability,
    compileWorkflow,
    dialog,
    discardCurrentExecutionRun,
    ensureExecutionStatusReconciled,
    ensureProjectWritable,
    executionPreflight,
    getCurrentExecutionRunFast,
    getExecutionRun,
    handleIpc,
    inspectExecutionRunStorage,
    path,
    projectWindowForSender,
    r2LookupFor,
    reconcilePersistedExecutionRuns,
    restoreExecutionRunBackup,
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
    return executionCommands().recheck(root, runId);
  });
  handleIpc(IPC.EXECUTION_GET, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return getExecutionRun(root, runId);
  });
  handleIpc(IPC.EXECUTION_STOP_SCHEDULING, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return executionCommands().stopScheduling(root, runId);
  });
  handleIpc(IPC.EXECUTION_FORCE_INTERRUPT, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return executionCommands().forceInterrupt(root, runId);
  });
  handleIpc(IPC.EXECUTION_RESUME, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return executionCommands().resume(root, runId);
  });
  handleIpc(IPC.EXECUTION_RESTART_REMOTE, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return executionCommands().replaceRemote(root, runId);
  });
  handleIpc(IPC.EXECUTION_RESTART_FROM_SCRATCH, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return executionCommands().rerunPlan(root, runId);
  });
}
