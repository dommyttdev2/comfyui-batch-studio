import {
  app,
  BaseWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  shell,
  WebContentsView,
} from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { IPC } from '../shared/ipc.js';
import { registerIpc } from './ipc-registration.js';
import { PickerSelectionGate } from './picker-selection-gate.js';
import { authorizeIpcAccess, type IpcSenderContext } from './ipc-access.js';
import type {
  AppSettingsSaveInput,
  CatalogSelectionTemplateInput,
  CivitaiCatalogStatus,
  CivitaiConnectionInput,
  GrokContextStage,
  AssistantPaneState,
  ExecutionRun,
  ProjectBriefInput,
  ProjectSettings,
  PromptPlanArtifact,
  GrokTask,
  AssistantPaneProvider,
  AutoArtifactEvent,
  ThumbnailSlotKey,
  MarketplaceSourceType,
  R2ConnectionInput,
  ValidationIssue,
  VastAiConnectionInput,
  VastAiOfferSearchInput,
  VastAiRentRequest,
  VastAiSshEndpoint,
  AgentEvent,
  AgentProvider,
  AgentModelSelection,
  AgentModelSettings,
  AssistantPaneContext,
  AssistantPaneSnapshot,
} from '../shared/types.js';
import {
  createProject,
  confirmArtifact,
  importGrok,
  readArtifact,
  beginEditArtifact,
  saveDraft,
  savePromptPlan,
  saveProjectBrief,
} from './artifact-service.js';
import { readGrokLoraSelectionHistory } from './grok-lora-history.js';
import { manualResetFrom, type ManualResetScope } from './model-downstream-reset.js';
import { scanProject } from './project-scan.js';
import { readProjectMeta, saveProjectSettings } from './project-meta.js';
import { catalogStatus } from './model-catalog.js';
import { compileWorkflow } from './compiler.js';
import { checkAvailability, checkLoraFileAvailability } from './availability.js';
import { runPreflight } from './preflight.js';
import {
  abandonExecutionRunForRemoteReplacement,
  discardExecutionRun,
  getCurrentExecutionRun,
  getCurrentExecutionRunFast,
  getExecutionRun,
  inspectExecutionRunStorage,
  listExecutionRuns,
  mutateExecutionRun,
  requestForceInterrupt,
  requestStopScheduling,
  resumeExecutionRun,
  resumeExecutionRunFinalization,
  restoreExecutionRunBackup,
  startExecutionRun,
  validatedExecutionEvidence,
} from './execution-run.js';
import { LocalExecutionService, verifyLocalOutputs } from './local-execution.js';
import { ComfyUiClient } from './comfyui-client.js';
import { ExecutionCoordinator } from './execution-coordinator.js';
import { CivitaiCatalogService } from './civitai-catalog.js';
import { CivitaiRequestPolicy } from './civitai-request-policy.js';
import { CivitaiConfigStore } from './civitai-config.js';
import { UiStateStore } from './ui-state.js';
import { AssistantProviderStore } from './assistant-provider-state.js';
import { CodexCliAdapter } from './codex-cli-adapter.js';
import { AgentSessionStateStore } from './agent-session-state.js';
import type { AgentCliAdapter } from './agent-cli-adapter.js';
import { AgentConversationStore } from './agent-conversation-store.js';
import { AgentConversationRunner } from './agent-conversation-runner.js';
import { AgentModelSelectionStore } from './agent-model-selection.js';
import { importAutoArtifact } from './agent-artifact-import.js';
import { GrokCliAdapter } from './grok-cli-adapter.js';
import { GrokCliTaskRunner } from './grok-cli-task-runner.js';
import { CodexCliTaskRunner } from './codex-cli-task-runner.js';
import { R2ConfigStore } from './r2-config.js';
import { R2Manager } from './r2-manager.js';
import { R2ObjectIndex } from './r2-object-index.js';
import { AppSettingsStore } from './app-settings.js';
import { VastAiConfigStore, VASTAI_ENVIRONMENT_VARIABLE } from './vastai-config.js';
import { VastAiClient, VastAiInstanceNotFoundError } from './vastai-client.js';
import { validateSshKeyPair } from './ssh-key-pair.js';
import { SshHostKeyStore } from './ssh-host-keys.js';
import { VerifiedSshClient } from './ssh-client.js';
import { RemoteWorkerClient } from './remote-worker.js';
import { RemoteControlPlane } from './remote-control-plane.js';
import { RemoteModelStager } from './remote-model-stager.js';
import { RemoteEnvironmentBootstrap } from './remote-environment-bootstrap.js';
import { RemoteExecutionService } from './remote-execution.js';
import { RemoteInstanceLifecycleService } from './remote-instance-lifecycle.js';
import {
  generateCaption,
  getCaptionStatus,
  importCaptionGrok,
  savePixivTitle,
} from './caption-service.js';
import { getFinalArtifactStatus } from './final-artifact-service.js';
import {
  assertFinalArtifactImage,
  listFinalArtifactImages,
  readFinalArtifactImage,
  readFinalArtifactPreview,
} from './final-artifact-image-service.js';
import {
  exportCustomMarketplaceImage,
  generateMarketplaceImages,
  generateMarketplaceZip,
  getMarketplaceImageTargets,
  loadMarketplaceImageState,
  restoreMarketplaceImageState,
  initializeCorruptMarketplaceImageState,
  renderMarketplacePng,
  saveMarketplaceImageState,
  readMarketplaceSource,
  readMarketplaceSourcePreview,
} from './marketplace-image-service.js';
import {
  exportThumbnail,
  deleteThumbnailOutputs,
  listExportedThumbnails,
  assertExportedThumbnail,
  listThumbnailFonts,
  listThumbnailImages,
  loadThumbnailState,
  restoreThumbnailState,
  initializeCorruptThumbnailState,
  readThumbnailImage,
  readThumbnailPreview,
  readThumbnailTemplate,
  saveThumbnailState,
} from './thumbnail-service.js';
import {
  readCachedThumbnailImage,
  storeWebpThumbnailPreview,
  thumbnailCachePruneMetrics,
  type ThumbnailCacheTiming,
} from './thumbnail-image-cache.js';
import {
  logThumbnailPickerPerformance,
  pickerPerformanceLogPath,
  type PickerMetrics,
} from './thumbnail-picker-perf.js';

const __filename = fileURLToPath(import.meta.url),
  __dirname = path.dirname(__filename);
type StandaloneWindowTool = 'r2' | 'civit' | 'vastai';
type RendererWindowTool =
  | StandaloneWindowTool
  | 'thumbnail-picker'
  | 'marketplace-picker'
  | 'assistant-pane';
type StandaloneToolWindowState = { window: BaseWindow; view: WebContentsView };
type ThumbnailPickerWindowState = {
  selection: PickerSelectionGate;
  previewRequestId: number;
  openedAt: number;
  previewCount: number;
  window: BaseWindow;
  view: WebContentsView;
  opener: WebContents;
  root: string;
  slot: ThumbnailSlotKey;
  currentImagePath: string;
  sessionId: string;
  committed: boolean;
};
type MarketplacePickerWindowState = {
  selection: PickerSelectionGate;
  previewRequestId: number;
  sourceType: MarketplaceSourceType;
  window: BaseWindow;
  view: WebContentsView;
  opener: WebContents;
  root: string;
  currentImagePath: string;
  sessionId: string;
  committed: boolean;
};
const standaloneToolTitles: Record<StandaloneWindowTool, string> = {
  r2: 'R2 File Manager',
  civit: 'Civit Explorer',
  vastai: 'Vast.ai',
};
const standaloneToolWindows = new Map<StandaloneWindowTool, StandaloneToolWindowState>();
const thumbnailPickerWindows = new Map<number, ThumbnailPickerWindowState>();
const marketplacePickerWindows = new Map<number, MarketplacePickerWindowState>();
const executionCoordinator = new ExecutionCoordinator();
const executionRecoveryChecks = new Map<string, Promise<void>>();
const statusReconciliations = new Map<string, Promise<string | null>>();
const statusSnapshots = new Map<string, { at: number; runId: string | null }>();
const STATUS_RECONCILE_INTERVAL_MS = 60_000;

async function ensureExecutionStatusReconciled(root: string): Promise<string | null> {
  const key = path.resolve(root);
  const snapshot = statusSnapshots.get(key);
  if (snapshot && Date.now() - snapshot.at < STATUS_RECONCILE_INTERVAL_MS) return snapshot.runId;
  const pending = statusReconciliations.get(key);
  if (pending) return pending;
  const task = (async () => {
    await reconcilePersistedExecutionRuns(root);
    const runId = (await getCurrentExecutionRun(root))?.runId ?? null;
    statusSnapshots.set(key, { at: Date.now(), runId });
    return runId;
  })();
  statusReconciliations.set(key, task);
  try {
    return await task;
  } finally {
    if (statusReconciliations.get(key) === task) statusReconciliations.delete(key);
  }
}

const approvedWindowCloses = new Set<number>();
const pendingWindowCloses = new Set<number>();
type ProjectWindowState = {
  window: BaseWindow;
  localView: WebContentsView;
  assistantView: WebContentsView;
  paneProvider: AssistantPaneProvider;
  assistantSelectionGeneration: number;
  assistantContext: AssistantPaneContext | null;
  projectRoot: string | null;
  restoreLastProject: boolean;
  assistantVisible: boolean;
  localRatio: number;
  lastFocusedAt: number;
};
const projectWindows = new Map<number, ProjectWindowState>();
let lastFocusedProjectWindowId: number | null = null,
  projectWindowFocusSequence = 0,
  quitApproved = false,
  quitPromptOpen = false,
  civitaiCatalog: CivitaiCatalogService | null = null,
  civitaiPolicy: CivitaiRequestPolicy | null = null,
  civitaiConfig: CivitaiConfigStore | null = null,
  uiState: UiStateStore | null = null,
  assistantProviderState: AssistantProviderStore | null = null,
  codexCliAdapter: CodexCliAdapter | null = null,
  grokCliAdapter: GrokCliAdapter | null = null,
  grokCliTaskRunner: GrokCliTaskRunner | null = null,
  codexCliTaskRunner: CodexCliTaskRunner | null = null,
  agentSessionState: AgentSessionStateStore | null = null,
  agentConversationStore: AgentConversationStore | null = null,
  agentConversationRunner: AgentConversationRunner | null = null,
  agentModelSelections: AgentModelSelectionStore | null = null,
  r2Manager: R2Manager | null = null,
  r2ObjectIndex: R2ObjectIndex | null = null,
  appSettingsStore: AppSettingsStore | null = null,
  localExecutionService: LocalExecutionService | null = null,
  vastAiConfig: VastAiConfigStore | null = null,
  vastAiClient: VastAiClient | null = null,
  remoteControlPlane: RemoteControlPlane | null = null,
  remoteModelStager: RemoteModelStager | null = null,
  remoteEnvironmentBootstrap: RemoteEnvironmentBootstrap | null = null,
  remoteExecutionService: RemoteExecutionService | null = null,
  remoteInstanceLifecycleService: RemoteInstanceLifecycleService | null = null;

