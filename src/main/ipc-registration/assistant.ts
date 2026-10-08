import { AssistantCommands } from '../../application/assistant-commands.js';
import type { IpcMainInvokeEvent } from 'electron';
import type { AssistantPaneContext, GrokContextStage, GrokTask } from '../../shared/types.js';
import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerAssistantIpc(dependencies: IpcRegistrationDependencies) {
  const {
    IPC,
    assistantProviderState,
    agentConversationRunner,
    agentSessionState,
    assistantChooseModel,
    assistantContextFor,
    assistantModelSettings,
    assistantSnapshot,
    codexTaskContexts,
    contextStageForTask,
    codexCliTaskRunner,
    grokCliTaskRunner,
    handleIpc,
    layoutProjectWindow,
    paneState,
    path,
    projectRootKey,
    projectWindowForSender,
    setAssistantContext,
    settingsStore,
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
    const provider = await assistantProviderState.resolve(root, defaultProvider, stage);
    if (state.projectRoot !== root || state.assistantSelectionGeneration !== generation)
      throw new Error('Project or stage changed during agent restore.');
    state.paneProvider = provider;
    if (
      state.assistantContext &&
      state.projectRoot &&
      projectRootKey(state.assistantContext.root) === projectRootKey(state.projectRoot) &&
      state.assistantContext.stage === stage
    ) {
      state.assistantContext = { ...state.assistantContext, provider };
      state.assistantView.webContents.send(IPC.ASSISTANT_CONTEXT_CHANGED, state.assistantContext);
    }
    layoutProjectWindow(state);
    return provider;
  };
  handleIpc(IPC.ASSISTANT_GET_PROVIDER, getAssistantProvider);
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

  const commands = new AssistantCommands({
    conversation: agentConversationRunner,
    tasks: { codex: codexCliTaskRunner, grok: grokCliTaskRunner },
    sessions: agentSessionState,
    rootKey: projectRootKey,
  });

  handleIpc(IPC.ASSISTANT_SET_CONTEXT, (event, root: unknown, stage: unknown) => {
    const state = projectWindowForSender(event.sender);
    if (event.sender.id !== state.localView.webContents.id)
      throw new Error('Only the project window can select an AI context.');
    validRoot(root);
    validGrokContextStage(stage);
    if (!state.projectRoot || projectRootKey(root) !== projectRootKey(state.projectRoot))
      throw new Error('This project is not active in the current window.');
    setAssistantContext(state, root, stage);
  });
  handleIpc(
    IPC.ASSISTANT_CONTEXT,
    (event) => projectWindowForSender(event.sender).assistantContext,
  );
  handleIpc(IPC.ASSISTANT_SNAPSHOT, (event) =>
    assistantSnapshot(projectWindowForSender(event.sender)),
  );
  handleIpc(IPC.ASSISTANT_SEND, async (event, message: unknown) => {
    const state = projectWindowForSender(event.sender);
    const context = assistantContextFor(state);
    if (typeof message !== 'string') throw new Error('AI message must be text.');
    return commands.send(context, message);
  });
  handleIpc(IPC.ASSISTANT_STOP_TURN, async (event) => {
    const context = assistantContextFor(projectWindowForSender(event.sender));
    await commands.stopConversation(context);
  });
  handleIpc(IPC.ASSISTANT_NEW_CONVERSATION, async (event) => {
    const state = projectWindowForSender(event.sender);
    const context = assistantContextFor(state);
    await commands.newConversation(context);
    return assistantSnapshot(state);
  });
  handleIpc(IPC.ASSISTANT_RESTORE_CONVERSATION, async (event, sessionId: unknown) => {
    const state = projectWindowForSender(event.sender);
    const context = assistantContextFor(state);
    if (typeof sessionId !== 'string' || !sessionId) throw new Error('Invalid AI session ID.');
    await commands.restoreConversation(context, sessionId);
    return assistantSnapshot(state);
  });
  handleIpc(IPC.ASSISTANT_MODELS, async (event) => {
    const context = assistantContextFor(projectWindowForSender(event.sender));
    return assistantModelSettings(context.root, context.stage, context.provider);
  });
  handleIpc(IPC.ASSISTANT_SELECT_MODEL, async (event, selection: unknown) => {
    const context = assistantContextFor(projectWindowForSender(event.sender));
    return commands.selectModel(context, () =>
      assistantChooseModel(context.root, context.stage, context.provider, selection),
    );
  });

  handleIpc(IPC.ASSISTANT_SET_VISIBLE, (event, visible: unknown) => {
    const state = projectWindowForSender(event.sender);
    state.assistantVisible = visible === true;
    layoutProjectWindow(state);
    return paneState(state);
  });
  handleIpc(IPC.ASSISTANT_SET_RATIO, (event, ratio: unknown) => {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio)) throw new Error('Invalid ratio');
    const state = projectWindowForSender(event.sender);
    state.localRatio = Math.max(0.3, Math.min(0.7, ratio));
    layoutProjectWindow(state);
    return paneState(state);
  });
  handleIpc(IPC.ASSISTANT_SET_DIVIDER_X, (event, screenX: unknown) => {
    if (typeof screenX !== 'number' || !Number.isFinite(screenX))
      throw new Error('Invalid divider position');
    const state = projectWindowForSender(event.sender);
    const bounds = state.window.getContentBounds();
    state.localRatio = Math.max(
      0.3,
      Math.min(0.7, (screenX - bounds.x) / Math.max(bounds.width, 1)),
    );
    layoutProjectWindow(state);
    return paneState(state);
  });

  const validateAgentTaskRequest = (
    event: IpcMainInvokeEvent,
    root: unknown,
    stage: unknown,
    extra?: unknown,
  ) => {
    const state = projectWindowForSender(event.sender);
    if (event.sender.id !== state.localView.webContents.id)
      throw new Error('Only the project window may control AI tasks.');
    validRoot(root);
    const validStages = Object.values(codexTaskContexts).flat();
    if (!validStages.includes(stage as GrokTask['stage'])) throw new Error('Invalid task stage.');
    if (!state.projectRoot || projectRootKey(root) !== projectRootKey(state.projectRoot))
      throw new Error('This project is not active in the current window.');
    if (extra != null && (typeof extra !== 'string' || extra.length > 30_000))
      throw new Error('Invalid additional instructions.');
    return {
      state,
      root: path.resolve(root),
      stage: stage as GrokTask['stage'],
      contextStage: contextStageForTask(stage as GrokTask['stage']),
      extra: typeof extra === 'string' ? extra : '',
    };
  };
  handleIpc(IPC.AGENT_TASK_START, async (event, root: unknown, stage: unknown, extra: unknown) => {
    const request = validateAgentTaskRequest(event, root, stage, extra);
    await commands.startTask(
      request.root,
      request.state.paneProvider,
      request.stage,
      request.extra,
    );
  });
  handleIpc(IPC.AGENT_TASK_STOP, async (event, root: unknown, stage: unknown) => {
    const request = validateAgentTaskRequest(event, root, stage);
    await commands.stopTask(request.root, request.state.paneProvider, request.stage);
  });
}
