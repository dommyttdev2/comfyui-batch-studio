import type { IpcMainInvokeEvent } from 'electron';
import type { GrokContextStage, GrokTask } from '../../shared/types.js';
import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerAssistantIpc(dependencies: IpcRegistrationDependencies) {
  const {
    GROK_URL,
    IPC,
    app,
    assistantProviderState,
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
    dialog,
    expectedArtifact,
    findCodexWorkspace,
    grokChatState,
    handleIpc,
    importAutoArtifact,
    latestCompletedArtifactTurn,
    layoutProjectWindow,
    messageText,
    notifyAutoArtifact,
    paneState,
    path,
    projectRootKey,
    projectWindowForSender,
    readCodexHistory,
    readCodexOutput,
    setGrokContext,
    settingsStore,
    shell,
    stateCodexActiveThread,
    writeFile,
  } = dependencies;
  const validRoot: IpcRegistrationDependencies['validRoot'] = dependencies.validRoot;
  const validGrokContextStage: IpcRegistrationDependencies['validGrokContextStage'] =
    dependencies.validGrokContextStage;

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