function projectRootKey(root: string) {
  const resolved = path.resolve(root);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function paneState(state: ProjectWindowState): AssistantPaneState {
  return { visible: state.assistantVisible, ratio: state.localRatio };
}
function layoutProjectWindow(state: ProjectWindowState) {
  const { width, height } = state.window.getContentBounds();
  if (!state.assistantVisible || width < 840) {
    state.localView.setBounds({ x: 0, y: 0, width, height });
    state.assistantView.setBounds({ x: width, y: 0, width: 0, height });
    return;
  }
  const localWidth = Math.max(420, Math.min(width - 420, Math.round(width * state.localRatio)));
  state.localView.setBounds({ x: 0, y: 0, width: localWidth, height });
  state.assistantView.setBounds({ x: localWidth, y: 0, width: width - localWidth, height });
}
function ipcSenderContext(contents: WebContents): IpcSenderContext {
  for (const state of projectWindows.values()) {
    if (state.localView.webContents.id === contents.id)
      return { kind: 'project-local', projectRoot: state.projectRoot };
    if (state.assistantView.webContents.id === contents.id)
      return { kind: 'project-codex', projectRoot: state.projectRoot };
  }
  const thumbnail = thumbnailPickerWindows.get(contents.id);
  if (thumbnail) return { kind: 'thumbnail-picker', projectRoot: thumbnail.root };
  const marketplace = marketplacePickerWindows.get(contents.id);
  if (marketplace) return { kind: 'marketplace-picker', projectRoot: marketplace.root };
  for (const [tool, state] of standaloneToolWindows) {
    if (state.view.webContents.id !== contents.id) continue;
    if (tool === 'r2') return { kind: 'tool-r2' };
    if (tool === 'civit') return { kind: 'tool-civit' };
    return { kind: 'tool-vastai' };
  }
  return { kind: 'unknown' };
}

async function authorizeIpcImageAccess(
  channel: string,
  contents: WebContents,
  args: readonly unknown[],
) {
  if (channel === IPC.THUMBNAIL_READ_PREVIEW) {
    await validateThumbnailPickerImage(thumbnailPickerForSender(contents), args[0]);
    return;
  }
  if (channel !== IPC.THUMBNAIL_STORE_WEBP_PREVIEW) return;
  const thumbnail = thumbnailPickerWindows.get(contents.id);
  if (thumbnail) {
    await validateThumbnailPickerImage(thumbnail, args[0]);
    return;
  }
  const marketplace = marketplacePickerWindows.get(contents.id);
  if (marketplace) {
    await validateMarketplacePickerImage(marketplace, args[0]);
    return;
  }
  throw new Error('この画像キャッシュ操作は現在のWindowから実行できません。');
}

function handleIpc<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult,
) {
  ipcMain.handle(channel, async (event, ...args) => {
    const sender = ipcSenderContext(event.sender);
    const decision = authorizeIpcAccess(channel, sender, args);
    if (decision.writeRoot) await ensureProjectWritable(decision.writeRoot);
    await authorizeIpcImageAccess(channel, event.sender, args);
    return listener(event, ...(args as TArgs));
  });
}

