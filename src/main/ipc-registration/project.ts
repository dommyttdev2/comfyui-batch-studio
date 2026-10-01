import type {
  AppSettingsSaveInput,
  GrokTask,
  ProjectBriefInput,
  ProjectSettings,
  PromptPlanArtifact,
} from '../../shared/types.js';
import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerProjectIpc(dependencies: IpcRegistrationDependencies) {
  const {
    IPC,
    beginEditArtifact,
    confirmArtifact,
    confirmRunStopBeforeLeave,
    createProject,
    dialog,
    editorFlushReplies,
    ensureCatalogRuntimePath,
    ensureProjectWritable,
    focusProjectWindow,
    handleIpc,
    importGrok,
    layoutProjectWindow,
    manualResetFrom,
    path,
    projectRootKey,
    projectWindowForRoot,
    projectWindowForSender,
    readArtifact,
    readGrokLoraSelectionHistory,
    refreshRecentProjectMenu,
    rememberMostRecentOpenProject,
    rememberProjectAndRefreshMenu,
    saveDraft,
    saveProjectBrief,
    saveProjectSettings,
    savePromptPlan,
    scanProject,
    scanWithCatalog,
    setWindowProject,
    settingsStore,
    shell,
    stateStore,
    statusSnapshots,
  } = dependencies;
  const validRoot: IpcRegistrationDependencies['validRoot'] = dependencies.validRoot;
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
    state.assistantContext = null;
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
  handleIpc(IPC.FILE_SHOW_IN_FOLDER, (_e, filePath: unknown) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath))
      throw new Error('Invalid file path');
    shell.showItemInFolder(filePath);
  });
}
