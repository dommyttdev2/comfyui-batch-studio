import type { IpcMainInvokeEvent } from 'electron';
import type {
  AppSettingsSaveInput,
  CatalogSelectionTemplateInput,
  CivitaiConnectionInput,
  GrokContextStage,
  GrokTask,
  MarketplaceSourceType,
  ProjectBriefInput,
  ProjectSettings,
  PromptPlanArtifact,
  R2ConnectionInput,
  ThumbnailSlotKey,
  VastAiConnectionInput,
  VastAiOfferSearchInput,
  VastAiRentRequest,
  VastAiSshEndpoint,
} from '../shared/types.js';
import type { ThumbnailCacheTiming } from './thumbnail-image-cache.js';
import type { PickerMetrics } from './thumbnail-picker-perf.js';
import type { IpcRegistrationDependencies } from './main.js';

export function registerIpc(dependencies: IpcRegistrationDependencies) {
  const {
    GROK_URL,
    IPC,
    VastAiClient,
    VastAiInstanceNotFoundError,
    abandonExecutionRunForRemoteReplacement,
    app,
    assistantProviderState,
    beginEditArtifact,
    buildGrokTask,
    catalogService,
    catalogStatus,
    checkAvailability,
    checkLoraFileAvailability,
    civitaiStore,
    clipboard,
    codexAccount,
    codexArtifactFor,
    codexBusy,
    codexTaskContexts,
    codexChatState,
    codexChooseModel,
    codexContextFor,
    codexModelSettings,
    codexReturnFile,
    codexSend,
    codexSendTask,
    codexService,
    codexSnapshot,
    codexStopTurn,
    codexTaskFileForTurn,
    compileWorkflow,
    confirmArtifact,
    confirmRunStopBeforeLeave,
    createProject,
    deleteThumbnailOutputs,
    dialog,
    discardCurrentExecutionRun,
    discardExecutionRun,
    editorFlushReplies,
    ensureCatalogRuntimePath,
    ensureExecutionStatusReconciled,
    ensureProjectWritable,
    executionCoordinator,
    executionPreflight,
    expectedArtifact,
    exportCustomMarketplaceImage,
    exportThumbnail,
    finalizeRemoteInstance,
    findCodexWorkspace,
    focusProjectWindow,
    generateCaption,
    generateMarketplaceImages,
    generateMarketplaceZip,
    getCaptionStatus,
    getCurrentExecutionRunFast,
    getExecutionRun,
    getFinalArtifactStatus,
    getMarketplaceImageTargets,
    grokChatState,
    handleIpc,
    importAutoArtifact,
    importCaptionGrok,
    importGrok,
    initializeCorruptMarketplaceImageState,
    initializeCorruptThumbnailState,
    inspectExecutionRunStorage,
    integratedCatalogStatus,
    isRemotePreGenerationPhase,
    latestCompletedArtifactTurn,
    layoutProjectWindow,
    listExecutionRuns,
    listExportedThumbnails,
    listFinalArtifactImages,
    listThumbnailFonts,
    listThumbnailImages,
    loadMarketplaceImageState,
    loadThumbnailState,
    localExecutor,
    logThumbnailPickerPerformance,
    manualResetFrom,
    maybeQuitAfterExecution,
    marketplacePickerForSender,
    marketplacePickerWindows,
    messageText,
    mkdir,
    mutateExecutionRun,
    notifyAutoArtifact,
    openMarketplacePickerWindow,
    openThumbnailPickerWindow,
    paneState,
    path,
    pickerPerformanceLogPath,
    projectRootKey,
    projectWindowForRoot,
    projectWindowForSender,
    r2,
    r2Index,
    r2LookupFor,
    readArtifact,
    readCachedThumbnailImage,
    readCodexHistory,
    readCodexOutput,
    readFinalArtifactImage,
    readFinalArtifactPreview,
    readGrokLoraSelectionHistory,
    readMarketplaceSource,
    readMarketplaceSourcePreview,
    readProjectMeta,
    readThumbnailImage,
    readThumbnailPreview,
    readThumbnailTemplate,
    reconcilePersistedExecutionRuns,
    refreshRecentProjectMenu,
    reloadCivitaiCatalog,
    rememberMostRecentOpenProject,
    rememberProjectAndRefreshMenu,
    remoteExecutor,
    remoteLifecycle,
    remoteSceneExecutor,
    renderMarketplacePng,
    requestForceInterrupt,
    requestStopScheduling,
    resolveVastSshEndpoint,
    restoreExecutionRunBackup,
    restoreMarketplaceImageState,
    restoreThumbnailState,
    resumeExecutionRun,
    resumeExecutionRunFinalization,
    safeExecutionError,
    saveDraft,
    saveMarketplaceImageState,
    savePixivTitle,
    saveProjectBrief,
    saveProjectSettings,
    savePromptPlan,
    saveThumbnailState,
    scanProject,
    scanWithCatalog,
    setGrokContext,
    setWindowProject,
    settingsStore,
    shell,
    startExecutionRun,
    startExecutionRuntime,
    stateCodexActiveThread,
    stateStore,
    statusSnapshots,
    stopRunForExit,
    storeWebpThumbnailPreview,
    thumbnailCachePruneMetrics,
    thumbnailPickerForSender,
    thumbnailPickerWindows,
    validCivitaiUrl,
    validInstanceId,
    validateMarketplacePickerImage,
    validateThumbnailPickerImage,
    vastClient,
    vastStore,
    writeFile,
  } = dependencies;
  const validRoot: IpcRegistrationDependencies['validRoot'] = dependencies.validRoot;
  const validGrokContextStage: IpcRegistrationDependencies['validGrokContextStage'] =
    dependencies.validGrokContextStage;
  const validManualResetScope: IpcRegistrationDependencies['validManualResetScope'] =
    dependencies.validManualResetScope;

  handleIpc(IPC.EDITOR_FLUSH_RESULT, (event, id: unknown, ok: unknown, message: unknown) => {
    if (typeof id !== 'string') return;
    const pending = editorFlushReplies.get(id);
    if (!pending || pending.senderId !== event.sender.id) return;
    editorFlushReplies.delete(id);
    pending.resolve({
      ok: ok === true,
      message: typeof message === 'string' ? message : undefined,
    });
  });
  handleIpc(IPC.APP_SETTINGS_GET, () => settingsStore().status());
  handleIpc(IPC.APP_SETTINGS_SELECT_COMFYUI, async () => {
    const r = await dialog.showOpenDialog({
      title: 'ComfyUIのインストール先ディレクトリを選択',
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handleIpc(IPC.APP_SETTINGS_SAVE, async (_e, input: AppSettingsSaveInput) => {
    const result = await settingsStore().save(input);
    ensureCatalogRuntimePath();
    return result;
  });
  handleIpc(IPC.PROJECT_SELECT, async (event) => {
    const state = projectWindowForSender(event.sender),
      defaultPath = await stateStore().lastProjectDirectoryPath();
    const r = await dialog.showOpenDialog({
      title: 'プロジェクトフォルダーを選択',
      defaultPath: defaultPath ?? undefined,
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const root = path.resolve(r.filePaths[0]),
      existing = projectWindowForRoot(root, state);
    if (existing) {
      focusProjectWindow(existing);
      return null;
    }
    const project = await scanWithCatalog(root);
    if (
      state.projectRoot &&
      state.projectRoot !== root &&
      !(await confirmRunStopBeforeLeave(
        state.projectRoot,
        state.window,
        'プロジェクトを切り替える',
      ))
    )
      return null;
    await setWindowProject(state, root);
    return project;
  });
  handleIpc(IPC.PROJECT_LAST, async (event) => {
    const state = projectWindowForSender(event.sender);
    let root = state.projectRoot;
    if (!root && state.restoreLastProject) {
      state.restoreLastProject = false;
      root = await stateStore().lastProjectPath();
    }
    if (!root) return null;
    const existing = projectWindowForRoot(root, state);
    if (existing) {
      focusProjectWindow(existing);
      state.projectRoot = null;
      return null;
    }
    try {
      const project = await scanWithCatalog(root);
      state.projectRoot = path.resolve(root);
      statusSnapshots.delete(state.projectRoot);
      await rememberProjectAndRefreshMenu(state.projectRoot);
      return project;
    } catch {
      state.projectRoot = null;
      return null;
    }
  });
  handleIpc(IPC.PROJECT_RECENT, async () => {
    const projects = [];
    for (const root of await stateStore().recentProjectPaths()) {
      try {
        projects.push(await scanWithCatalog(root));
      } catch {}
    }
    return projects;
  });
  handleIpc(IPC.PROJECT_REMOVE_RECENT, async (_e, root: unknown) => {
    validRoot(root);
    await stateStore().removeRecentProject(root);
    await refreshRecentProjectMenu();
  });
  handleIpc(IPC.PROJECT_OPEN, async (event, root: unknown) => {
    validRoot(root);
    const state = projectWindowForSender(event.sender),
      existing = projectWindowForRoot(root, state);
    if (existing) {
      focusProjectWindow(existing);
      return null;
    }
    const project = await scanWithCatalog(root);
    await setWindowProject(state, root);
    return project;
  });
  handleIpc(IPC.PROJECT_CLOSE, async (event) => {
    const state = projectWindowForSender(event.sender);
    if (
      state.projectRoot &&
      !(await confirmRunStopBeforeLeave(state.projectRoot, state.window, 'プロジェクトを閉じる'))
    )
      throw new Error('Runの停止がキャンセルされました。');
    state.projectRoot = null;
    state.activeGrokContext = null;
    state.codexContext = null;
    state.codexView.webContents.send(IPC.CODEX_CONTEXT_CHANGED, null);
    state.grokVisible = false;
    layoutProjectWindow(state);
    await rememberMostRecentOpenProject();
  });
  handleIpc(IPC.PROJECT_SELECT_PARENT, async (_event, defaultPath: unknown) => {
    const initialDirectory =
      typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath.trim() : undefined;
    const r = await dialog.showOpenDialog({
      title: '作成先フォルダーを選択',
      defaultPath: initialDirectory,
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handleIpc(IPC.PROJECT_CREATE, async (event, parent: unknown, brief: ProjectBriefInput) => {
    if (typeof parent !== 'string') throw new Error('Invalid parent path');
    const state = projectWindowForSender(event.sender);
    if (
      state.projectRoot &&
      !(await confirmRunStopBeforeLeave(state.projectRoot, state.window, '新規プロジェクトの作成'))
    )
      throw new Error('Runの停止がキャンセルされました。');
    const root = await createProject(parent, brief),
      existing = projectWindowForRoot(root, state);
    if (existing) {
      focusProjectWindow(existing);
      return scanWithCatalog(root);
    }
    const project = await scanWithCatalog(root);
    await setWindowProject(state, root);
    return project;
  });
  handleIpc(IPC.PROJECT_SCAN, (_e, root: unknown) => {
    validRoot(root);
    return scanProject(root);
  });
  handleIpc(IPC.PROJECT_OPEN_FOLDER, async (_e, root: unknown) => {
    validRoot(root);
    const err = await shell.openPath(root);
    if (err) throw new Error(err);
  });
  handleIpc(IPC.PROJECT_SAVE_SETTINGS, async (_e, root: unknown, settings: ProjectSettings) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await saveProjectSettings(root, settings);
    return scanProject(root);
  });
  handleIpc(IPC.PROJECT_SAVE_BRIEF, async (_e, root: unknown, brief: ProjectBriefInput) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await saveProjectBrief(root, brief);
    return scanProject(root);
  });
  handleIpc(IPC.ARTIFACT_READ, (_e, root: unknown, key: any, source: any) => {
    validRoot(root);
    return readArtifact(root, key, source);
  });
  handleIpc(IPC.ARTIFACT_BEGIN_EDIT, async (_e, root: unknown, key: any) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return beginEditArtifact(root, key);
  });
  handleIpc(IPC.ARTIFACT_SAVE_DRAFT, async (_e, root: unknown, key: any, content: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof content !== 'string') throw new Error('Invalid content');
    return saveDraft(root, key, content);
  });
  handleIpc(
    IPC.ARTIFACT_IMPORT_GROK,
    async (_e, root: unknown, key: any, raw: unknown, stage: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      if (typeof raw !== 'string') throw new Error('Invalid Grok response');
      if (stage !== undefined && stage !== 'models' && stage !== 'models-fix')
        throw new Error('Invalid Grok response stage');
      return importGrok(root, key, raw, stage);
    },
  );
  handleIpc(IPC.ARTIFACT_CONFIRM, async (_e, root: unknown, key: any) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await confirmArtifact(root, key);
    return scanProject(root);
  });
  handleIpc(IPC.ARTIFACT_GROK_LORA_HISTORY, (_e, root: unknown) => {
    validRoot(root);
    return readGrokLoraSelectionHistory(root);
  });
  handleIpc(IPC.ARTIFACT_RESET_FROM, async (_e, root: unknown, scope: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    validManualResetScope(scope);
    await manualResetFrom(root, scope);
    return scanProject(root);
  });
  handleIpc(IPC.PROMPT_PLAN_SAVE, async (_e, root: unknown, plan: PromptPlanArtifact) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return savePromptPlan(root, plan);
  });
  handleIpc(IPC.AUTO_ARTIFACT_GROK_ARM, (event, root: unknown, stage: unknown) => {
    validRoot(root);
    const state = projectWindowForSender(event.sender);
    if (!state.projectRoot || projectRootKey(root) !== projectRootKey(state.projectRoot))
      throw new Error('選択中のプロジェクトと自動取り込み対象が一致しません。');
    if (
      !Object.values(codexTaskContexts)
        .flat()
        .includes(stage as GrokTask['stage'])
    )
      throw new Error('Invalid Grok artifact stage.');
    if (!state.grokArtifactWatcher) throw new Error('Grokの監視が初期化されていません。');
    return state.grokArtifactWatcher.arm(state.projectRoot, stage as GrokTask['stage']);
  });
  handleIpc(IPC.GROK_TASK_BUILD, (_e, root: unknown, stage: GrokTask['stage'], extra: unknown) => {
    validRoot(root);
    return buildGrokTask(root, stage, typeof extra === 'string' ? extra : '');
  });
  handleIpc(IPC.FILE_SHOW_IN_FOLDER, (_e, filePath: unknown) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath))
      throw new Error('Invalid file path');
    shell.showItemInFolder(filePath);
  });
  handleIpc(IPC.CATALOG_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return catalogStatus(root);
  });
  handleIpc(IPC.CATALOG_INTEGRATED_STATUS, () => integratedCatalogStatus());
  handleIpc(IPC.CATALOG_INTEGRATED_SNAPSHOT, () => catalogService().catalog());
  handleIpc(IPC.CATALOG_INTEGRATED_SYNC, async () => {
    await catalogService().startSync();
    return integratedCatalogStatus();
  });
  handleIpc(IPC.CATALOG_LINK_PROJECT, async (_e, root: unknown) => {
    validRoot(root);
    return scanProject(root);
  });
  handleIpc(IPC.CATALOG_TEMPLATES, () => catalogService().templates());
  handleIpc(IPC.CATALOG_SAVE_TEMPLATE, (_e, input: CatalogSelectionTemplateInput) =>
    catalogService().saveTemplate(input),
  );
  handleIpc(IPC.CATALOG_DELETE_TEMPLATE, (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid template id');
    return catalogService().deleteTemplate(id);
  });
  handleIpc(IPC.CATALOG_OPEN_MODEL, async (_e, url: unknown) => {
    if (!validCivitaiUrl(url)) throw new Error('Civitai URLが不正です。');
    await shell.openExternal(url as string);
  });
  handleIpc(IPC.CIVITAI_SETTINGS, () => civitaiStore().status());
  handleIpc(IPC.CIVITAI_SAVE_SETTINGS, async (_e, input: CivitaiConnectionInput) => {
    const result = await civitaiStore().save(input);
    const service = await reloadCivitaiCatalog();
    const initial = service.status();
    if (initial.state === 'idle' && initial.apiKeyConfigured) void service.startSync();
    return result;
  });
  handleIpc(IPC.VASTAI_SETTINGS, () => vastStore().status());
  handleIpc(IPC.VASTAI_SAVE_SETTINGS, (_e, input: VastAiConnectionInput) =>
    vastStore().save(input),
  );
  handleIpc(IPC.VASTAI_TEST, async (_e, input: VastAiConnectionInput | undefined) => {
    const override = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
    if (override) {
      const client = new VastAiClient(async () => override);
      await client.testConnection();
      return;
    }
    await vastClient().testConnection();
  });
  handleIpc(IPC.VASTAI_SELECT_PRIVATE_KEY, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Vast.ai SSH秘密鍵を選択',
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handleIpc(IPC.VASTAI_SELECT_PUBLIC_KEY, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Vast.ai SSH公開鍵を選択',
      properties: ['openFile'],
      filters: [
        { name: 'SSH Public Key', extensions: ['pub'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  handleIpc(IPC.VASTAI_INSTANCES, () => vastClient().listInstances());
  handleIpc(IPC.VASTAI_COMFYUI_TEMPLATE, () => vastClient().comfyUiTemplate());
  handleIpc(IPC.VASTAI_SEARCH_OFFERS, (_e, input: VastAiOfferSearchInput) =>
    vastClient().searchOffers(input),
  );
  handleIpc(IPC.VASTAI_RENT_OFFER, async (_e, input: VastAiRentRequest) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid Vast.ai RENT request');
    const offerId = Number(input.offerId),
      storageGb = Number(input.storageGb),
      templateHashId = typeof input.templateHashId === 'string' ? input.templateHashId.trim() : '';
    if (
      !Number.isInteger(offerId) ||
      offerId < 1 ||
      !Number.isFinite(storageGb) ||
      storageGb <= 0 ||
      !templateHashId
    )
      throw new Error('Invalid Vast.ai RENT request');
    const [offer, template] = await Promise.all([
      vastClient().getOffer(offerId, storageGb),
      vastClient().comfyUiTemplateByHash(templateHashId),
    ]);
    const gpu = `${offer.gpuCount ?? '-'}x ${offer.gpuName ?? 'GPU'}`;
    const cost = offer.hourlyCost == null ? '不明' : '$' + offer.hourlyCost.toFixed(3) + '/h';
    const reliability =
      offer.reliability == null ? '不明' : (offer.reliability * 100).toFixed(2) + '%';
    const result = await dialog.showMessageBox({
      type: 'question',
      title: 'Vast.aiでRENT',
      message: `${gpu} をRENTしますか？`,
      detail: `On-demand · ${offer.geolocation ?? 'Location不明'}\n料金: ${cost}\nStorage: ${storageGb} GB\nReliability: ${reliability}\nTemplate: ${template.name}\n\nRENTするとVast.aiで課金が開始されます。`,
      buttons: ['キャンセル', 'RENT'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return null;
    return vastClient().rentOffer({ offerId, storageGb, templateHashId }, offer);
  });
  handleIpc(IPC.VASTAI_START_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestStartInstance(validInstanceId(id));
  });
  handleIpc(IPC.VASTAI_STOP_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestStopInstance(validInstanceId(id));
  });
  handleIpc(IPC.VASTAI_DESTROY_INSTANCE, async (_e, id: unknown) => {
    const instanceId = validInstanceId(id);
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Vast.ai Instanceを削除',
      message: `Instance #${instanceId} を削除しますか？`,
      detail: 'この操作は取り消せません。Instance上のデータも削除されます。',
      buttons: ['キャンセル', '削除'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response !== 1) return false;
    await vastClient().destroyInstance(instanceId);
    return true;
  });
  handleIpc(IPC.VASTAI_REBOOT_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestRebootInstance(validInstanceId(id));
  });
  handleIpc(
    IPC.VASTAI_RESOLVE_SSH,
    async (_e, id: unknown): Promise<VastAiSshEndpoint> =>
      resolveVastSshEndpoint(validInstanceId(id)),
  );
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
      if (run.executionTarget === 'remote') await remoteSceneExecutor().stopScheduling(root, runId);
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
      else await remoteSceneExecutor().forceInterrupt(root, runId);
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
        const executor = remoteSceneExecutor();
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
  const selectFinalArtifactDirectory = async (root: string) => {
    const currentStatus = await getFinalArtifactStatus(root);
    const meta = await readProjectMeta(root);
    const fallback = meta?.settings.artifactOutputPath?.trim();
    const result = await dialog.showOpenDialog({
      title: '最終成果物ディレクトリを選択',
      defaultPath: currentStatus.directory || fallback || root,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return currentStatus;
    await saveProjectSettings(root, { finalArtifactDirectory: result.filePaths[0] });
    return getFinalArtifactStatus(root);
  };
  handleIpc(IPC.FINAL_ARTIFACT_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return getFinalArtifactStatus(root);
  });
  handleIpc(IPC.FINAL_ARTIFACT_SELECT_DIRECTORY, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return selectFinalArtifactDirectory(root);
  });
  handleIpc(IPC.FINAL_ARTIFACT_LIST_IMAGES, (_e, root: unknown) => {
    validRoot(root);
    return listFinalArtifactImages(root);
  });
  handleIpc(IPC.FINAL_ARTIFACT_READ_IMAGE, (_e, root: unknown, imagePath: unknown) => {
    validRoot(root);
    if (typeof imagePath !== 'string') throw new Error('Invalid final artifact image path');
    return readFinalArtifactImage(root, imagePath);
  });
  handleIpc(IPC.FINAL_ARTIFACT_READ_PREVIEW, (_e, root: unknown, imagePath: unknown) => {
    validRoot(root);
    if (typeof imagePath !== 'string') throw new Error('Invalid final artifact image path');
    return readFinalArtifactPreview(root, imagePath);
  });
  handleIpc(IPC.CAPTION_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return getCaptionStatus(root);
  });
  handleIpc(IPC.CAPTION_SELECT_SOURCE_DIRECTORY, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await selectFinalArtifactDirectory(root);
    return getCaptionStatus(root);
  });
  handleIpc(IPC.CAPTION_IMPORT_GROK, async (_e, root: unknown, raw: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof raw !== 'string') throw new Error('Invalid Grok caption response');
    return importCaptionGrok(root, raw);
  });
  handleIpc(IPC.CAPTION_GENERATE, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return generateCaption(root);
  });
  handleIpc(IPC.CAPTION_SAVE_PIXIV_TITLE, async (_e, root: unknown, title: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return savePixivTitle(root, title);
  });
  handleIpc(IPC.THUMBNAIL_FONTS, () => listThumbnailFonts());
  handleIpc(IPC.THUMBNAIL_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadThumbnailState(root);
  });
  handleIpc(IPC.THUMBNAIL_RESTORE_BACKUP, async (event, root: unknown) => {
    validRoot(root);
    const owner = projectWindowForSender(event.sender);
    if (owner.projectRoot !== path.resolve(root)) throw new Error('Project mismatch.');
    await ensureProjectWritable(root);
    const choice = await dialog.showMessageBox(owner.window, {
      type: 'warning',
      title: 'サムネイル編集データを復元',
      message: '検証済みバックアップから編集状態を復元しますか？',
      detail: '破損した元ファイルは別名で保全します。バックアップ以降の編集は戻りません。',
      buttons: ['キャンセル', '復元する'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return choice.response === 1 ? restoreThumbnailState(root) : null;
  });
  handleIpc(IPC.THUMBNAIL_INITIALIZE_CORRUPT, async (event, root: unknown) => {
    validRoot(root);
    const owner = projectWindowForSender(event.sender);
    if (owner.projectRoot !== path.resolve(root)) throw new Error('Project mismatch.');
    await ensureProjectWritable(root);
    const choice = await dialog.showMessageBox(owner.window, {
      type: 'warning',
      title: 'サムネイル編集データを初期化',
      message: '破損したファイルを別名で保全して初期化しますか？',
      detail: '編集内容は新しい空の状態になります。元ファイルは削除されません。',
      buttons: ['キャンセル', '保全して初期化'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return choice.response === 1 ? initializeCorruptThumbnailState(root) : null;
  });
  handleIpc(IPC.THUMBNAIL_SAVE, async (_e, root: unknown, state: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return saveThumbnailState(root, state);
  });
  handleIpc(IPC.THUMBNAIL_SELECT_IMAGE, async (_e, root: unknown) => {
    validRoot(root);
    const finalArtifact = await getFinalArtifactStatus(root);
    const result = await dialog.showOpenDialog({
      title: 'サムネイルへ挿入する画像を選択',
      defaultPath: finalArtifact.exists && finalArtifact.directory ? finalArtifact.directory : root,
      properties: ['openFile'],
      filters: [{ name: '画像', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return readThumbnailImage(result.filePaths[0]);
  });
  handleIpc(IPC.THUMBNAIL_LIST_IMAGES, async (event, root: unknown) => {
    validRoot(root);
    const started = performance.now();
    const finalArtifact = await getFinalArtifactStatus(root);
    const statusMs = performance.now() - started;
    const images =
      finalArtifact.exists && finalArtifact.directory
        ? await listThumbnailImages(finalArtifact.directory)
        : [];
    const state = thumbnailPickerWindows.get(event.sender.id);
    if (state)
      logThumbnailPickerPerformance(app.getPath('userData'), state.sessionId, 'list_images', {
        count: images.length,
        statusMs,
        listMs: performance.now() - started - statusMs,
        totalMs: performance.now() - started,
        sinceOpenMs: performance.now() - state.openedAt,
      });
    return images;
  });
  handleIpc(IPC.THUMBNAIL_READ_IMAGE, (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return readThumbnailImage(imagePath);
  });
  handleIpc(IPC.THUMBNAIL_READ_PREVIEW, async (event, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    const started = performance.now();
    const timing: ThumbnailCacheTiming = {};
    const state = thumbnailPickerWindows.get(event.sender.id);
    const requestNumber = state ? ++state.previewCount : 0;
    try {
      const cached = await readCachedThumbnailImage(
        app.getPath('userData'),
        imagePath,
        'gallery',
        timing,
      );
      const fallbackStarted = performance.now();
      const source = cached ?? (await readThumbnailPreview(imagePath));
      const elapsed = performance.now() - started;
      if (
        state &&
        (requestNumber <= 40 || requestNumber % 25 === 0 || elapsed > 100 || !timing.hit)
      ) {
        const details: PickerMetrics = {
          requestNumber,
          totalMs: elapsed,
          sinceOpenMs: performance.now() - state.openedAt,
          cacheHit: timing.hit === true,
          usedFallback: !cached,
          fallbackMs: cached ? 0 : performance.now() - fallbackStarted,
          transferKB: source ? (source.dataUrl.length * 0.75) / 1024 : 0,
          sourceWidth: source?.width ?? 0,
          sourceHeight: source?.height ?? 0,
        };
        const prune = thumbnailCachePruneMetrics(app.getPath('userData'));
        details.pruneRequests = prune.requests;
        details.pruneRuns = prune.runs;
        details.pruneCoalesced = prune.coalesced;
        details.pruneDeleted = prune.filesDeleted;
        details.pruneFailures = prune.deleteFailures;
        details.pruneLastMs = prune.lastDurationMs;
        details.pruneLastBytesAfter = prune.lastBytesAfter;
        for (const [key, value] of Object.entries(timing)) {
          if (typeof value === 'number' || typeof value === 'boolean') details[key] = value;
        }
        logThumbnailPickerPerformance(
          app.getPath('userData'),
          state.sessionId,
          'preview_read',
          details,
        );
      }
      return source;
    } catch (error) {
      if (state)
        logThumbnailPickerPerformance(app.getPath('userData'), state.sessionId, 'preview_error', {
          totalMs: performance.now() - started,
        });
      throw error;
    }
  });
  handleIpc(IPC.THUMBNAIL_READ_EDITOR_IMAGE, async (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return (
      (await readCachedThumbnailImage(app.getPath('userData'), imagePath, 'editor')) ??
      readThumbnailImage(imagePath)
    );
  });
  handleIpc(IPC.THUMBNAIL_STORE_WEBP_PREVIEW, (_e, imagePath: unknown, dataUrl: unknown) => {
    if (typeof imagePath !== 'string' || typeof dataUrl !== 'string')
      throw new Error('Invalid thumbnail preview data');
    return storeWebpThumbnailPreview(app.getPath('userData'), imagePath, dataUrl);
  });
  handleIpc(IPC.THUMBNAIL_READ_TEMPLATE, (_e, pattern: unknown) =>
    readThumbnailTemplate(
      path.join(app.getAppPath(), 'dist-electron', 'thumbnail-templates'),
      pattern,
    ),
  );
  handleIpc(
    IPC.THUMBNAIL_PICKER_OPEN,
    (event, root: unknown, slot: unknown, currentImagePath: unknown) => {
      validRoot(root);
      const validSlots = new Set<ThumbnailSlotKey>([
        'LEFT',
        'LEFT_TOP',
        'LEFT_BOTTOM',
        'CENTER_MAIN',
        'RIGHT',
        'RIGHT_TOP',
        'RIGHT_BOTTOM',
      ]);
      if (typeof slot !== 'string' || !validSlots.has(slot as ThumbnailSlotKey))
        throw new Error('Invalid thumbnail slot');
      if (typeof currentImagePath !== 'string') throw new Error('Invalid thumbnail image path');
      return openThumbnailPickerWindow(
        event.sender,
        root,
        slot as ThumbnailSlotKey,
        currentImagePath,
      );
    },
  );
  handleIpc(IPC.THUMBNAIL_PICKER_CONTEXT, (event) => {
    const state = thumbnailPickerForSender(event.sender);
    logThumbnailPickerPerformance(app.getPath('userData'), state.sessionId, 'context_requested', {
      sinceOpenMs: performance.now() - state.openedAt,
    });
    return {
      sessionId: state.sessionId,
      root: state.root,
      slot: state.slot,
      currentImagePath: state.currentImagePath,
    };
  });
  handleIpc(IPC.THUMBNAIL_PICKER_PERF_OPEN, async (event) => {
    thumbnailPickerForSender(event.sender);
    const directory = path.dirname(pickerPerformanceLogPath(app.getPath('userData')));
    await mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  handleIpc(IPC.THUMBNAIL_PICKER_PERF, (event, name: unknown, metrics: unknown) => {
    const state = thumbnailPickerForSender(event.sender);
    if (typeof name !== 'string' || !/^[a-z_]{1,40}$/.test(name)) return;
    if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) return;
    const safe: PickerMetrics = {};
    for (const [key, value] of Object.entries(metrics).slice(0, 20)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)))
        safe[key] = value;
      else if (
        key === 'displaySize' &&
        (value === 'large' || value === 'medium' || value === 'small')
      )
        safe[key] = value;
    }
    logThumbnailPickerPerformance(app.getPath('userData'), state.sessionId, name, {
      ...safe,
      sinceOpenMs: performance.now() - state.openedAt,
    });
  });
  handleIpc(IPC.THUMBNAIL_PICKER_PREVIEW, async (event, imagePath: unknown) => {
    const state = thumbnailPickerForSender(event.sender);
    const requestId = ++state.previewRequestId;
    const resolved = await validateThumbnailPickerImage(state, imagePath);
    if (requestId !== state.previewRequestId) throw new Error('新しい画像が選択されました。');
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const ready = state.selection.beginPreview(resolved);
    state.opener.send(IPC.THUMBNAIL_PICKER_PREVIEWED, {
      sessionId: state.sessionId,
      slot: state.slot,
      imagePath: resolved,
      previewGeneration: requestId,
    });
    return ready;
  });
  handleIpc(
    IPC.THUMBNAIL_PICKER_PREVIEW_RESULT,
    (
      event,
      sessionId: unknown,
      imagePath: unknown,
      generation: unknown,
      ok: unknown,
      message: unknown,
    ) => {
      const state = [...thumbnailPickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (
        !state ||
        generation !== state.previewRequestId ||
        typeof imagePath !== 'string' ||
        typeof ok !== 'boolean'
      )
        return false;
      return state.selection.previewResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
    },
  );
  handleIpc(IPC.THUMBNAIL_PICKER_COMMIT, async (event, imagePath: unknown) => {
    const state = thumbnailPickerForSender(event.sender);
    await ensureProjectWritable(state.root);
    const resolved = await validateThumbnailPickerImage(state, imagePath);
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const committed = state.selection.beginCommit(resolved);
    state.opener.send(IPC.THUMBNAIL_PICKER_COMMITTED, {
      sessionId: state.sessionId,
      slot: state.slot,
      imagePath: resolved,
    });
    await committed;
    state.committed = true;
    state.window.close();
  });
  handleIpc(
    IPC.THUMBNAIL_PICKER_COMMIT_RESULT,
    (event, sessionId: unknown, imagePath: unknown, ok: unknown, message: unknown) => {
      const state = [...thumbnailPickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (!state || typeof imagePath !== 'string' || typeof ok !== 'boolean') return false;
      const accepted = state.selection.commitResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
      if (accepted && ok) state.committed = true;
      return accepted;
    },
  );
  handleIpc(
    IPC.THUMBNAIL_EXPORT,
    async (_e, root: unknown, documentId: unknown, format: unknown, dataUrl: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      if (typeof documentId !== 'number' || !Number.isSafeInteger(documentId) || documentId < 1)
        throw new Error('Invalid thumbnail document');
      if (format !== 'png' && format !== 'jpeg') throw new Error('Invalid thumbnail format');
      if (typeof dataUrl !== 'string') throw new Error('Invalid thumbnail image data');
      return exportThumbnail(root, documentId, format, dataUrl);
    },
  );
  handleIpc(IPC.THUMBNAIL_DELETE_OUTPUTS, async (_e, root: unknown, documentId: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof documentId !== 'number' || !Number.isSafeInteger(documentId) || documentId < 1)
      throw new Error('Invalid thumbnail document');
    return deleteThumbnailOutputs(root, documentId);
  });
  handleIpc(IPC.MARKETPLACE_LIST_THUMBNAILS, (_e, root: unknown) => {
    validRoot(root);
    return listExportedThumbnails(root);
  });
  handleIpc(
    IPC.MARKETPLACE_READ_SOURCE,
    (_e, root: unknown, imagePath: unknown, sourceType: unknown) => {
      validRoot(root);
      if (
        typeof imagePath !== 'string' ||
        (sourceType !== 'thumbnail' && sourceType !== 'final-artifact')
      )
        throw new Error('Invalid marketplace source');
      return readMarketplaceSource(root, imagePath, sourceType);
    },
  );
  handleIpc(
    IPC.MARKETPLACE_READ_SOURCE_PREVIEW,
    async (event, root: unknown, imagePath: unknown, sourceType: unknown) => {
      validRoot(root);
      if (
        typeof imagePath !== 'string' ||
        (sourceType !== 'thumbnail' && sourceType !== 'final-artifact')
      )
        throw new Error('Invalid marketplace source');
      const started = performance.now();
      const timing: ThumbnailCacheTiming = {};
      const source = await readMarketplaceSourcePreview(
        root,
        imagePath,
        sourceType,
        app.getPath('userData'),
        timing,
      );
      const picker = marketplacePickerWindows.get(event.sender.id);
      if (picker) {
        const metrics: PickerMetrics = {
          totalMs: performance.now() - started,
          cacheHit: timing.hit === true,
          transferKB: source ? (source.dataUrl.length * 0.75) / 1024 : 0,
          usedFallback: source?.dataUrl.startsWith('data:image/webp;base64,') === true,
        };
        for (const [key, value] of Object.entries(timing)) {
          if (typeof value === 'number' || typeof value === 'boolean') metrics[key] = value;
        }
        logThumbnailPickerPerformance(
          app.getPath('userData'),
          picker.sessionId,
          'marketplace_preview_read',
          metrics,
        );
      }
      return source;
    },
  );
  handleIpc(IPC.MARKETPLACE_TARGETS, () => getMarketplaceImageTargets());
  handleIpc(IPC.MARKETPLACE_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadMarketplaceImageState(root);
  });
  handleIpc(IPC.MARKETPLACE_RESTORE_BACKUP, async (event, root: unknown) => {
    validRoot(root);
    const owner = projectWindowForSender(event.sender);
    if (owner.projectRoot !== path.resolve(root)) throw new Error('Project mismatch.');
    await ensureProjectWritable(root);
    const choice = await dialog.showMessageBox(owner.window, {
      type: 'warning',
      title: '販売サイト用画像の編集データを復元',
      message: '検証済みバックアップから編集状態を復元しますか？',
      detail: '破損した元ファイルは別名で保全します。バックアップ以降の編集は戻りません。',
      buttons: ['キャンセル', '復元する'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return choice.response === 1 ? restoreMarketplaceImageState(root) : null;
  });
  handleIpc(IPC.MARKETPLACE_INITIALIZE_CORRUPT, async (event, root: unknown) => {
    validRoot(root);
    const owner = projectWindowForSender(event.sender);
    if (owner.projectRoot !== path.resolve(root)) throw new Error('Project mismatch.');
    await ensureProjectWritable(root);
    const choice = await dialog.showMessageBox(owner.window, {
      type: 'warning',
      title: '販売サイト用画像の編集データを初期化',
      message: '破損したファイルを別名で保全して初期化しますか？',
      detail: '編集内容は新しい空の状態になります。元ファイルは削除されません。',
      buttons: ['キャンセル', '保全して初期化'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    return choice.response === 1 ? initializeCorruptMarketplaceImageState(root) : null;
  });
  handleIpc(IPC.MARKETPLACE_SAVE, async (_e, root: unknown, state: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return saveMarketplaceImageState(root, state);
  });
  handleIpc(
    IPC.MARKETPLACE_GENERATE,
    async (_e, root: unknown, state: unknown, webpDataUrls: unknown, sourcePngDataUrl: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      const data =
        webpDataUrls && typeof webpDataUrls === 'object'
          ? (webpDataUrls as Record<string, string>)
          : undefined;
      return generateMarketplaceImages(
        root,
        state,
        data,
        typeof sourcePngDataUrl === 'string' ? sourcePngDataUrl : undefined,
      );
    },
  );
  handleIpc(
    IPC.MARKETPLACE_GENERATE_ZIP,
    async (_e, root: unknown, format: unknown, state: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      return generateMarketplaceZip(root, format, state);
    },
  );
  handleIpc(
    IPC.MARKETPLACE_EXPORT_CUSTOM,
    async (_e, root: unknown, state: unknown, webpDataUrl: unknown, sourcePngDataUrl: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      return exportCustomMarketplaceImage(
        root,
        state,
        typeof webpDataUrl === 'string' ? webpDataUrl : undefined,
        typeof sourcePngDataUrl === 'string' ? sourcePngDataUrl : undefined,
      );
    },
  );
  handleIpc(
    IPC.MARKETPLACE_RENDER_PNG,
    (
      _e,
      root: unknown,
      sourceImagePath: unknown,
      crop: unknown,
      width: unknown,
      height: unknown,
      sourcePngDataUrl: unknown,
      sourceType: unknown,
    ) => {
      validRoot(root);
      if (
        typeof sourceType !== 'undefined' &&
        sourceType !== 'thumbnail' &&
        sourceType !== 'final-artifact'
      )
        throw new Error('Invalid marketplace source type');
      if (typeof sourceImagePath !== 'string') throw new Error('Invalid marketplace image path');
      if (!crop || typeof crop !== 'object') throw new Error('Invalid marketplace crop');
      if (typeof width !== 'number' || typeof height !== 'number')
        throw new Error('Invalid marketplace output size');
      return renderMarketplacePng(
        root,
        sourceImagePath,
        crop as import('../shared/types.js').MarketplaceCropRect,
        width,
        height,
        typeof sourcePngDataUrl === 'string' ? sourcePngDataUrl : undefined,
        sourceType as MarketplaceSourceType | undefined,
      );
    },
  );
  handleIpc(
    IPC.MARKETPLACE_PICKER_OPEN,
    (event, root: unknown, currentImagePath: unknown, sourceType: unknown) => {
      validRoot(root);
      if (typeof currentImagePath !== 'string') throw new Error('Invalid marketplace image path');
      if (sourceType !== 'thumbnail' && sourceType !== 'final-artifact')
        throw new Error('Invalid marketplace source');
      return openMarketplacePickerWindow(event.sender, root, currentImagePath, sourceType);
    },
  );
  handleIpc(IPC.MARKETPLACE_PICKER_CONTEXT, (event) => {
    const state = marketplacePickerForSender(event.sender);
    return {
      sessionId: state.sessionId,
      root: state.root,
      currentImagePath: state.currentImagePath,
      sourceType: state.sourceType,
    };
  });
  handleIpc(IPC.MARKETPLACE_PICKER_PREVIEW, async (event, imagePath: unknown) => {
    const state = marketplacePickerForSender(event.sender);
    const requestId = ++state.previewRequestId;
    const resolved = await validateMarketplacePickerImage(state, imagePath);
    if (requestId !== state.previewRequestId) throw new Error('新しい画像が選択されました。');
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const ready = state.selection.beginPreview(resolved);
    state.opener.send(IPC.MARKETPLACE_PICKER_PREVIEWED, {
      sessionId: state.sessionId,
      imagePath: resolved,
      previewGeneration: requestId,
    });
    return ready;
  });
  handleIpc(
    IPC.MARKETPLACE_PICKER_PREVIEW_RESULT,
    (
      event,
      sessionId: unknown,
      imagePath: unknown,
      generation: unknown,
      ok: unknown,
      message: unknown,
    ) => {
      const state = [...marketplacePickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (
        !state ||
        generation !== state.previewRequestId ||
        typeof imagePath !== 'string' ||
        typeof ok !== 'boolean'
      )
        return false;
      return state.selection.previewResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
    },
  );
  handleIpc(IPC.MARKETPLACE_PICKER_COMMIT, async (event, imagePath: unknown) => {
    const state = marketplacePickerForSender(event.sender);
    await ensureProjectWritable(state.root);
    const resolved = await validateMarketplacePickerImage(state, imagePath);
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const committed = state.selection.beginCommit(resolved);
    state.opener.send(IPC.MARKETPLACE_PICKER_COMMITTED, {
      sessionId: state.sessionId,
      imagePath: resolved,
    });
    await committed;
    state.committed = true;
    state.window.close();
  });
  handleIpc(
    IPC.MARKETPLACE_PICKER_COMMIT_RESULT,
    (event, sessionId: unknown, imagePath: unknown, ok: unknown, message: unknown) => {
      const state = [...marketplacePickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (!state || typeof imagePath !== 'string' || typeof ok !== 'boolean') return false;
      const accepted = state.selection.commitResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
      if (accepted && ok) state.committed = true;
      return accepted;
    },
  );
  handleIpc(IPC.R2_SETTINGS, () => r2().settings());
  handleIpc(IPC.R2_ENVIRONMENT, () => r2().environment());
  handleIpc(IPC.R2_TEST, (_e, input: R2ConnectionInput) => r2().test(input));
  handleIpc(IPC.R2_SAVE_SETTINGS, async (_e, input: R2ConnectionInput) => {
    const result = await r2().saveSettings(input);
    void r2Index()
      .sync()
      .catch((error) => console.warn('R2 index sync failed:', error));
    return result;
  });
  handleIpc(IPC.R2_BUCKETS, () => r2().buckets());
  handleIpc(IPC.R2_CREATE_BUCKET, async (_e, name: unknown) => {
    if (typeof name !== 'string') throw new Error('Invalid bucket');
    await r2().createBucket(name);
    void r2Index()
      .sync()
      .catch(() => {});
  });
  handleIpc(IPC.R2_DELETE_BUCKET, async (_e, name: unknown) => {
    if (typeof name !== 'string') throw new Error('Invalid bucket');
    await r2().deleteBucket(name);
    void r2Index()
      .sync()
      .catch(() => {});
  });
  handleIpc(IPC.R2_LIST, (_e, b: unknown, p: unknown, t: unknown) => {
    if (typeof b !== 'string' || typeof p !== 'string') throw new Error('Invalid R2 path');
    return r2().list(b, p, typeof t === 'string' ? t : null);
  });
  handleIpc(IPC.R2_SEARCH, (_e, b: unknown, q: unknown, t: unknown) => {
    if (typeof b !== 'string' || typeof q !== 'string') throw new Error('Invalid search');
    return r2Index().search(b, q, typeof t === 'string' ? t : null);
  });
  handleIpc(IPC.R2_DOWNLOAD_INFO, (_e, b: unknown, k: unknown, ex: unknown) => {
    if (typeof b !== 'string' || typeof k !== 'string') throw new Error('Invalid object');
    return r2().downloadInfo(b, k, typeof ex === 'number' ? ex : 3600);
  });
  handleIpc(IPC.R2_BATCH_DOWNLOAD_INFO, (_e, b: unknown, keys: unknown, ex: unknown) => {
    if (typeof b !== 'string' || !Array.isArray(keys)) throw new Error('Invalid batch objects');
    return r2().batchDownloadInfo(
      b,
      keys.filter((x) => typeof x === 'string'),
      typeof ex === 'number' ? ex : 3600,
    );
  });
  handleIpc(IPC.R2_PUT_URL_INFO, (_e, b: unknown, k: unknown, ex: unknown, ct: unknown) => {
    if (
      typeof b !== 'string' ||
      typeof k !== 'string' ||
      (ct !== undefined && typeof ct !== 'string')
    )
      throw new Error('Invalid PUT URL request');
    return r2().putUrlInfo(
      b,
      k,
      typeof ex === 'number' ? ex : 3600,
      typeof ct === 'string' ? ct : '',
    );
  });
  handleIpc(IPC.R2_DELETE_OBJECTS, async (_e, b: unknown, keys: unknown) => {
    if (typeof b !== 'string' || !Array.isArray(keys)) throw new Error('Invalid delete');
    const result = await r2().deleteObjects(
      b,
      keys.filter((x) => typeof x === 'string'),
    );
    void r2Index()
      .sync()
      .catch(() => {});
    return result;
  });
  handleIpc(IPC.R2_MOVE, async (_e, b: unknown, s: unknown, d: unknown, o: unknown) => {
    if (typeof b !== 'string' || typeof s !== 'string' || typeof d !== 'string')
      throw new Error('Invalid move');
    await r2().move(b, s, d, o === true);
    void r2Index()
      .sync()
      .catch(() => {});
  });
  handleIpc(IPC.R2_SELECT_UPLOAD_FILES, async () => {
    const result = await dialog.showOpenDialog({
      title: 'R2へアップロードするファイルを選択',
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  handleIpc(IPC.R2_BEGIN_UPLOAD, (_e, b: unknown, p: unknown, f: unknown, o: unknown) => {
    if (typeof b !== 'string' || typeof p !== 'string' || typeof f !== 'string')
      throw new Error('Invalid upload');
    return r2().beginUpload(b, p, f, o === true);
  });
  handleIpc(IPC.R2_UPLOADS, () => r2().uploads());
  handleIpc(IPC.R2_RESUME_UPLOAD, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid upload id');
    return r2().resumeUpload(id);
  });
  handleIpc(IPC.R2_PAUSE_UPLOAD, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid upload id');
    return r2().pauseUpload(id);
  });
  handleIpc(IPC.R2_CANCEL_UPLOAD, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid upload id');
    return r2().cancelUpload(id);
  });
  handleIpc(IPC.R2_TEMPLATES, (_e, b: unknown) =>
    r2().templates(typeof b === 'string' ? b : undefined),
  );
  handleIpc(IPC.R2_SAVE_TEMPLATE, (_e, input: any) => r2().saveTemplate(input));
  handleIpc(IPC.R2_DELETE_TEMPLATE, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid template id');
    return r2().deleteTemplate(id);
  });
  handleIpc(IPC.R2_METRICS, () => r2().metrics());
  handleIpc(IPC.CLIPBOARD_WRITE_TEXT, (_e, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Clipboard text must be string');
    clipboard.writeText(text);
  });
  const getAssistantProvider = async (event: IpcMainInvokeEvent, stage: unknown) => {
    const state = projectWindowForSender(event.sender);
    validGrokContextStage(stage);
    const generation = ++state.assistantSelectionGeneration;
    if (event.sender.id !== state.localView.webContents.id)
      throw new Error('Only the project window may select the assistant.');
    if (!state.projectRoot || !assistantProviderState) throw new Error('No active project.');
    const root = state.projectRoot;
    const defaultProvider = (await settingsStore().values()).assistantProvider;
    const provider = await assistantProviderState.resolve(
      root,
      defaultProvider,
      async () => {
        const stages: GrokContextStage[] = ['story', 'models', 'prompt-plan', 'caption'];
        // Existing projects created before this preference was introduced may
        // already have a history in one provider. Preserve that provider.
        const grokHistory = grokChatState
          ? (await Promise.all(stages.map((stage) => grokChatState!.get(root, stage)))).some(
              Boolean,
            )
          : false;
        const codexHistory = codexChatState
          ? (await Promise.all(stages.map((stage) => codexChatState!.get(root, stage)))).some(
              (chats) => chats.threadIds.length > 0,
            )
          : false;
        if (grokHistory && !codexHistory) return 'grok';
        if (codexHistory && !grokHistory) return 'codex';
        return null;
      },
      stage,
    );
    if (state.projectRoot !== root || state.assistantSelectionGeneration !== generation)
      throw new Error('Project or stage changed during agent restore.');
    state.paneProvider = provider;
    layoutProjectWindow(state);
    return provider;
  };
  // Legacy Codex-named channels are retained for existing preload consumers.
  handleIpc(IPC.ASSISTANT_GET_PROVIDER, getAssistantProvider);
  handleIpc(IPC.CODEX_GET_PROVIDER, getAssistantProvider);
  const setAssistantProvider = async (
    event: IpcMainInvokeEvent,
    provider: unknown,
    stage: unknown,
  ) => {
    const state = projectWindowForSender(event.sender);
    validGrokContextStage(stage);
    const generation = ++state.assistantSelectionGeneration;
    if (event.sender.id !== state.localView.webContents.id)
      throw new Error('Only the project window may select the assistant.');
    if (provider !== 'grok' && provider !== 'codex') throw new Error('Invalid AI provider.');
    if (!state.projectRoot || !assistantProviderState) throw new Error('No active project.');
    const root = state.projectRoot;
    await assistantProviderState.remember(root, provider, stage);
    if (state.projectRoot !== root || state.assistantSelectionGeneration !== generation)
      throw new Error('Project or stage changed during agent switch.');
    state.paneProvider = provider;
    layoutProjectWindow(state);
    return paneState(state);
  };
  handleIpc(IPC.ASSISTANT_SET_PROVIDER, setAssistantProvider);
  handleIpc(IPC.CODEX_SET_PROVIDER, setAssistantProvider);
  handleIpc(IPC.CODEX_SET_CONTEXT, (event, root: unknown, stage: unknown) => {
    const state = projectWindowForSender(event.sender);
    if (event.sender.id !== state.localView.webContents.id)
      throw new Error('Only the project window can select an AI context.');
    validRoot(root);
    validGrokContextStage(stage);
    if (!state.projectRoot || projectRootKey(root) !== projectRootKey(state.projectRoot))
      throw new Error('This project is not active in the current window.');
    state.codexContext = { root: path.resolve(root), stage };
    stateCodexActiveThread.set(state.window.id, null);
    state.codexView.webContents.send(IPC.CODEX_CONTEXT_CHANGED, state.codexContext);
  });
  handleIpc(IPC.CODEX_CONTEXT, (event) => {
    const state = projectWindowForSender(event.sender);
    return state.codexContext;
  });
  handleIpc(IPC.CODEX_SELECT_STAGE_TASK, (event, root: unknown, stage: unknown) => {
    const state = projectWindowForSender(event.sender);
    if (event.sender.id !== state.localView.webContents.id)
      throw new Error('Only the project window can select a Codex task.');
    validRoot(root);
    if (!state.projectRoot || projectRootKey(root) !== projectRootKey(state.projectRoot))
      throw new Error('This project is not active in the current window.');
    if (state.paneProvider !== 'codex') throw new Error('Codex is not the selected AI provider.');
    const context = codexContextFor(state);
    if (
      projectRootKey(root) !== projectRootKey(context.root) ||
      !codexTaskContexts[context.stage].includes(stage as GrokTask['stage'])
    )
      throw new Error('選択した依頼は現在の工程に対応していません。');
    state.codexView.webContents.send(IPC.CODEX_STAGE_TASK_SELECTED, stage);
  });

  handleIpc(IPC.CODEX_STATUS, () => codexAccount());
  handleIpc(IPC.CODEX_SIGN_IN, async () => {
    const { server } = codexService();
    const response = await server.request<{ type: string; authUrl?: string }>(
      'account/login/start',
      { type: 'chatgpt', useHostedLoginSuccessPage: true, appBrand: 'chatgpt' },
    );
    if (response.type !== 'chatgpt' || !response.authUrl)
      throw new Error('CodexのサインインURLを取得できません。');
    const url = new URL(response.authUrl);
    if (
      url.protocol !== 'https:' ||
      !['chatgpt.com', 'auth.openai.com'].includes(url.hostname.toLowerCase())
    )
      throw new Error('Codexが予期しないサインインURLを返しました。');
    await shell.openExternal(url.toString());
  });
  handleIpc(IPC.CODEX_SNAPSHOT, (event) => codexSnapshot(projectWindowForSender(event.sender)));
  handleIpc(IPC.CODEX_MODELS, (event) =>
    codexModelSettings(codexContextFor(projectWindowForSender(event.sender))),
  );
  handleIpc(IPC.CODEX_SELECT_MODEL, (event, selection: unknown) =>
    codexChooseModel(projectWindowForSender(event.sender), selection),
  );
  handleIpc(IPC.CODEX_NEW_CHAT, async (event) => {
    const state = projectWindowForSender(event.sender);
    const context = codexContextFor(state);
    const { store } = codexService();
    await store.clearActive(context.root, context.stage);
    stateCodexActiveThread.set(state.window.id, null);
    return codexSnapshot(state);
  });
  handleIpc(IPC.CODEX_RESTORE_CHAT, async (event, id: unknown) => {
    const state = projectWindowForSender(event.sender);
    const context = codexContextFor(state);
    if (typeof id !== 'string' || !id) throw new Error('Invalid Codex thread ID.');
    const { store } = codexService();
    const saved = await store.get(context.root, context.stage);
    if (!saved.threadIds.includes(id)) throw new Error('Chat is not part of this stage.');
    await store.remember(context.root, context.stage, id);
    stateCodexActiveThread.set(state.window.id, id);
    return codexSnapshot(state);
  });
  handleIpc(IPC.CODEX_STOP_TURN, (event) => codexStopTurn(projectWindowForSender(event.sender)));
  handleIpc(IPC.CODEX_SEND, (event, input: unknown) => {
    if (typeof input !== 'string') throw new Error('Invalid Codex prompt.');
    return codexSend(projectWindowForSender(event.sender), input);
  });
  handleIpc(IPC.CODEX_SEND_TASK, (event, stage: unknown, extra: unknown) => {
    const validStages = Object.values(codexTaskContexts).flat();
    if (!validStages.includes(stage as GrokTask['stage'])) throw new Error('Invalid task stage.');
    if (extra != null && (typeof extra !== 'string' || extra.length > 30_000))
      throw new Error('Invalid additional instructions.');
    return codexSendTask(
      projectWindowForSender(event.sender),
      stage as GrokTask['stage'],
      typeof extra === 'string' ? extra : '',
    );
  });
  handleIpc(IPC.CODEX_LATEST_ARTIFACT, async (event) => {
    const state = projectWindowForSender(event.sender);
    const context = codexContextFor(state);
    const saved = await codexService().store.get(context.root, context.stage);
    return codexArtifactFor(context, saved.activeThreadId);
  });
  handleIpc(IPC.CODEX_RETRY_ARTIFACT, async (event) => {
    const context = codexContextFor(projectWindowForSender(event.sender));
    const saved = await codexService().store.get(context.root, context.stage);
    const threadId = saved.activeThreadId;
    if (!threadId || codexBusy.has(threadId))
      throw new Error('再取得できる完了済みのCodex会話がありません。');
    const read = await readCodexHistory(
      (method, params) => codexService().server.request(method, params),
      threadId,
    );
    const fileName = expectedArtifact(context.stage === 'story' ? 'story-finalize' : context.stage);
    const allowedFiles =
      context.stage === 'prompt-plan'
        ? ['prompt_plan.json', 'prompt_plan_patch.json']
        : fileName
          ? [fileName]
          : [];
    const turn = latestCompletedArtifactTurn(read.thread?.turns ?? [], allowedFiles);
    if (!turn) throw new Error('この工程の完了済みArtifact依頼が見つかりません。');
    const taskStage =
      context.stage === 'story'
        ? 'story-finalize'
        : context.stage === 'models'
          ? 'models'
          : context.stage === 'prompt-plan'
            ? codexTaskFileForTurn(turn) === 'prompt_plan_patch.json'
              ? 'prompt-plan-patch'
              : 'prompt-plan'
            : 'caption';
    const workspace =
      typeof turn.id === 'string'
        ? await findCodexWorkspace(
            context.root,
            app.getPath('userData'),
            threadId,
            turn.id,
            taskStage,
          )
        : null;
    if (workspace) {
      const raw = await readCodexOutput(workspace);
      return importAutoArtifact(
        context.root,
        'codex',
        taskStage,
        threadId + '/' + turn.id,
        raw,
        notifyAutoArtifact,
      );
    }
    // Older tasks sent before file-based generation still carry their answer
    // in the completed turn. Never use the reply for a new file-based turn.
    const reply = [...(turn.items ?? [])]
      .reverse()
      .find((item) => (item as { type?: string } | null)?.type === 'agentMessage');
    const raw =
      reply && typeof reply === 'object' ? messageText(reply as Record<string, unknown>) : '';
    if (!raw.trim()) throw new Error('Codexの回答から成果物本文を取得できません。');
    return importAutoArtifact(
      context.root,
      'codex',
      taskStage,
      threadId + '/' + String(turn.id ?? 'last'),
      raw,
      notifyAutoArtifact,
    );
  });
  handleIpc(IPC.CODEX_SAVE_RESPONSE, async (event, response: unknown) => {
    const state = projectWindowForSender(event.sender);
    const context = codexContextFor(state);
    if (typeof response !== 'string' || response.length > 10_000_000)
      throw new Error('Invalid Codex response.');
    const selected = await dialog.showSaveDialog(state.window, {
      title: 'Codexの回答をファイルとして保存',
      defaultPath: path.join(app.getPath('downloads'), codexReturnFile[context.stage]),
      filters: [
        {
          name: '工程の成果物',
          extensions: [path.extname(codexReturnFile[context.stage]).slice(1)],
        },
      ],
    });
    if (selected.canceled || !selected.filePath) return null;
    await writeFile(selected.filePath, response, 'utf8');
    return selected.filePath;
  });
  handleIpc(IPC.GROK_SET_VISIBLE, (event, v: unknown) => {
    const state = projectWindowForSender(event.sender);
    state.grokVisible = v === true;
    layoutProjectWindow(state);
    return paneState(state);
  });
  handleIpc(IPC.GROK_SET_CONTEXT, (event, root: unknown, stage: unknown) => {
    validRoot(root);
    validGrokContextStage(stage);
    return setGrokContext(projectWindowForSender(event.sender), root, stage);
  });
  handleIpc(IPC.GROK_SET_RATIO, (event, r: unknown) => {
    if (typeof r !== 'number' || !Number.isFinite(r)) throw new Error('Invalid ratio');
    const state = projectWindowForSender(event.sender);
    state.localRatio = Math.max(0.3, Math.min(0.7, r));
    layoutProjectWindow(state);
    return paneState(state);
  });
  handleIpc(IPC.GROK_SET_DIVIDER_X, (event, x: unknown) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('Invalid divider position');
    const state = projectWindowForSender(event.sender),
      bounds = state.window.getContentBounds();
    state.localRatio = Math.max(0.3, Math.min(0.7, (x - bounds.x) / Math.max(bounds.width, 1)));
    layoutProjectWindow(state);
    return paneState(state);
  });
  handleIpc(IPC.GROK_RELOAD, (event) =>
    projectWindowForSender(event.sender).grokView.webContents.reload(),
  );
  handleIpc(IPC.GROK_OPEN_EXTERNAL, () => shell.openExternal(GROK_URL));
}