function projectWindowForSender(contents: WebContents) {
  for (const state of projectWindows.values())
    if (
      state.localView.webContents.id === contents.id ||
      state.assistantView.webContents.id === contents.id
    )
      return state;
  throw new Error('Project Window was not found for IPC sender.');
}
function lastFocusedProjectWindow() {
  if (lastFocusedProjectWindowId != null) {
    const state = projectWindows.get(lastFocusedProjectWindowId);
    if (state) return state;
  }
  return [...projectWindows.values()].sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0] ?? null;
}
function projectWindowForRoot(root: string, except?: ProjectWindowState) {
  const key = projectRootKey(root);
  return (
    [...projectWindows.values()].find(
      (state) => state !== except && state.projectRoot && projectRootKey(state.projectRoot) === key,
    ) ?? null
  );
}
function focusProjectWindow(state: ProjectWindowState) {
  state.window.show();
  state.window.focus();
}
async function setWindowProject(state: ProjectWindowState, root: string | null) {
  if (!root) {
    state.projectRoot = null;
    return;
  }
  const resolved = path.resolve(root),
    existing = projectWindowForRoot(resolved, state);
  if (existing) {
    focusProjectWindow(existing);
    throw new Error('このプロジェクトは既に別のWindowで開かれています。');
  }
  if (
    state.projectRoot &&
    projectRootKey(state.projectRoot) !== projectRootKey(resolved) &&
    !(await confirmRunStopBeforeLeave(state.projectRoot, state.window, 'プロジェクトを切り替える'))
  )
    throw new Error('Runの停止がキャンセルされました。');
  state.projectRoot = resolved;
  statusSnapshots.delete(resolved);
  await rememberProjectAndRefreshMenu(resolved);
}
async function loadRenderer(v: WebContentsView, tool?: RendererWindowTool) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) {
    const url = new URL(dev);
    if (tool === 'assistant-pane') url.searchParams.set('assistant-pane', '1');
    else if (tool) url.searchParams.set('tool', tool);
    await v.webContents.loadURL(url.toString());
  } else
    await v.webContents.loadFile(
      path.resolve(__dirname, '../../dist-renderer/index.html'),
      tool === 'assistant-pane'
        ? { query: { 'assistant-pane': '1' } }
        : tool
          ? { query: { tool } }
          : undefined,
    );
}
async function rememberMostRecentOpenProject(clearIfNone = true) {
  const candidate = [...projectWindows.values()]
    .filter((state) => Boolean(state.projectRoot))
    .sort((a, b) => b.lastFocusedAt - a.lastFocusedAt)[0];
  if (candidate?.projectRoot) await rememberProjectAndRefreshMenu(candidate.projectRoot);
  else if (clearIfNone) {
    await stateStore().clearProject();
    await refreshRecentProjectMenu();
  }
}
function createProjectWindow(
  options: {
    restoreLastProject?: boolean;
    initialProjectRoot?: string | null;
    openCreateOnLoad?: boolean;
  } = {},
) {
  const window = new BaseWindow({
      width: 1540,
      height: 920,
      minWidth: 900,
      minHeight: 640,
      title: 'ComfyUI Batch Studio',
    }),
    localView = new WebContentsView({
      webPreferences: {
        preload: path.resolve(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    assistantView = new WebContentsView({
      webPreferences: {
        preload: path.resolve(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    state: ProjectWindowState = {
      window,
      localView,
      assistantView,
      paneProvider: 'grok',
      assistantSelectionGeneration: 0,
      assistantContext: null,
      projectRoot: options.initialProjectRoot ? path.resolve(options.initialProjectRoot) : null,
      restoreLastProject: Boolean(options.restoreLastProject),
      assistantVisible: false,
      localRatio: 0.45,
      lastFocusedAt: ++projectWindowFocusSequence,
    };
  const windowId = window.id;
  projectWindows.set(windowId, state);
  lastFocusedProjectWindowId = windowId;
  window.contentView.addChildView(localView);
  window.contentView.addChildView(assistantView);
  window.on('focus', () => {
    state.lastFocusedAt = ++projectWindowFocusSequence;
    lastFocusedProjectWindowId = windowId;
    if (state.projectRoot)
      void rememberProjectAndRefreshMenu(state.projectRoot).catch((error) =>
        console.warn('Recent project menu update failed:', error),
      );
  });
  window.on('resize', () => layoutProjectWindow(state));
  window.on('close', (event) => {
    if (quitApproved || approvedWindowCloses.has(windowId)) return;
    event.preventDefault();
    if (pendingWindowCloses.has(windowId)) return;
    pendingWindowCloses.add(windowId);
    void (async () => {
      try {
        if (
          state.projectRoot &&
          !(await confirmRunStopBeforeLeave(state.projectRoot, window, 'Windowを閉じる'))
        )
          return;
        approvedWindowCloses.add(windowId);
        window.close();
      } catch (error) {
        await dialog.showMessageBox(window, {
          type: 'error',
          title: 'Windowを閉じられません',
          message: safeExecutionError(error),
        });
      } finally {
        pendingWindowCloses.delete(windowId);
      }
    })();
  });
  window.on('closed', () => {
    approvedWindowCloses.delete(windowId);
    for (const picker of thumbnailPickerWindows.values()) {
      if (picker.opener.id === localView.webContents.id) picker.window.close();
    }
    for (const picker of marketplacePickerWindows.values()) {
      if (picker.opener.id === localView.webContents.id) picker.window.close();
    }
    localView.webContents.close();
    assistantView.webContents.close();
    projectWindows.delete(windowId);
    if (lastFocusedProjectWindowId === windowId) lastFocusedProjectWindowId = null;
    void rememberMostRecentOpenProject(false);
  });
  layoutProjectWindow(state);
  if (options.openCreateOnLoad)
    localView.webContents.once('did-finish-load', () => {
      localView.webContents.send(IPC.PROJECT_MENU_COMMAND, 'new');
    });
  void loadRenderer(localView);
  void loadRenderer(assistantView, 'assistant-pane');
  return state;
}
function openStandaloneToolWindow(tool: StandaloneWindowTool) {
  const existing = standaloneToolWindows.get(tool);
  if (existing) {
    existing.window.show();
    existing.window.focus();
    return;
  }
  const title = standaloneToolTitles[tool],
    window = new BaseWindow({
      width: 1280,
      height: 840,
      minWidth: 760,
      minHeight: 560,
      title: `${title} - ComfyUI Batch Studio`,
    }),
    view = new WebContentsView({
      webPreferences: {
        preload: path.resolve(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    entry = { window, view };
  standaloneToolWindows.set(tool, entry);
  window.contentView.addChildView(view);
  const resize = () => {
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  window.on('resize', resize);
  window.on('closed', () => {
    view.webContents.close();
    standaloneToolWindows.delete(tool);
  });
  resize();
  void loadRenderer(view, tool).catch((error) =>
    console.error(`${title} window failed to load:`, error),
  );
}
function thumbnailPickerForSender(contents: WebContents) {
  const state = thumbnailPickerWindows.get(contents.id);
  if (!state) throw new Error('Thumbnail picker Window was not found for IPC sender.');
  return state;
}

async function validateThumbnailPickerImage(state: ThumbnailPickerWindowState, imagePath: unknown) {
  if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
  const finalArtifact = await getFinalArtifactStatus(state.root);
  if (!finalArtifact.exists || !finalArtifact.directory)
    throw new Error('最終成果物ディレクトリが設定されていません。');
  const resolved = path.resolve(imagePath);
  const allowed = (await listThumbnailImages(finalArtifact.directory)).some(
    (item) => projectRootKey(item.path) === projectRootKey(resolved),
  );
  if (!allowed) throw new Error('最終成果物ディレクトリ外の画像は選択できません。');
  return resolved;
}

function openThumbnailPickerWindow(
  opener: WebContents,
  root: string,
  slot: ThumbnailSlotKey,
  currentImagePath: string,
) {
  const openedAt = performance.now();
  for (const existing of thumbnailPickerWindows.values()) {
    if (existing.opener.id === opener.id) existing.window.close();
  }
  const window = new BaseWindow({
      width: 1180,
      height: 860,
      minWidth: 760,
      minHeight: 560,
      autoHideMenuBar: true,
      title: 'サムネイル画像を選択 - ComfyUI Batch Studio',
    }),
    view = new WebContentsView({
      webPreferences: {
        preload: path.resolve(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    sessionId = randomUUID(),
    state: ThumbnailPickerWindowState = {
      selection: new PickerSelectionGate(),
      previewRequestId: 0,
      openedAt,
      previewCount: 0,
      window,
      view,
      opener,
      root,
      slot,
      currentImagePath,
      sessionId,
      committed: false,
    },
    contentsId = view.webContents.id;
  thumbnailPickerWindows.set(contentsId, state);
  const cancelOnOpenerDestroyed = () => state.selection.cancel();
  opener.once('destroyed', cancelOnOpenerDestroyed);
  logThumbnailPickerPerformance(app.getPath('userData'), sessionId, 'window_opened', {
    setupMs: performance.now() - openedAt,
  });
  view.webContents.on('did-finish-load', () => {
    logThumbnailPickerPerformance(app.getPath('userData'), sessionId, 'renderer_loaded', {
      sinceOpenMs: performance.now() - openedAt,
    });
  });
  window.removeMenu();
  window.setMenuBarVisibility(false);
  window.contentView.addChildView(view);
  const resize = () => {
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  window.on('resize', resize);
  window.on('closed', () => {
    opener.removeListener('destroyed', cancelOnOpenerDestroyed);
    state.selection.cancel();
    if (!state.committed && !state.opener.isDestroyed())
      state.opener.send(IPC.THUMBNAIL_PICKER_CANCELLED, { sessionId: state.sessionId });
    if (!view.webContents.isDestroyed()) view.webContents.close();
    logThumbnailPickerPerformance(app.getPath('userData'), sessionId, 'window_closed', {
      sinceOpenMs: performance.now() - openedAt,
      previewRequests: state.previewCount,
      committed: state.committed,
    });
    thumbnailPickerWindows.delete(contentsId);
  });
  resize();
  void loadRenderer(view, 'thumbnail-picker').catch((error) =>
    console.error('Thumbnail picker window failed to load:', error),
  );
  return { sessionId };
}

function marketplacePickerForSender(contents: WebContents) {
  const state = marketplacePickerWindows.get(contents.id);
  if (!state) throw new Error('Marketplace image picker Window was not found for IPC sender.');
  return state;
}

async function validateMarketplacePickerImage(
  state: MarketplacePickerWindowState,
  imagePath: unknown,
) {
  if (typeof imagePath !== 'string') throw new Error('Invalid marketplace image path');
  return state.sourceType === 'thumbnail'
    ? assertExportedThumbnail(state.root, imagePath)
    : assertFinalArtifactImage(state.root, imagePath);
}

function openMarketplacePickerWindow(
  opener: WebContents,
  root: string,
  currentImagePath: string,
  sourceType: MarketplaceSourceType,
) {
  for (const existing of marketplacePickerWindows.values()) {
    if (existing.opener.id === opener.id) existing.window.close();
  }
  const window = new BaseWindow({
      width: 1180,
      height: 860,
      minWidth: 760,
      minHeight: 560,
      autoHideMenuBar: true,
      title: '販売サイト用画像を選択 - ComfyUI Batch Studio',
    }),
    view = new WebContentsView({
      webPreferences: {
        preload: path.resolve(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    sessionId = randomUUID(),
    state: MarketplacePickerWindowState = {
      selection: new PickerSelectionGate(),
      previewRequestId: 0,
      sourceType,
      window,
      view,
      opener,
      root,
      currentImagePath,
      sessionId,
      committed: false,
    },
    contentsId = view.webContents.id;
  marketplacePickerWindows.set(contentsId, state);
  const cancelOnOpenerDestroyed = () => state.selection.cancel();
  opener.once('destroyed', cancelOnOpenerDestroyed);
  window.removeMenu();
  window.setMenuBarVisibility(false);
  window.contentView.addChildView(view);
  const resize = () => {
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  window.on('resize', resize);
  window.on('closed', () => {
    opener.removeListener('destroyed', cancelOnOpenerDestroyed);
    state.selection.cancel();
    if (!state.committed && !state.opener.isDestroyed())
      state.opener.send(IPC.MARKETPLACE_PICKER_CANCELLED, { sessionId: state.sessionId });
    if (!view.webContents.isDestroyed()) view.webContents.close();
    marketplacePickerWindows.delete(contentsId);
  });
  resize();
  void loadRenderer(view, 'marketplace-picker').catch((error) =>
    console.error('Marketplace image picker window failed to load:', error),
  );
  return { sessionId };
}

async function chooseProjectOpeningTarget() {
  const current = lastFocusedProjectWindow();
  const buttons = current
    ? ['キャンセル', '現在のWindowで開く', '新しいWindowで開く']
    : ['キャンセル', '新しいWindowで開く'];
  const result = await dialog.showMessageBox({
    type: 'question',
    title: 'Projectを開くWindow',
    message: 'Projectをどこで開きますか？',
    buttons,
    defaultId: current ? 1 : 1,
    cancelId: 0,
    noLink: true,
  });
  if (result.response === 0) return null;
  if (current && result.response === 1) return { mode: 'current' as const, state: current };
  return { mode: 'new' as const, state: null };
}
type ProjectOpeningTarget = NonNullable<Awaited<ReturnType<typeof chooseProjectOpeningTarget>>>;

async function openProjectRootInTarget(root: string, target: ProjectOpeningTarget) {
  const resolved = path.resolve(root);
  const existing = projectWindowForRoot(resolved, target.state ?? undefined);
  if (existing) {
    focusProjectWindow(existing);
    return;
  }
  const project = await scanWithCatalog(resolved);
  if (target.mode === 'new') {
    await rememberProjectAndRefreshMenu(resolved);
    createProjectWindow({ initialProjectRoot: resolved });
    return;
  }
  const state = target.state;
  if (!state) return;
  await setWindowProject(state, resolved);
  focusProjectWindow(state);
  state.localView.webContents.send(IPC.PROJECT_MENU_COMMAND, 'open', project);
}
async function openRecentProjectFromMenu(root: string) {
  const existing = projectWindowForRoot(root);
  if (existing) {
    focusProjectWindow(existing);
    return;
  }
  const target = await chooseProjectOpeningTarget();
  if (target) await openProjectRootInTarget(root, target);
}
async function handleProjectMenuAction(command: 'new' | 'open') {
  const target = await chooseProjectOpeningTarget();
  if (!target) return;
  if (command === 'new') {
    if (target.mode === 'current' && target.state) {
      focusProjectWindow(target.state);
      target.state.localView.webContents.send(IPC.PROJECT_MENU_COMMAND, 'new');
    } else createProjectWindow({ openCreateOnLoad: true });
    return;
  }

  const defaultPath = await stateStore().lastProjectDirectoryPath();
  const selected = await dialog.showOpenDialog({
    title: 'プロジェクトフォルダーを選択',
    defaultPath: defaultPath ?? undefined,
    properties: ['openDirectory'],
  });
  if (!selected.canceled && selected.filePaths[0])
    await openProjectRootInTarget(selected.filePaths[0], target);
}
function sendProjectMenuCommand(command: 'settings' | 'close') {
  const state = lastFocusedProjectWindow();
  if (!state || (command === 'close' && !state.projectRoot)) return;
  focusProjectWindow(state);
  state.localView.webContents.send(IPC.PROJECT_MENU_COMMAND, command);
}
async function openCurrentProjectFolderFromMenu() {
  const state = lastFocusedProjectWindow();
  if (!state?.projectRoot) return;
  const err = await shell.openPath(state.projectRoot);
  if (err)
    await dialog.showMessageBox({
      type: 'error',
      title: 'フォルダを開けません',
      message: err,
    });
}
const RECENT_PROJECT_MENU_LIMIT = 5;
let recentProjectMenuRevision = 0;
async function refreshRecentProjectMenu() {
  const revision = ++recentProjectMenuRevision;
  const recentRoots = await stateStore().recentProjectPaths();
  if (revision === recentProjectMenuRevision) installApplicationMenu(recentRoots);
}
async function rememberProjectAndRefreshMenu(root: string) {
  await stateStore().rememberProject(root);
  await refreshRecentProjectMenu();
}
function installApplicationMenu(recentRoots: string[]) {
  const recentProjectSubmenu: MenuItemConstructorOptions[] = recentRoots
    .slice(0, RECENT_PROJECT_MENU_LIMIT)
    .map((root) => ({
      label: root,
      click: () => {
        void openRecentProjectFromMenu(root).catch(async (error) => {
          await refreshRecentProjectMenu();
          await dialog.showMessageBox({
            type: 'error',
            title: 'プロジェクトを開けません',
            message: `プロジェクトを開けませんでした。\n${root}`,
            detail: error instanceof Error ? error.message : String(error),
          });
        });
      },
    }));
  const windowMenu: MenuItemConstructorOptions[] = [
    { label: 'R2 File Manager', click: () => openStandaloneToolWindow('r2') },
    { label: 'Civit Explorer', click: () => openStandaloneToolWindow('civit') },
    { label: 'Vast.ai', click: () => openStandaloneToolWindow('vastai') },
    { type: 'separator' },
    { label: '最小化', role: 'minimize' },
    { label: 'ウィンドウを閉じる', role: 'close' },
  ];
  const fileMenu: MenuItemConstructorOptions[] = [
    { label: '新規プロジェクト…', click: () => void handleProjectMenuAction('new') },
    { label: 'プロジェクトを開く…', click: () => void handleProjectMenuAction('open') },
    {
      label: '最近開いたプロジェクト',
      submenu: recentProjectSubmenu.length
        ? recentProjectSubmenu
        : [{ label: '最近開いたプロジェクトはありません', enabled: false }],
    },
    { type: 'separator' },
    {
      label: '現在のフォルダを開く',
      click: () => void openCurrentProjectFolderFromMenu(),
    },
    { label: '設定', click: () => sendProjectMenuCommand('settings') },
    { label: 'プロジェクトを閉じる', click: () => sendProjectMenuCommand('close') },
    { type: 'separator' },
    { label: 'ウィンドウを閉じる', role: 'close' },
    { label: '終了', click: () => app.quit() },
  ];
  const editMenu: MenuItemConstructorOptions[] = [
    { label: '元に戻す', role: 'undo' },
    { label: 'やり直す', role: 'redo' },
    { type: 'separator' },
    { label: '切り取り', role: 'cut' },
    { label: 'コピー', role: 'copy' },
    { label: '貼り付け', role: 'paste' },
    { label: '削除', role: 'delete' },
    { type: 'separator' },
    { label: 'すべて選択', role: 'selectAll' },
  ];
  const viewMenu: MenuItemConstructorOptions[] = [
    { label: '再読み込み', role: 'reload' },
    { label: '強制再読み込み', role: 'forceReload' },
    { type: 'separator' },
    { label: '表示倍率をリセット', role: 'resetZoom' },
    { label: '拡大', role: 'zoomIn' },
    { label: '縮小', role: 'zoomOut' },
    { type: 'separator' },
    { label: '全画面表示', role: 'togglefullscreen' },
  ];
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' } as MenuItemConstructorOptions] : []),
    { label: 'ファイル', submenu: fileMenu },
    { label: '編集', submenu: editMenu },
    { label: '表示', submenu: viewMenu },
    { label: 'ウィンドウ', submenu: windowMenu },
    { label: 'ヘルプ', submenu: [] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function validRoot(x: unknown): asserts x is string {
  if (typeof x !== 'string' || !x.trim()) throw new Error('Invalid project root.');
}
function validGrokContextStage(x: unknown): asserts x is GrokContextStage {
  if (x !== 'story' && x !== 'models' && x !== 'prompt-plan' && x !== 'caption')
    throw new Error('Invalid Grok context stage.');
}
function validManualResetScope(x: unknown): asserts x is ManualResetScope {
  if (
    x !== 'story' &&
    x !== 'base-models' &&
    x !== 'models' &&
    x !== 'models-fix' &&
    x !== 'prompt-plan' &&
    x !== 'workflow'
  )
    throw new Error('Invalid reset scope.');
}
function validInstanceId(x: unknown) {
  const id = typeof x === 'number' ? x : Number(x);
  if (!Number.isInteger(id) || id < 1) throw new Error('Invalid Vast.ai Instance ID');
  return id;
}
function catalogService() {
  if (!civitaiCatalog) throw new Error('Civitai Catalog Serviceが初期化されていません。');
  return civitaiCatalog;
}
function civitaiStore() {
  if (!civitaiConfig) throw new Error('Civitai連携設定が初期化されていません。');
  return civitaiConfig;
}
function stateStore() {
  if (!uiState) throw new Error('UI state storeが初期化されていません。');
  return uiState;
}
function settingsStore() {
  if (!appSettingsStore) throw new Error('アプリ環境設定が初期化されていません。');
  return appSettingsStore;
}
function localExecutor() {
  if (!localExecutionService)
    localExecutionService = new LocalExecutionService(async () => {
      const settings = await settingsStore().status();
      return { endpoint: settings.comfyUiApiEndpoint, installPath: settings.comfyUiInstallPath };
    });
  return localExecutionService;
}
function r2() {
  if (!r2Manager) throw new Error('R2 Managerが初期化されていません。');
  return r2Manager;
}
function r2Index() {
  if (!r2ObjectIndex) throw new Error('R2 object indexが初期化されていません。');
  return r2ObjectIndex;
}
function vastStore() {
  if (!vastAiConfig) throw new Error('Vast.ai連携設定が初期化されていません。');
  return vastAiConfig;
}
function vastClient() {
  if (!vastAiClient) throw new Error('Vast.ai Clientが初期化されていません。');
  return vastAiClient;
}
function remoteExecutor() {
  if (!remoteControlPlane) throw new Error('Remote Control Planeが初期化されていません。');
  return remoteControlPlane;
}
function remoteStager() {
  if (!remoteModelStager) throw new Error('Remote Model Stagerが初期化されていません。');
  return remoteModelStager;
}
function remoteBootstrap() {
  if (!remoteEnvironmentBootstrap)
    throw new Error('Remote Environment Bootstrapが初期化されていません。');
  return remoteEnvironmentBootstrap;
}
function remoteLifecycle() {
  if (!remoteInstanceLifecycleService)
    remoteInstanceLifecycleService = new RemoteInstanceLifecycleService(vastClient());
  return remoteInstanceLifecycleService;
}
async function finalizeRemoteInstance(root: string, runId: string) {
  try {
    await remoteLifecycle().finalize(root, runId);
  } catch (error) {
    await mutateExecutionRun(root, runId, (r) => {
      const e = {
        code: 'REMOTE_INSTANCE_FINALIZE_FAILED',
        message: safeExecutionError(error),
        phase: 'CLOUD_INSTANCE_FINALIZING' as const,
        at: new Date().toISOString(),
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
function remoteSceneExecutor() {
  if (!remoteExecutionService)
    remoteExecutionService = new RemoteExecutionService(
      remoteExecutor(),
      r2(),
      finalizeRemoteInstance,
    );
  return remoteExecutionService;
}
function safeExecutionError(error: unknown) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/(?:github_pat_|ghp_)[A-Za-z0-9_]+/gi, '[token]');
}
const REMOTE_PRE_GENERATION_PHASES = new Set([
  'CLOUD_INSTANCE_RESOLVING',
  'CLOUD_INSTANCE_STARTING',
  'CLOUD_INSTANCE_READY',
  'SSH_CONNECTING',
  'SSH_CONNECTED',
  'REMOTE_WORKER_PREPARING',
  'REMOTE_ENVIRONMENT_CHECKING',
  'REMOTE_DEPENDENCIES_INSTALLING',
  'REMOTE_GITHUB_AUTHENTICATING',
  'REMOTE_COMFYUI_UPDATING',
  'REMOTE_COMFYUI_RELEASE_CHECKING',
  'REMOTE_COMFYUI_RELEASE_FETCHING',
  'REMOTE_COMFYUI_CHECKING_OUT',
  'REMOTE_COMFYUI_REQUIREMENTS_INSTALLING',
  'REMOTE_COMFYUI_MANAGER_CONFIGURING',
  'REMOTE_CUSTOM_NODES_SYNCING',
  'REMOTE_COMFYUI_RESTARTING',
  'REMOTE_ENVIRONMENT_READY',
  'REMOTE_MODELS_CHECKING',
  'REMOTE_MODELS_DOWNLOADING',
  'REMOTE_MODELS_READY',
  'WORKFLOW_PREPARING',
]);
function isRemotePreGenerationPhase(phase: string) {
  return REMOTE_PRE_GENERATION_PHASES.has(phase);
}
async function prepareRemoteExecution(root: string, runId: string) {
  try {
    const settings = await settingsStore().status(),
      githubToken = await settingsStore().githubPat();
    await remoteLifecycle().prepare(root, runId);
    await remoteExecutor().connect(root, runId);
    await remoteBootstrap().prepare(root, runId, {
      githubToken,
      customNodes: settings.remoteCustomNodes,
    });
    await remoteStager().stage(root, runId);
    await remoteSceneExecutor().start(root, runId);
    const settled = await getExecutionRun(root, runId);
    if (settled?.lifecycle === 'DISCARDED') await finalizeRemoteInstance(root, runId);
  } catch (error) {
    const current = await getExecutionRun(root, runId);
    if (current?.lifecycle === 'PAUSED' || current?.lifecycle === 'INTERRUPTED') {
      remoteExecutor().disconnect(root, runId);
      return;
    }
    if (current?.lifecycle === 'DISCARDED') {
      await finalizeRemoteInstance(root, runId);
      remoteExecutor().disconnect(root, runId);
      return;
    }
    if (current?.lifecycle === 'FAILED' && current.error?.code === 'REMOTE_INSTANCE_REPLACED') {
      await finalizeRemoteInstance(root, runId);
      remoteExecutor().disconnect(root, runId);
      return;
    }
    await mutateExecutionRun(root, runId, (r) => {
      const modelPhase =
        r.phase === 'REMOTE_MODELS_CHECKING' || r.phase === 'REMOTE_MODELS_DOWNLOADING';
      const bootstrapPhase = [
        'REMOTE_DEPENDENCIES_INSTALLING',
        'REMOTE_GITHUB_AUTHENTICATING',
        'REMOTE_COMFYUI_UPDATING',
        'REMOTE_COMFYUI_RELEASE_CHECKING',
        'REMOTE_COMFYUI_RELEASE_FETCHING',
        'REMOTE_COMFYUI_CHECKING_OUT',
        'REMOTE_COMFYUI_REQUIREMENTS_INSTALLING',
        'REMOTE_COMFYUI_MANAGER_CONFIGURING',
        'REMOTE_CUSTOM_NODES_SYNCING',
        'REMOTE_COMFYUI_RESTARTING',
        'REMOTE_ENVIRONMENT_READY',
      ].includes(r.phase);
      const lifecyclePhase = [
        'CLOUD_INSTANCE_RESOLVING',
        'CLOUD_INSTANCE_STARTING',
        'CLOUD_INSTANCE_READY',
        'CLOUD_INSTANCE_FINALIZING',
      ].includes(r.phase);
      const code = lifecyclePhase
        ? 'REMOTE_INSTANCE_LIFECYCLE_FAILED'
        : modelPhase
          ? 'REMOTE_MODEL_STAGING_FAILED'
          : bootstrapPhase
            ? 'REMOTE_ENVIRONMENT_BOOTSTRAP_FAILED'
            : 'REMOTE_CONTROL_PLANE_FAILED';
      const e = {
        code,
        message: safeExecutionError(error),
        phase: r.phase,
        at: new Date().toISOString(),
        retryable: true,
      };
      r.error = e;
      r.errorHistory.push(e);
      r.lifecycle = 'FAILED';
      r.controls.scheduling = 'STOPPED';
    });
    await finalizeRemoteInstance(root, runId);
    remoteExecutor().disconnect(root, runId);
  }
}

async function markExecutionRecoveryUncertain(root: string, runId: string, reason: unknown) {
  return mutateExecutionRun(root, runId, (run) => {
    if (run.lifecycle !== 'RUNNING') return;
    const failure = {
      code: 'EXECUTION_RECOVERY_UNCERTAIN',
      message: `前回の実行状態を確定できません。既存PromptやWorkerが稼働中の可能性があるため、重複投入を防止しました。ComfyUI Queue/HistoryとVast.ai Instanceの状態を確認してください: ${safeExecutionError(reason)}`,
      phase: run.phase,
      at: new Date().toISOString(),
      retryable: false,
    };
    run.error = failure;
    run.errorHistory.push(failure);
    run.lifecycle = 'FAILED';
    run.controls.scheduling = 'STOPPED';
    // Preserve current.promptId, progress and evidence for manual reconciliation.
  });
}

type ExitMode = 'graceful' | 'interrupt';
const EXIT_SETTLE_POLLS = 240;
const exitChecks = new Map<string, Promise<boolean>>();

async function stopVastInstanceForExit(run: ExecutionRun, root: string) {
  const id = Number(run.remote?.instanceId);
  if (!Number.isInteger(id) || id < 1) throw new Error('Remote Run has no Vast.ai Instance ID.');
  const client = vastClient();
  let instance: Awaited<ReturnType<VastAiClient['getInstance']>>;
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
          resolvedAt: new Date().toISOString(),
        };
        current.remoteLifecycle.finalizedAt = new Date().toISOString();
      });
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(
    `Vast.ai Instance #${id} の停止完了を確認できません。課金状態を確認してください。`,
  );
}

// This is a stop-only reconciliation. Never call /prompt or change progress:
// a successfully completed but uncollected image must be recovered separately.
async function stopUncertainLocalRunForEdit(root: string, runId: string, mode: ExitMode) {
  const ref = { projectRoot: path.resolve(root), runId };
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
  const settings = await settingsStore().status();
  const comfy = new ComfyUiClient(settings.comfyUiApiEndpoint);
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
            at: new Date().toISOString(),
            retryable: false,
          };
          current.error = error;
          current.errorHistory.push(error);
        });
        executionCoordinator.releaseReservation(ref);
        return stopped;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    '既存Promptの終了を確認できません。新しいPromptを投入せず、停止操作を中止しました。',
  );
}

// The main process owns this guard. Renderer-only navigation checks cannot protect
// the native window close / File > Quit paths.
async function stopRunForExit(root: string, runId: string, mode: ExitMode) {
  let run = await getExecutionRun(root, runId);
  if (!run) throw new Error('Execution Run disappeared during stop.');
  if (run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN') {
    if (run.executionTarget === 'local') return stopUncertainLocalRunForEdit(root, runId, mode);
    throw new Error(
      'Remote Workerの復旧状態が不確定です。Vast.ai Instanceの停止を確認してからRunを破棄してください。',
    );
  }
  if (run.lifecycle === 'RUNNING') {
    if (
      run.executionTarget === 'remote' &&
      !isRemotePreGenerationPhase(run.phase) &&
      run.phase !== 'EXECUTING'
    )
      throw new Error('Remote成果物の処理中です。処理完了後に工程を移動してください。');
    if (run.executionTarget === 'remote' && isRemotePreGenerationPhase(run.phase)) {
      await mutateExecutionRun(root, runId, (current) => {
        if (current.lifecycle !== 'RUNNING') return;
        current.lifecycle = 'PAUSED';
        current.controls.scheduling = 'STOPPED';
        current.controls.interrupt = 'IDLE';
      });
      await executionCoordinator.waitForSettled({ projectRoot: path.resolve(root), runId });
    } else {
      await requestStopScheduling(root, runId);
      if (run.executionTarget === 'remote') {
        await remoteSceneExecutor().stopScheduling(root, runId);
        if (mode === 'interrupt') {
          await requestForceInterrupt(root, runId);
          await remoteSceneExecutor().forceInterrupt(root, runId);
        }
      } else if (mode === 'interrupt') {
        await requestForceInterrupt(root, runId);
        await localExecutor().forceInterrupt(root, runId);
      }
      for (let attempt = 0; attempt < EXIT_SETTLE_POLLS; attempt++) {
        run = await getExecutionRun(root, runId);
        if (!run || run.lifecycle !== 'RUNNING') break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      run = await getExecutionRun(root, runId);
      if (!run || run.lifecycle === 'RUNNING')
        throw new Error('Runの停止完了を確認できません。実行画面から停止状態を確認してください。');
      if (run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN')
        throw new Error('Promptの状態が不確定です。自動的に安全な停止と判定できません。');
      await executionCoordinator.waitForSettled({ projectRoot: path.resolve(root), runId });
    }
  }
  run = await getExecutionRun(root, runId);
  if (!run || run.lifecycle === 'RUNNING') throw new Error('Run is still running.');
  if (run.executionTarget === 'remote' && run.lifecycle !== 'DISCARDED')
    await stopVastInstanceForExit(run, root);
  return (await getExecutionRun(root, runId))!;
}

async function runRequiresExitGuard(root: string) {
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

async function ensureProjectWritable(root: string) {
  const runs = await listExecutionRuns(root);
  if (
    runs.some(
      (run) =>
        run.lifecycle === 'RUNNING' ||
        (run.executionTarget === 'remote' &&
          !(run.remoteLifecycle?.finalizedAt && run.remoteLifecycle.latest?.status === 'stopped') &&
          (run.lifecycle === 'PAUSED' ||
            run.lifecycle === 'INTERRUPTED' ||
            (run.lifecycle === 'FAILED' &&
              run.error?.code === 'REMOTE_INSTANCE_FINALIZE_FAILED'))) ||
        run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN',
    )
  )
    throw new Error(
      '実行中のRunがあるため、この工程は閲覧専用です。編集はRunの停止後に行ってください。',
    );
}

let editorFlushSequence = 0;
const editorFlushReplies = new Map<
  string,
  {
    senderId: number;
    root: string;
    resolve: (result: { ok: boolean; message?: string }) => void;
  }
>();

async function confirmEditorSavesBeforeLeave(root: string, owner: BaseWindow): Promise<boolean> {
  const state = projectWindows.get(owner.id);
  if (!state || state.localView.webContents.isDestroyed()) return true;
  for (;;) {
    const id = `editor-flush-${++editorFlushSequence}`;
    const result = await new Promise<{ ok: boolean; message?: string }>((resolve) => {
      const timeout = setTimeout(() => {
        editorFlushReplies.delete(id);
        resolve({ ok: false, message: '編集内容の保存確認がタイムアウトしました。' });
      }, 30_000);
      editorFlushReplies.set(id, {
        senderId: state.localView.webContents.id,
        root,
        resolve: (reply) => {
          clearTimeout(timeout);
          resolve(reply);
        },
      });
      state.localView.webContents.send(IPC.EDITOR_FLUSH_REQUEST, id, root);
    });
    if (result.ok) return true;
    const answer = await dialog.showMessageBox(owner, {
      type: 'warning',
      title: '編集内容を保存できません',
      message: result.message || '編集内容の保存に失敗しました。',
      buttons: ['キャンセル', '再試行', '未保存内容を破棄して続行'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (answer.response === 0) return false;
    if (answer.response === 2) return true;
  }
}

async function confirmRunStopBeforeLeave(root: string, owner: BaseWindow, action: string) {
  const key = `${owner.id}\0${path.resolve(root)}`;
  const pending = exitChecks.get(key);
  if (pending) return pending;
  const task = (async () => {
    await reconcilePersistedExecutionRuns(root);
    if (!(await runRequiresExitGuard(root))) return confirmEditorSavesBeforeLeave(root, owner);
    const result = await dialog.showMessageBox(owner, {
      type: 'warning',
      title: '実行中のRunがあります',
      message: `${action}前にRunを停止してください。`,
      detail:
        '生成済みのローカル画像とRunの進捗は保持します。復旧不確定なRunは実行画面から安全な破棄操作が必要です。',
      buttons: ['キャンセル', '生成を停止して続行', '生成を中断して続行'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
    if (result.response === 0) return false;
    const mode: ExitMode = result.response === 1 ? 'graceful' : 'interrupt';
    for (const run of await listExecutionRuns(root)) {
      if (
        run.lifecycle === 'RUNNING' ||
        run.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN' ||
        (run.executionTarget === 'remote' &&
          (['PAUSED', 'INTERRUPTED'].includes(run.lifecycle) ||
            (run.lifecycle === 'FAILED' && run.error?.code === 'REMOTE_INSTANCE_FINALIZE_FAILED')))
      )
        await stopRunForExit(root, run.runId, mode);
    }
    if (await runRequiresExitGuard(root))
      throw new Error(
        'RunまたはVast.ai Instanceの停止を確認できません。移動・終了を中止しました。',
      );
    return confirmEditorSavesBeforeLeave(root, owner);
  })().finally(() => exitChecks.delete(key));
  exitChecks.set(key, task);
  return task;
}

// Refusing a direct loopback connection is evidence that the configured local
// API is not listening. Do not apply this exception to remote or tunneled hosts.
function isDirectLocalComfyRefused(endpoint: string, error: unknown) {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  const refused = (value: unknown): boolean => {
    if (!(value instanceof Error)) return false;
    if (value instanceof AggregateError)
      return value.errors.length > 0 && value.errors.every(refused);
    if ((value as NodeJS.ErrnoException).code === 'ECONNREFUSED') return true;
    return refused(value.cause);
  };
  return refused(error);
}

async function confirmOfflineLocalRunDiscard(
  root: string,
  run: ExecutionRun,
  comfy: ComfyUiClient,
  error: unknown,
  owner: BaseWindow,
) {
  const ref = { projectRoot: path.resolve(root), runId: run.runId };
  if (
    !isDirectLocalComfyRefused(comfy.endpoint, error) ||
    run.lifecycle === 'RUNNING' ||
    executionCoordinator.hasActive(ref)
  )
    throw error;
  const answer = await dialog.showMessageBox(owner, {
    type: 'warning',
    title: '停止したローカルComfyUIの確認',
    message: 'ローカルComfyUIのAPI接続が拒否され、Queue/Historyを取得できません。',
    detail:
      '設定先のローカルComfyUIが完全に停止し、別ポートや転送先で旧Promptが実行されていないことを確認してください。Runの再開履歴は破棄しますが、ローカル保存済み画像は残します。確認できない場合はキャンセルしてください。',
    buttons: ['キャンセル', '停止を確認してRunを破棄'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  });
  if (answer.response !== 1) return false;
  // Recheck at the moment of discard; a newly restarted ComfyUI must be
  // inspected through Queue/History instead of this offline exception.
  try {
    await comfy.health();
  } catch (retry) {
    if (isDirectLocalComfyRefused(comfy.endpoint, retry)) return true;
    throw retry;
  }
  throw new Error('ComfyUIが再起動されました。Queue/Historyを再確認してから破棄してください。');
}

async function discardCurrentExecutionRun(root: string, runId: string, owner: BaseWindow) {
  const current = await getCurrentExecutionRun(root);
  if (!current || current.runId !== runId) throw new Error('現在のRunのみ破棄できます。');
  if (current.lifecycle === 'COMPLETED' || current.lifecycle === 'DISCARDED')
    throw new Error('既に終了したRunは破棄対象ではありません。');
  if (current.lifecycle === 'RUNNING') await stopRunForExit(root, runId, 'interrupt');
  const run = await getExecutionRun(root, runId);
  if (!run) throw new Error('Execution Run disappeared.');
  if (run.executionTarget === 'local') {
    const settings = await settingsStore().status();
    const comfy = new ComfyUiClient(settings.comfyUiApiEndpoint);
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
      if (!(await confirmOfflineLocalRunDiscard(root, run, comfy, error, owner))) return null;
    }
  } else {
    // Even an unreachable Remote Worker can no longer submit once the provider
    // confirms that its entire GPU Instance is stopped.
    await stopVastInstanceForExit(run, root);
    remoteExecutor().disconnect(root, runId);
  }
  const discarded = await discardExecutionRun(root, runId);
  executionCoordinator.releaseReservation({ projectRoot: path.resolve(root), runId });
  return discarded;
}

async function recoverRemoteFinalization(root: string, runId: string) {
  const run = await getExecutionRun(root, runId);
  if (!run) return;
  const evidence = validatedExecutionEvidence(run).valid,
    kinds = new Set(evidence.map((item) => item.kind));
  if (!kinds.has('LOCAL_FILE_VERIFIED') || !kinds.has('CLEANUP_COMPLETED'))
    throw new Error('Completion evidence is incomplete. Refusing a finalize-only recovery.');
  await finalizeRemoteInstance(root, runId);
  const latest = await getExecutionRun(root, runId);
  if (latest?.remoteLifecycle?.finalizedAt && latest.lifecycle === 'RUNNING')
    await mutateExecutionRun(root, runId, (current) => {
      current.lifecycle = 'COMPLETED';
      current.phase = 'COMPLETED';
      current.completedAt = new Date().toISOString();
      current.controls.scheduling = 'STOPPED';
    });
}

// Called on project open/status (and before Start/Resume). Persisted RUNNING is
// not proof that a worker is still active in this Main Process.
async function reconcilePersistedExecutionRuns(root: string) {
  const key = path.resolve(root);
  const pending = executionRecoveryChecks.get(key);
  if (pending) return pending;
  const check = (async () => {
    const runs = await listExecutionRuns(root);
    const settings = await settingsStore().status();
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
        console.warn(
          'Could not reserve an uncertain Execution Run resource:',
          safeExecutionError(error),
        );
      }
    }
    for (const run of [...runs].reverse()) {
      if (run.lifecycle !== 'RUNNING') continue;
      const ref = { projectRoot: key, runId: run.runId };
      if (executionCoordinator.hasActive(ref)) continue;
      try {
        if (run.executionTarget === 'local') {
          const endpoint = settings.comfyUiApiEndpoint;
          if (run.current.promptId || run.submission?.status === 'sending') {
            void executionCoordinator
              .startLocal(ref, endpoint, async () => {
                await localExecutor().recover(root, run.runId);
                const latest = await getExecutionRun(root, run.runId);
                if (latest?.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN')
                  executionCoordinator.retain(ref);
              })
              .finally(maybeQuitAfterExecution);
          } else if (run.submission?.status === 'prepared') {
            // A prepared intent is durably marked before sending; no POST can
            // have occurred unless the sending transition also persisted.
            await mutateExecutionRun(root, run.runId, (current) => {
              if (current.lifecycle !== 'RUNNING' || current.submission?.status !== 'prepared')
                return;
              current.lifecycle = 'PAUSED';
              current.controls.scheduling = 'STOPPED';
            });
          } else if (
            run.phase === 'LOCAL_COMFYUI_CONNECTING' ||
            run.phase === 'LOCAL_CAPABILITY_CHECKING' ||
            run.phase === 'WORKFLOW_PREPARING'
          ) {
            // These phases precede every local POST /prompt.
            await mutateExecutionRun(root, run.runId, (current) => {
              if (current.lifecycle !== 'RUNNING' || current.current.promptId) return;
              current.lifecycle = 'PAUSED';
              current.controls.scheduling = 'STOPPED';
              current.error = null;
            });
          } else if (run.phase === 'COMPLETED') {
            await verifyLocalOutputs(settings.comfyUiInstallPath, run);
            await mutateExecutionRun(root, run.runId, (current) => {
              if (current.lifecycle !== 'RUNNING') return;
              current.lifecycle = 'COMPLETED';
              current.completedAt = new Date().toISOString();
              current.controls.scheduling = 'STOPPED';
            });
          } else {
            executionCoordinator.reserveLocal(ref, endpoint);
            await markExecutionRecoveryUncertain(
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
              if (run.phase === 'CLOUD_INSTANCE_FINALIZING')
                await recoverRemoteFinalization(root, run.runId);
              else await remoteSceneExecutor().recover(root, run.runId);
            } catch (error) {
              await markExecutionRecoveryUncertain(root, run.runId, error);
            }
            const latest = await getExecutionRun(root, run.runId);
            if (latest?.error?.code === 'EXECUTION_RECOVERY_UNCERTAIN')
              executionCoordinator.retain(ref);
          })
          .finally(maybeQuitAfterExecution);
      } catch (error) {
        await markExecutionRecoveryUncertain(root, run.runId, error);
      }
    }
  })().finally(() => executionRecoveryChecks.delete(key));
  executionRecoveryChecks.set(key, check);
  return check;
}

async function startExecutionRuntime(root: string, run: ExecutionRun) {
  const ref = { projectRoot: path.resolve(root), runId: run.runId };
  try {
    if (run.executionTarget === 'local') {
      const settings = await settingsStore().status();
      void executionCoordinator
        .startLocal(ref, settings.comfyUiApiEndpoint, () => localExecutor().start(root, run.runId))
        .finally(maybeQuitAfterExecution);
      return;
    }
    const provider = run.remote?.provider,
      instanceId = Number(run.remote?.instanceId);
    if (provider !== 'vastai' || !Number.isInteger(instanceId) || instanceId < 1)
      throw new Error('Remote Execution Run has no valid Vast.ai Instance.');
    void executionCoordinator
      .startRemote(ref, provider, instanceId, () => prepareRemoteExecution(root, run.runId))
      .finally(maybeQuitAfterExecution);
  } catch (error) {
    await mutateExecutionRun(root, run.runId, (current) => {
      const failure = {
        code: 'EXECUTION_RESOURCE_BUSY',
        message: safeExecutionError(error),
        phase: current.phase,
        at: new Date().toISOString(),
        retryable: true,
      };
      current.error = failure;
      current.errorHistory.push(failure);
      current.lifecycle = 'FAILED';
      current.controls.scheduling = 'STOPPED';
    });
    throw error;
  }
}
async function resolveVastSshEndpoint(instanceId: number): Promise<VastAiSshEndpoint> {
  const instance = await vastClient().getInstance(instanceId),
    settings = await vastStore().status(),
    appSettings = await settingsStore().status();
  if (instance.status !== 'running')
    throw new Error(`Vast.ai Instance ${instanceId} はrunningではありません。`);
  if (!instance.sshHost || !instance.sshPort)
    throw new Error(`Vast.ai Instance ${instanceId} の公開SSH接続先を取得できません。`);
  if (!instance.comfyUiPort)
    throw new Error(
      `Vast.ai Instance ${instanceId} のComfyUI Portをportsから解決できません。18188/tcp または 8188/tcp の公開設定を確認してください。`,
    );
  if (!settings.sshPrivateKeyPath || !settings.sshPrivateKeyExists)
    throw new Error('Vast.ai連携設定でSSH秘密鍵を指定してください。');
  if (!settings.sshPublicKeyPath || !settings.sshPublicKeyExists)
    throw new Error('Vast.ai連携設定でSSH公開鍵を指定してください。');
  if (!appSettings.remoteComfyUiInstallPath)
    throw new Error('環境設定でRemote ComfyUIのインストール先ディレクトリを指定してください。');
  const pair = await validateSshKeyPair(settings.sshPrivateKeyPath, settings.sshPublicKeyPath);
  await vastClient().ensureSshAccess(instanceId, pair.publicKey);
  return {
    provider: 'vastai',
    instanceId,
    host: instance.sshHost,
    port: instance.sshPort,
    user: settings.sshUser,
    privateKeyPath: settings.sshPrivateKeyPath,
    publicKeyPath: settings.sshPublicKeyPath,
    comfyUiDirectory: appSettings.remoteComfyUiInstallPath,
    comfyUiPort: instance.comfyUiPort,
  };
}

function ensureCatalogRuntimePath() {
  if (!(process.env.BATCH_STUDIO_CATALOG_PATH ?? '').trim())
    process.env.BATCH_STUDIO_CATALOG_PATH = catalogService().catalogPath;
}
async function reloadCivitaiCatalog() {
  const next = new CivitaiCatalogService(path.join(app.getPath('userData'), 'civitai'));
  await next.initialize();
  civitaiCatalog = next;
  ensureCatalogRuntimePath();
  return next;
}
function integratedCatalogStatus(): CivitaiCatalogStatus {
  const status = catalogService().status(),
    rate = civitaiPolicy?.status();
  if (status.state === 'running' && rate?.waiting)
    return {
      ...status,
      phase: 'レート制限待機中',
      message: `Civitaiのレート制限を検知しました。約${rate.retryAfterSeconds}秒後に自動再開します。`,
      error: null,
    };
  return status;
}
async function scanWithCatalog(root: string) {
  return scanProject(root);
}
function assistantContextFor(state: ProjectWindowState): AssistantPaneContext {
  if (!state.assistantContext) throw new Error('AI工程が選択されていません。');
  return state.assistantContext;
}

function setAssistantContext(
  state: ProjectWindowState,
  root: string,
  stage: GrokContextStage,
): AssistantPaneContext {
  const context: AssistantPaneContext = {
    root: path.resolve(root),
    stage,
    provider: state.paneProvider,
  };
  state.assistantContext = context;
  state.assistantView.webContents.send(IPC.ASSISTANT_CONTEXT_CHANGED, context);
  return context;
}

async function assistantSnapshot(state: ProjectWindowState): Promise<AssistantPaneSnapshot> {
  const context = state.assistantContext;
  if (!context)
    return {
      context: null,
      availability: null,
      capabilities: null,
      sessionIds: [],
      activeSessionId: null,
      messages: [],
      modelSettings: null,
      busy: false,
    };
  if (!agentSessionState || !agentConversationStore || !agentConversationRunner)
    throw new Error('共通AI runtimeが初期化されていません。');

  const adapter = assistantAdapter(context.provider);
  const sessions = await agentSessionState.get(context.root, context.stage, context.provider);
  const [availability, messages] = await Promise.all([
    adapter.checkAvailability(),
    agentConversationStore.messages(
      context.root,
      context.stage,
      context.provider,
      sessions.activeSessionId,
    ),
  ]);
  let modelSettings: AgentModelSettings | null = null;
  if (availability.state === 'available' && adapter.capabilities.modelSelection) {
    try {
      modelSettings = await assistantModelSettings(context.root, context.stage, context.provider);
    } catch {
      modelSettings = null;
    }
  }
  return {
    context: { ...context },
    availability,
    capabilities: { ...adapter.capabilities },
    sessionIds: sessions.sessionIds,
    activeSessionId: sessions.activeSessionId,
    messages,
    modelSettings,
    busy: agentConversationRunner.isBusy(context.root, context.stage, context.provider),
  };
}

function notifyAgentEvent(
  provider: AgentProvider,
  context: { root: string; stage: GrokContextStage },
  taskStage: GrokTask['stage'],
  event: AgentEvent,
) {
  const envelope = { provider, root: context.root, stage: context.stage, taskStage, event };
  for (const state of projectWindows.values()) {
    if (!state.projectRoot || projectRootKey(state.projectRoot) !== projectRootKey(context.root))
      continue;
    state.localView.webContents.send(IPC.AGENT_EVENT, envelope);
    if (
      state.assistantContext &&
      state.assistantContext.provider === provider &&
      projectRootKey(state.assistantContext.root) === projectRootKey(context.root) &&
      state.assistantContext.stage === context.stage
    )
      state.assistantView.webContents.send(IPC.AGENT_EVENT, envelope);
  }
}
function assistantAdapter(provider: AgentProvider): AgentCliAdapter {
  const adapter = provider === 'codex' ? codexCliAdapter : grokCliAdapter;
  if (!adapter) throw new Error(`${provider} CLIが初期化されていません。`);
  return adapter;
}

async function assistantModelSettings(
  root: string,
  stage: GrokContextStage,
  provider: AgentProvider,
): Promise<AgentModelSettings> {
  if (!agentModelSelections) throw new Error('AIモデル設定が初期化されていません。');
  const adapter = assistantAdapter(provider);
  if (!adapter.getModels) return { models: [], selection: { model: null } };
  const available = await adapter.getModels();
  const saved = await agentModelSelections.get(root, stage, provider);
  const requested = available.models.find((model) => model.id === saved?.model);
  const fallback =
    available.models.find((model) => model.id === available.selection.model) ?? available.models[0];
  const model = requested ?? fallback;
  const requestedEffort = saved?.reasoningEffort;
  const supported = model?.supportedReasoningEfforts;
  const defaultEffort =
    model?.id === available.selection.model
      ? available.selection.reasoningEffort
      : (supported?.[0] ?? available.selection.reasoningEffort);
  const reasoningEffort =
    requestedEffort && (!supported?.length || supported.includes(requestedEffort))
      ? requestedEffort
      : defaultEffort;
  return {
    models: available.models,
    selection: {
      model: model?.id ?? null,
      ...(reasoningEffort != null ? { reasoningEffort } : {}),
    },
  };
}

async function assistantChooseModel(
  root: string,
  stage: GrokContextStage,
  provider: AgentProvider,
  selection: unknown,
): Promise<AgentModelSelection> {
  if (
    !selection ||
    typeof selection !== 'object' ||
    !('model' in selection) ||
    ((selection as AgentModelSelection).model !== null &&
      typeof (selection as AgentModelSelection).model !== 'string')
  )
    throw new Error('AIモデルを選択してください。');
  const requested = selection as AgentModelSelection;
  const settings = await assistantModelSettings(root, stage, provider);
  const model = settings.models.find((item) => item.id === requested.model);
  if (requested.model && !model) throw new Error('選択したモデルは利用できません。');
  if (
    requested.reasoningEffort &&
    model?.supportedReasoningEfforts?.length &&
    !model.supportedReasoningEfforts.includes(requested.reasoningEffort)
  )
    throw new Error('選択した推論強度はこのモデルで利用できません。');

  const normalized: AgentModelSelection = {
    model: requested.model,
    ...(requested.reasoningEffort != null ? { reasoningEffort: requested.reasoningEffort } : {}),
  };
  if (!agentModelSelections) throw new Error('AIモデル設定が初期化されていません。');
  await agentModelSelections.remember(root, stage, provider, normalized);
  return normalized;
}

function notifyAutoArtifact(event: AutoArtifactEvent) {
  for (const state of projectWindows.values()) {
    if (state.projectRoot && projectRootKey(state.projectRoot) === projectRootKey(event.root)) {
      state.localView.webContents.send(IPC.AUTO_ARTIFACT_EVENT, event);
      state.assistantView.webContents.send(IPC.AUTO_ARTIFACT_EVENT, event);
    }
  }
}
const codexTaskContexts: Record<GrokContextStage, GrokTask['stage'][]> = {
  story: ['story-initial', 'story-finalize', 'story-fix'],
  models: ['models', 'models-fix'],
  'prompt-plan': ['prompt-plan', 'prompt-plan-fix', 'prompt-plan-patch'],
  caption: ['caption'],
};

function contextStageForTask(stage: GrokTask['stage']): GrokContextStage {
  for (const [contextStage, stages] of Object.entries(codexTaskContexts) as Array<
    [GrokContextStage, GrokTask['stage'][]]
  >) {
    if (stages.includes(stage)) return contextStage;
  }
  throw new Error('Invalid task stage.');
}
function validCivitaiUrl(value: unknown) {
  if (typeof value !== 'string') return false;
  try {
    const u = new URL(value),
      host = u.hostname.toLowerCase();
    return u.protocol === 'https:' && (host === 'civitai.com' || host.endsWith('.civitai.com'));
  } catch {
    return false;
  }
}
async function r2LookupFor(root: string) {
  const meta = await readProjectMeta(root),
    globalBucket = (process.env.BATCH_STUDIO_R2_BUCKET ?? '').trim(),
    globalPrefix = (process.env.BATCH_STUDIO_R2_MODEL_PREFIX ?? '').trim(),
    bucket = globalBucket || (meta?.settings.r2Bucket?.trim() ?? ''),
    prefix = (globalPrefix || (meta?.settings.r2ModelPrefix?.trim() ?? '')).replace(
      /^\/+|\/+$/g,
      '',
    );
  if (!bucket) return null;
  const status = await r2().settings();
  if (!status.configured && !status.secretConfigured) return null;
  await r2Index().sync();
  return async (fileName: string) =>
    Boolean(await r2Index().resolveModelKey(bucket, fileName, prefix));
}
async function remoteTargetIssuesFor(root: string): Promise<ValidationIssue[]> {
  const meta = await readProjectMeta(root),
    provider = meta?.settings.remoteProvider,
    instanceId = meta?.settings.remoteInstanceId;
  if (provider !== 'vastai' || !Number.isInteger(instanceId) || Number(instanceId) < 1)
    return [
      {
        severity: 'error',
        code: 'REMOTE_INSTANCE_REQUIRED',
        message: 'リモート実行にはVast.ai Instanceを選択してください。',
      },
    ];
  const issues: ValidationIssue[] = [],
    settings = await vastStore().status(),
    appSettings = await settingsStore().status();
  if (!appSettings.remoteComfyUiInstallPath)
    issues.push({
      severity: 'error',
      code: 'REMOTE_COMFYUI_INSTALL_PATH_REQUIRED',
      message:
        'リモート実行には環境設定でRemote ComfyUIのインストール先ディレクトリを指定してください。',
    });
  if (!appSettings.githubPatConfigured)
    issues.push({
      severity: 'error',
      code: 'REMOTE_GITHUB_PAT_REQUIRED',
      message:
        'リモート環境のComfyUI更新とcustom_nodes同期に使用するGitHub PATを環境設定または BATCH_STUDIO_GITHUB_PAT / GH_TOKEN で設定してください。',
    });
  if (!settings.configured)
    issues.push({
      severity: 'error',
      code: 'VASTAI_NOT_CONFIGURED',
      message: 'サービス連携でVast.ai API Keyを設定してください。',
    });
  if (!settings.sshPrivateKeyPath)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_KEY_REQUIRED',
      message: 'サービス連携でVast.ai用SSH秘密鍵を指定してください。',
    });
  else if (!settings.sshPrivateKeyExists)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_KEY_MISSING',
      message: `Vast.ai用SSH秘密鍵が見つかりません: ${settings.sshPrivateKeyPath}`,
    });
  if (!settings.sshPublicKeyPath)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_PUBLIC_KEY_REQUIRED',
      message: 'サービス連携でVast.ai用SSH公開鍵を指定してください。',
    });
  else if (!settings.sshPublicKeyExists)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_PUBLIC_KEY_MISSING',
      message: `Vast.ai用SSH公開鍵が見つかりません: ${settings.sshPublicKeyPath}`,
    });
  else if (settings.sshPrivateKeyExists && !settings.sshKeyPairValid)
    issues.push({
      severity: 'error',
      code: 'VASTAI_SSH_KEY_PAIR_MISMATCH',
      message: '設定されたSSH秘密鍵とSSH公開鍵が同じキーペアではありません。',
    });
  if (!settings.configured) return issues;
  try {
    const instance = await vastClient().getInstance(Number(instanceId));
    if (instance.status === 'error' || instance.status === 'offline')
      issues.push({
        severity: 'error',
        code: 'VASTAI_INSTANCE_UNAVAILABLE',
        message: `Vast.ai Instance ${instance.id} は ${instance.status} 状態です。${instance.statusMessage ? ` ${instance.statusMessage}` : ''}`,
      });
    else if (instance.status === 'running' && (!instance.sshHost || !instance.sshPort))
      issues.push({
        severity: 'error',
        code: 'VASTAI_SSH_ENDPOINT_MISSING',
        message: `Vast.ai Instance ${instance.id} はrunningですが公開SSH接続先を取得できません。`,
      });
    else if (['starting', 'stopping', 'scheduling', 'unknown'].includes(instance.status))
      issues.push({
        severity: 'warning',
        code: 'VASTAI_INSTANCE_TRANSITIONING',
        message: `Vast.ai Instance ${instance.id} は現在 ${instance.status} 状態です。実行開始時に状態を再確認します。`,
      });
  } catch (error) {
    issues.push({
      severity: 'error',
      code: 'VASTAI_INSTANCE_LOOKUP_FAILED',
      message: `Vast.ai Instanceを確認できません: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return issues;
}

async function executionPreflight(root: string) {
  const settings = await settingsStore().status();
  return runPreflight(root, await r2LookupFor(root), settings.modelsPath, () =>
    remoteTargetIssuesFor(root),
  );
}

function createIpcRegistrationDependencies() {
  return {
    IPC,
    VastAiClient,
    VastAiInstanceNotFoundError,
    abandonExecutionRunForRemoteReplacement,
    agentConversationRunner,
    agentSessionState,
    app,
    assistantChooseModel,
    assistantContextFor,
    assistantModelSettings,
    assistantProviderState,
    assistantSnapshot,
    beginEditArtifact,
    catalogService,
    catalogStatus,
    checkAvailability,
    checkLoraFileAvailability,
    civitaiStore,
    clipboard,
    codexCliTaskRunner,
    codexTaskContexts,
    compileWorkflow,
    confirmArtifact,
    confirmRunStopBeforeLeave,
    contextStageForTask,
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
    exportCustomMarketplaceImage,
    exportThumbnail,
    finalizeRemoteInstance,
    focusProjectWindow,
    generateCaption,
    generateMarketplaceImages,
    generateMarketplaceZip,
    getCaptionStatus,
    getCurrentExecutionRunFast,
    getExecutionRun,
    getFinalArtifactStatus,
    getMarketplaceImageTargets,
    grokCliTaskRunner,
    handleIpc,
    importCaptionGrok,
    importGrok,
    initializeCorruptMarketplaceImageState,
    initializeCorruptThumbnailState,
    inspectExecutionRunStorage,
    integratedCatalogStatus,
    isRemotePreGenerationPhase,
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
    marketplacePickerForSender,
    marketplacePickerWindows,
    maybeQuitAfterExecution,
    mkdir,
    mutateExecutionRun,
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
    setAssistantContext,
    setWindowProject,
    settingsStore,
    shell,
    startExecutionRun,
    startExecutionRuntime,
    stateStore,
    statusSnapshots,
    stopRunForExit,
    storeWebpThumbnailPreview,
    thumbnailPickerForSender,
    thumbnailPickerWindows,
    validCivitaiUrl,
    validGrokContextStage,
    validInstanceId,
    validManualResetScope,
    validRoot,
    validateMarketplacePickerImage,
    validateThumbnailPickerImage,
    vastClient,
    vastStore,
  };
}

export type IpcRegistrationDependencies = ReturnType<typeof createIpcRegistrationDependencies>;

function register() {
  registerIpc(createIpcRegistrationDependencies());
}

function maybeQuitAfterExecution() {
  if (
    process.platform !== 'darwin' &&
    projectWindows.size === 0 &&
    standaloneToolWindows.size === 0 &&
    !executionCoordinator.hasActiveRuns()
  )
    app.quit();
}

app.on('before-quit', (event) => {
  if (quitApproved) return;
  event.preventDefault();
  if (quitPromptOpen) return;
  quitPromptOpen = true;
  void (async () => {
    try {
      for (const state of projectWindows.values()) {
        if (
          state.projectRoot &&
          !(await confirmRunStopBeforeLeave(
            state.projectRoot,
            state.window,
            'アプリケーションを終了する',
          ))
        )
          return;
      }
      if (executionCoordinator.hasActiveRuns())
        throw new Error('実行中のWorkerが残っています。終了を中止しました。');
      quitApproved = true;
      app.quit();
    } catch (error) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'アプリケーションを終了できません',
        message: safeExecutionError(error),
      });
    } finally {
      quitPromptOpen = false;
    }
  })();
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
else
  app.on('second-instance', () => {
    if (!app.isReady()) return;
    const existing = lastFocusedProjectWindow();
    if (existing) focusProjectWindow(existing);
    else createProjectWindow({ restoreLastProject: true });
  });

async function initializeApplication() {
  const userData = app.getPath('userData');
  civitaiPolicy = new CivitaiRequestPolicy();
  civitaiPolicy.install();
  uiState = new UiStateStore(userData);
  appSettingsStore = new AppSettingsStore(userData);
  await appSettingsStore.initialize();
  civitaiConfig = new CivitaiConfigStore(userData);
  const apiKey = await civitaiConfig.apiKey();
  if (apiKey) process.env.CIVIT_API_KEY = apiKey;
  vastAiConfig = new VastAiConfigStore(userData);
  const vastKey = await vastAiConfig.apiKey();
  if (vastKey) process.env[VASTAI_ENVIRONMENT_VARIABLE] = vastKey;
  vastAiClient = new VastAiClient(() => vastStore().apiKey());
  remoteControlPlane = new RemoteControlPlane(
    new VerifiedSshClient(new SshHostKeyStore(userData), async (info) => {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'SSH Host Key の確認',
        message: `${info.host}:${info.port} のSSH Host Keyは未登録です。`,
        detail: `Fingerprint: ${info.fingerprint}\n\n接続先が正しいことを確認してから信頼してください。`,
        buttons: ['キャンセル', 'このHost Keyを信頼'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      });
      return result.response === 1;
    }),
    new RemoteWorkerClient(),
    resolveVastSshEndpoint,
  );
  civitaiCatalog = new CivitaiCatalogService(path.join(userData, 'civitai'));
  ensureCatalogRuntimePath();
  assistantProviderState = new AssistantProviderStore(userData);
  agentSessionState = new AgentSessionStateStore(userData);
  agentConversationStore = new AgentConversationStore(userData);
  agentModelSelections = new AgentModelSelectionStore(userData);
  codexCliAdapter = new CodexCliAdapter();
  grokCliAdapter = new GrokCliAdapter();
  grokCliTaskRunner = new GrokCliTaskRunner({
    userDataPath: userData,
    adapter: grokCliAdapter,
    sessions: agentSessionState,
    onEvent: (context, event) => notifyAgentEvent('grok', context, context.taskStage, event),
    onArtifact: notifyAutoArtifact,
    resolveModel: async (root, stage) =>
      (await assistantModelSettings(root, stage, 'grok')).selection,
  });
  codexCliTaskRunner = new CodexCliTaskRunner({
    userDataPath: userData,
    adapter: codexCliAdapter,
    sessions: agentSessionState,
    onEvent: (context, event) => notifyAgentEvent('codex', context, context.taskStage, event),
    onArtifact: notifyAutoArtifact,
    resolveModel: async (root, stage) =>
      (await assistantModelSettings(root, stage, 'codex')).selection,
  });
  agentConversationRunner = new AgentConversationRunner({
    userDataPath: userData,
    sessions: agentSessionState,
    conversations: agentConversationStore,
    adapter: assistantAdapter,
    model: async (root, stage, provider) =>
      (await assistantModelSettings(root, stage, provider)).selection,
    onEvent: notifyAgentEvent,
  });
  const r2Config = new R2ConfigStore(userData);
  r2Manager = new R2Manager(r2Config, userData);
  r2ObjectIndex = new R2ObjectIndex(r2Config, userData);
  remoteEnvironmentBootstrap = new RemoteEnvironmentBootstrap(remoteExecutor());
  remoteModelStager = new RemoteModelStager(r2Manager, remoteExecutor());
  void r2ObjectIndex.sync().catch((error) => console.warn('Initial R2 index sync skipped:', error));
  await civitaiCatalog.initialize();
  const initial = civitaiCatalog.status();
  if (initial.state === 'idle' && initial.apiKeyConfigured) void civitaiCatalog.startSync();
  register();
  await refreshRecentProjectMenu();
  createProjectWindow({ restoreLastProject: true });
  app.on('activate', () => {
    const existing = lastFocusedProjectWindow();
    if (existing) focusProjectWindow(existing);
    else createProjectWindow({ restoreLastProject: true });
  });
}
if (hasSingleInstanceLock) void app.whenReady().then(initializeApplication);
app.on('will-quit', () => {
  void codexCliAdapter?.shutdown().catch(() => {});
  void grokCliTaskRunner?.shutdown().catch(() => {});
  void agentConversationRunner?.shutdown().catch(() => {});
});
app.on('window-all-closed', () => {
  if (!executionCoordinator.hasActiveRuns() && process.platform !== 'darwin') app.quit();
});
