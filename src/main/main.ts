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
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { IPC } from '../shared/ipc.js';
import type {
  AppSettingsSaveInput,
  CatalogSelectionTemplateInput,
  CivitaiCatalogStatus,
  CivitaiConnectionInput,
  GrokContextStage,
  GrokPaneState,
  ExecutionRun,
  ProjectBriefInput,
  ProjectSettings,
  PromptPlanArtifact,
  GrokTask,
  AssistantPaneProvider,
  CodexContext,
  CodexMessage,
  CodexSnapshot,
  CodexAccountStatus,
  AutoArtifactEvent,
  CodexSendResult,
  CodexTurnStatus,
  CodexModelOption,
  CodexModelSelection,
  CodexModelSettings,
  ThumbnailSlotKey,
  MarketplaceSourceType,
  R2ConnectionInput,
  ValidationIssue,
  VastAiConnectionInput,
  VastAiOfferSearchInput,
  VastAiRentRequest,
  VastAiSshEndpoint,
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
import { artifactFileOutputRules, buildGrokTask } from './grok-context.js';
import { catalogStatus } from './model-catalog.js';
import { compileWorkflow } from './compiler.js';
import { checkAvailability, checkLoraFileAvailability } from './availability.js';
import { runPreflight } from './preflight.js';
import {
  abandonExecutionRunForRemoteReplacement,
  discardExecutionRun,
  getCurrentExecutionRun,
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
import {
  canonicalGrokConversationUrl,
  GROK_PARTITION,
  isGrokNavigationUrl,
  isOAuthPopupUrl,
  isSafeExternalUrl,
  isSecureWebUrl,
} from './grok-navigation.js';
import { GrokNavigationQueue, LatestGrokContextQueue } from './grok-navigation-queue.js';
import { CivitaiCatalogService } from './civitai-catalog.js';
import { CivitaiRequestPolicy } from './civitai-request-policy.js';
import { CivitaiConfigStore } from './civitai-config.js';
import { UiStateStore } from './ui-state.js';
import { GrokChatStateStore } from './grok-chat-state.js';
import { CodexChatStateStore } from './codex-chat-state.js';
import { codexTaskFileForTurn, latestCompletedArtifactTurn } from './codex-artifact-turn.js';
import { readCodexHistory } from './codex-thread-history.js';
import {
  prepareCodexFileWorkspace,
  workspaceOutputInstruction,
  readCodexOutput,
  rememberCodexWorkspace,
  findCodexWorkspace,
  type FileArtifactWorkspace,
} from './codex-file-artifact.js';
import { promptPlanPatchBase } from './prompt-plan-patch.js';
import {
  codexActivityFromHistory,
  emptyCodexActivity,
  safeCodexActivityEvent,
} from '../shared/codex-activity.js';
import { AssistantProviderStore } from './assistant-provider-state.js';
import { CodexAppServer, type CodexNotification } from './codex-app-server.js';
import { CodexTurnMonitor } from './codex-turn-monitor.js';
import {
  expectedArtifact,
  importAutoArtifact,
  latestAutoArtifact,
} from './agent-artifact-import.js';
import { GrokAutoArtifactWatcher } from './grok-auto-artifact-watcher.js';
import { CodexModelSelectionStore } from './codex-model-selection.js';
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
  type ThumbnailCacheTiming,
} from './thumbnail-image-cache.js';
import {
  logThumbnailPickerPerformance,
  pickerPerformanceLogPath,
  type PickerMetrics,
} from './thumbnail-picker-perf.js';

const __filename = fileURLToPath(import.meta.url),
  __dirname = path.dirname(__filename);
const GROK_URL = 'https://grok.com/';
const GROK_LOADING_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="dark" />
<style>
html,body{width:100%;height:100%;margin:0;background:#101318;color:#e8ebef;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
body{display:grid;place-items:center}
.loading{display:flex;flex-direction:column;align-items:center;gap:14px;text-align:center}
.spinner{width:30px;height:30px;border:3px solid #39414d;border-top-color:#3474ef;border-radius:50%;animation:spin .8s linear infinite}
.title{font-size:15px;font-weight:600}
.note{font-size:12px;color:#8993a2}
@keyframes spin{to{transform:rotate(360deg)}}
</style>
</head>
<body>
<div class="loading" role="status" aria-live="polite">
<div class="spinner" aria-hidden="true"></div>
<div class="title">Grokを読み込み中…</div>
<div class="note">読み込みが完了すると、このPaneにGrokが表示されます。</div>
</div>
</body>
</html>`;
type StandaloneWindowTool = 'r2' | 'civit' | 'vastai';
type RendererWindowTool =
  | StandaloneWindowTool
  | 'thumbnail-picker'
  | 'marketplace-picker'
  | 'codex-pane';
type StandaloneToolWindowState = { window: BaseWindow; view: WebContentsView };
type ThumbnailPickerWindowState = {
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
const approvedWindowCloses = new Set<number>();
const pendingWindowCloses = new Set<number>();
type ProjectWindowState = {
  window: BaseWindow;
  localView: WebContentsView;
  grokView: WebContentsView;
  codexView: WebContentsView;
  paneProvider: AssistantPaneProvider;
  assistantSelectionGeneration: number;
  codexContext: CodexContext | null;
  grokLoadingView: WebContentsView;
  projectRoot: string | null;
  restoreLastProject: boolean;
  grokVisible: boolean;
  grokLoading: boolean;
  grokLoadingGeneration: number;
  localRatio: number;
  activeGrokContext: { root: string; stage: GrokContextStage } | null;
  restoringGrokContext: boolean;
  grokArtifactWatcher: GrokAutoArtifactWatcher | null;
  grokNavigationQueue: GrokNavigationQueue;
  grokContextQueue: LatestGrokContextQueue<GrokPaneState>;
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
  grokChatState: GrokChatStateStore | null = null,
  codexChatState: CodexChatStateStore | null = null,
  assistantProviderState: AssistantProviderStore | null = null,
  codexAppServer: CodexAppServer | null = null,
  codexBusy = new Set<string>(),
  codexTurnStartRequests = new Map<string, Promise<string>>(),
  codexActiveTurnIds = new Map<string, string>(),
  codexInterruptRequests = new Map<string, Promise<void>>(),
  codexPendingArtifacts = new Map<
    string,
    { root: string; stage: GrokTask['stage']; fileName: string; workspace?: FileArtifactWorkspace }
  >(),
  codexTurnMonitor = new CodexTurnMonitor(),
  codexModelSelections: CodexModelSelectionStore | null = null,
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
function paneState(state: ProjectWindowState): GrokPaneState {
  return { visible: state.grokVisible, ratio: state.localRatio };
}
function layoutProjectWindow(state: ProjectWindowState) {
  const { width, height } = state.window.getContentBounds();
  if (!state.grokVisible || width < 840) {
    state.localView.setBounds({ x: 0, y: 0, width, height });
    state.grokView.setBounds({ x: width, y: 0, width: 0, height });
    state.grokLoadingView.setBounds({ x: width, y: 0, width: 0, height });
    state.codexView.setBounds({ x: width, y: 0, width: 0, height });
    return;
  }
  const lw = Math.max(420, Math.min(width - 420, Math.round(width * state.localRatio))),
    grokBounds = { x: lw, y: 0, width: width - lw, height };
  state.localView.setBounds({ x: 0, y: 0, width: lw, height });
  const hidden = { x: width, y: 0, width: 0, height };
  state.grokView.setBounds(state.paneProvider === 'grok' ? grokBounds : hidden);
  state.grokLoadingView.setBounds(
    state.paneProvider === 'grok' && state.grokLoading ? grokBounds : hidden,
  );
  state.codexView.setBounds(state.paneProvider === 'codex' ? grokBounds : hidden);
}
function projectWindowForSender(contents: WebContents) {
  for (const state of projectWindows.values())
    if (
      state.localView.webContents.id === contents.id ||
      state.grokView.webContents.id === contents.id ||
      state.codexView.webContents.id === contents.id
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
  await rememberProjectAndRefreshMenu(resolved);
}
async function loadRenderer(v: WebContentsView, tool?: RendererWindowTool) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) {
    const url = new URL(dev);
    if (tool === 'codex-pane') url.searchParams.set('codex-pane', '1');
    else if (tool) url.searchParams.set('tool', tool);
    await v.webContents.loadURL(url.toString());
  } else
    await v.webContents.loadFile(
      path.resolve(__dirname, '../../dist-renderer/index.html'),
      tool === 'codex-pane'
        ? { query: { 'codex-pane': '1' } }
        : tool
          ? { query: { tool } }
          : undefined,
    );
}
function configureGrokContents(contents: WebContents, oauthFlow = false) {
  contents.setWindowOpenHandler(({ url }) => {
    const startsOAuth = isOAuthPopupUrl(url);
    if (startsOAuth || isGrokNavigationUrl(url) || (oauthFlow && isSecureWebUrl(url))) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 560,
          height: 760,
          autoHideMenuBar: true,
          webPreferences: {
            partition: GROK_PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (isSafeExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  contents.on('will-navigate', (e, url) => {
    const allow = oauthFlow ? isSecureWebUrl(url) : isGrokNavigationUrl(url);
    if (!allow) {
      e.preventDefault();
      if (isSafeExternalUrl(url)) void shell.openExternal(url);
    }
  });
  contents.on('did-create-window', (window, details) =>
    configureGrokContents(window.webContents, oauthFlow || isOAuthPopupUrl(details.url)),
  );
}
function chatStore() {
  if (!grokChatState) throw new Error('Grok chat state storeが初期化されていません。');
  return grokChatState;
}
async function rememberGrokConversation(state: ProjectWindowState, url: string) {
  if (state.restoringGrokContext || !state.activeGrokContext) return;
  const canonical = canonicalGrokConversationUrl(url);
  if (!canonical) return;
  await chatStore().remember(
    state.activeGrokContext.root,
    state.activeGrokContext.stage,
    canonical,
  );
}
function attachGrokHistoryTracking(state: ProjectWindowState) {
  state.grokView.webContents.on('did-navigate', (_e, url) => {
    void rememberGrokConversation(state, url);
  });
  state.grokView.webContents.on('did-navigate-in-page', (_e, url) => {
    void rememberGrokConversation(state, url);
  });
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
    codexView = new WebContentsView({
      webPreferences: {
        preload: path.resolve(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    grokView = new WebContentsView({
      webPreferences: {
        partition: GROK_PARTITION,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    grokLoadingView = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    }),
    state: ProjectWindowState = {
      window,
      localView,
      grokView,
      codexView,
      paneProvider: 'grok',
      assistantSelectionGeneration: 0,
      codexContext: null,
      grokLoadingView,
      projectRoot: options.initialProjectRoot ? path.resolve(options.initialProjectRoot) : null,
      restoreLastProject: Boolean(options.restoreLastProject),
      grokVisible: false,
      grokLoading: false,
      grokLoadingGeneration: 0,
      localRatio: 0.45,
      activeGrokContext: null,
      restoringGrokContext: false,
      grokArtifactWatcher: null,
      grokNavigationQueue: new GrokNavigationQueue(),
      grokContextQueue: new LatestGrokContextQueue<GrokPaneState>(),
      lastFocusedAt: ++projectWindowFocusSequence,
    };
  const windowId = window.id;
  projectWindows.set(windowId, state);
  lastFocusedProjectWindowId = windowId;
  window.contentView.addChildView(localView);
  window.contentView.addChildView(grokView);
  window.contentView.addChildView(grokLoadingView);
  window.contentView.addChildView(codexView);
  void grokLoadingView.webContents
    .loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(GROK_LOADING_HTML)}`)
    .catch((error) => console.warn('Grok loading placeholder failed:', error));
  configureGrokContents(grokView.webContents);
  attachGrokHistoryTracking(state);
  state.grokArtifactWatcher = new GrokAutoArtifactWatcher(grokView.webContents, notifyAutoArtifact);
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
    state.grokArtifactWatcher?.dispose();
    localView.webContents.close();
    grokView.webContents.close();
    grokLoadingView.webContents.close();
    codexView.webContents.close();
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
  void loadRenderer(codexView, 'codex-pane');
  void state.grokNavigationQueue
    .navigate(grokView.webContents, GROK_URL)
    .catch((error) => console.warn('Initial Grok navigation failed:', error));
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
  window.removeMenu();
  window.setMenuBarVisibility(false);
  window.contentView.addChildView(view);
  const resize = () => {
    const { width, height } = window.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  };
  window.on('resize', resize);
  window.on('closed', () => {
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

async function confirmRunStopBeforeLeave(root: string, owner: BaseWindow, action: string) {
  const key = path.resolve(root);
  const pending = exitChecks.get(key);
  if (pending) return pending;
  const task = (async () => {
    await reconcilePersistedExecutionRuns(root);
    if (!(await runRequiresExitGuard(root))) return true;
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
    return true;
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
async function setGrokContext(state: ProjectWindowState, root: string, stage: GrokContextStage) {
  validRoot(root);
  validGrokContextStage(stage);
  const resolvedRoot = path.resolve(root),
    key = `${resolvedRoot}\0${stage}`,
    loadingGeneration = ++state.grokLoadingGeneration;
  state.grokLoading = true;
  layoutProjectWindow(state);
  try {
    return await state.grokContextQueue.run(key, async (isLatest) => {
      if (!isLatest()) return paneState(state);
      if (state.activeGrokContext) {
        const current = canonicalGrokConversationUrl(state.grokView.webContents.getURL());
        if (current)
          await chatStore().remember(
            state.activeGrokContext.root,
            state.activeGrokContext.stage,
            current,
          );
      }
      if (!isLatest()) return paneState(state);
      state.activeGrokContext = { root: resolvedRoot, stage };
      const saved = await chatStore().get(resolvedRoot, stage);
      if (!isLatest()) return paneState(state);
      const target = saved ?? GROK_URL,
        current = state.grokView.webContents.getURL(),
        currentCanonical = canonicalGrokConversationUrl(current);
      const alreadyThere = saved ? currentCanonical === saved : current === GROK_URL;
      if (!alreadyThere) {
        state.restoringGrokContext = true;
        try {
          await state.grokNavigationQueue.navigate(state.grokView.webContents, target);
        } finally {
          state.restoringGrokContext = false;
        }
      }
      return paneState(state);
    });
  } finally {
    if (loadingGeneration === state.grokLoadingGeneration) {
      state.grokLoading = false;
      layoutProjectWindow(state);
    }
  }
}
function codexService() {
  if (!codexAppServer || !codexChatState) throw new Error('Codexが初期化されていません。');
  return { server: codexAppServer, store: codexChatState };
}
function codexContextFor(state: ProjectWindowState): CodexContext {
  const context = state.codexContext;
  if (
    !context ||
    !state.projectRoot ||
    projectRootKey(context.root) !== projectRootKey(state.projectRoot)
  )
    throw new Error('Codexを利用するプロジェクトと工程を選択してください。');
  return context;
}
function forwardCodexNotification(notification: CodexNotification) {
  const threadId = notification.params.threadId;
  const status =
    typeof threadId === 'string' ? codexTurnMonitor.notification(threadId, notification) : null;
  if (notification.method === 'turn/started' && typeof threadId === 'string') {
    const turn = notification.params.turn as Record<string, unknown> | undefined;
    const turnId = typeof turn?.id === 'string' ? turn.id : notification.params.turnId;
    if (typeof turnId === 'string' && codexBusy.has(threadId))
      codexActiveTurnIds.set(threadId, turnId);
  }
  if (notification.method === 'turn/completed' && typeof threadId === 'string') {
    codexBusy.delete(threadId);
    codexActiveTurnIds.delete(threadId);
  }
  for (const state of projectWindows.values()) {
    const context = state.codexContext;
    if (!context) continue;
    // Account notifications are global; turn notifications belong only to the active stage thread.
    if (!notification.method.startsWith('account/')) {
      if (typeof threadId !== 'string' || threadId !== stateCodexActiveThread.get(state.window.id))
        continue;
    }
    // Never forward raw item objects, raw reasoning or artifact answer deltas.
    // Only an allowlisted, length-bounded progress projection reaches the renderer.
    const isSafeMessageDelta =
      notification.method === 'item/agentMessage/delta' &&
      !codexPendingArtifacts.has(threadId as string);
    // Forward only the fields consumed by the UI, never full Turn/Item objects.
    if (notification.method.startsWith('account/'))
      state.codexView.webContents.send(IPC.CODEX_EVENT, {
        method: notification.method,
        params: {},
      });
    if (notification.method === 'turn/started' || notification.method === 'turn/completed') {
      const turn = notification.params.turn as Record<string, unknown> | undefined;
      state.codexView.webContents.send(IPC.CODEX_EVENT, {
        method: notification.method,
        params: {
          threadId,
          turn: { id: turn?.id, status: turn?.status },
        },
      });
    }
    if (isSafeMessageDelta)
      state.codexView.webContents.send(IPC.CODEX_EVENT, {
        method: notification.method,
        params: {
          threadId,
          delta: notification.params.delta,
        },
      });
    const activity = safeCodexActivityEvent(notification.method, notification.params);
    if (activity)
      state.codexView.webContents.send(IPC.CODEX_EVENT, {
        method: 'batch-studio/activity',
        params: { threadId, activity },
      });
    if (status)
      state.codexView.webContents.send(IPC.CODEX_EVENT, {
        method: 'batch-studio/turn-status',
        params: { threadId, status },
      });
  }
  if (notification.method === 'turn/completed' && typeof threadId === 'string') {
    const pending = codexPendingArtifacts.get(threadId);
    if (pending) {
      codexPendingArtifacts.delete(threadId);
      void collectCodexArtifact(threadId, pending, notification.params);
    }
  }
}
const stateCodexActiveThread = new Map<number, string | null>();
function messageText(item: Record<string, unknown>): string {
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return '';
  return item.content
    .filter(
      (content): content is { text: string } =>
        typeof content === 'object' &&
        content !== null &&
        typeof (content as { text?: unknown }).text === 'string',
    )
    .map((content) => content.text)
    .join('\n');
}
function codexMessages(result: unknown): CodexMessage[] {
  const thread = (result as { thread?: { turns?: unknown[] } } | null)?.thread;
  if (!Array.isArray(thread?.turns)) return [];
  const messages: CodexMessage[] = [];
  for (const turn of thread.turns) {
    const artifactFile = codexTaskFileForTurn(turn);
    const items = (turn as { items?: unknown[] } | null)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const role =
        record.type === 'userMessage'
          ? 'user'
          : record.type === 'agentMessage'
            ? 'assistant'
            : null;
      const text = messageText(record);
      if (role && text)
        messages.push({
          id: String(record.id ?? messages.length),
          role,
          text: artifactFile
            ? role === 'user'
              ? `工程用の依頼を送信（${artifactFile}）`
              : `${artifactFile} の取り込み結果は下に表示します。JSON本文は表示しません。`
            : text,
        });
    }
  }
  return messages;
}
function codexTurnStatus(threadId: string | null): CodexTurnStatus {
  return threadId
    ? (codexTurnMonitor.get(threadId) ?? {
        phase: 'unknown',
        startedAt: null,
        updatedAt: null,
        finishedAt: null,
        error: null,
      })
    : { phase: 'idle', startedAt: null, updatedAt: null, finishedAt: null, error: null };
}
async function codexArtifactFor(
  context: CodexContext,
  threadId: string | null,
  lastTurnId?: string,
): Promise<AutoArtifactEvent | null> {
  if (!threadId) return null;
  const pending = codexPendingArtifacts.get(threadId);
  if (pending && projectRootKey(pending.root) === projectRootKey(context.root))
    return {
      provider: 'codex',
      root: pending.root,
      stage: pending.stage,
      fileName: pending.fileName,
      sourceId: threadId,
      phase: 'waiting',
    };
  return lastTurnId
    ? latestAutoArtifact(context.root, 'codex', context.stage, threadId + '/' + lastTurnId)
    : null;
}
async function codexSnapshot(state: ProjectWindowState): Promise<CodexSnapshot> {
  const context = codexContextFor(state);
  const { server, store } = codexService();
  const saved = await store.get(context.root, context.stage);
  const artifact = await codexArtifactFor(context, saved.activeThreadId);
  stateCodexActiveThread.set(state.window.id, saved.activeThreadId);
  if (!saved.activeThreadId)
    return {
      ...context,
      ...saved,
      messages: [],
      activity: emptyCodexActivity(),
      busy: false,
      status: codexTurnStatus(null),
      artifact,
    };

  // A thread/start ID exists before its first rollout is persisted. Reading or
  // resuming it while the first turn is running fails with "no rollout found".
  const busy = codexBusy.has(saved.activeThreadId);
  if (busy)
    return {
      ...context,
      ...saved,
      messages: [],
      activity: emptyCodexActivity(),
      busy: true,
      status: codexTurnStatus(saved.activeThreadId),
      artifact,
    };
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      // Reading history must never resume a thread; resume belongs to send only.
      const read = await readCodexHistory(
        (method, params) => server.request(method, params),
        saved.activeThreadId,
      );
      const turns = (read as { thread?: { turns?: Array<{ id?: unknown }> } } | null)?.thread
        ?.turns;
      const lastTurn = turns?.at(-1);
      const lastTurnId = typeof lastTurn?.id === 'string' ? lastTurn.id : null;
      return {
        ...context,
        ...saved,
        messages: codexMessages(read),
        activity: codexActivityFromHistory(read),
        busy: false,
        status: codexTurnMonitor.fromRead(saved.activeThreadId, read),
        artifact:
          lastTurnId && codexTaskFileForTurn(lastTurn)
            ? await codexArtifactFor(context, saved.activeThreadId, lastTurnId)
            : null,
      };
    } catch (error) {
      if (!(error instanceof Error) || !/no rollout found for thread id/i.test(error.message))
        throw error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        continue;
      }
      // Do not delete a possibly recoverable conversation ID. The user can
      // retry restoration or explicitly start a new chat.
      return {
        ...context,
        ...saved,
        messages: [],
        activity: emptyCodexActivity(),
        busy: false,
        historyUnavailable: true,
        status: codexTurnStatus(saved.activeThreadId),
        artifact,
      };
    }
  }
  throw new Error('Unexpected Codex snapshot state.');
}

async function codexAccount(): Promise<CodexAccountStatus> {
  const { server } = codexService();
  const result = await server.request<{
    account?: { type?: string; planType?: string } | null;
  }>('account/read', {});
  return {
    authenticated: result.account?.type === 'chatgpt',
    authMode: result.account?.type ?? null,
    planType: result.account?.planType ?? null,
  };
}
async function codexAvailableModels(): Promise<CodexModelOption[]> {
  const { server } = codexService();
  const models: CodexModelOption[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page++) {
    const response: {
      data?: Array<{
        id?: unknown;
        model?: unknown;
        displayName?: unknown;
        hidden?: unknown;
        isDefault?: unknown;
        defaultReasoningEffort?: unknown;
        supportedReasoningEfforts?: Array<{
          reasoningEffort?: unknown;
          description?: unknown;
        }>;
      }>;
      nextCursor?: string | null;
    } = await server.request('model/list', { limit: 100, includeHidden: false, cursor });
    if (!Array.isArray(response.data)) throw new Error('Codexからモデル一覧を取得できません。');
    for (const item of response.data) {
      const id =
        typeof item.model === 'string' && item.model
          ? item.model
          : typeof item.id === 'string'
            ? item.id
            : '';
      const efforts = Array.isArray(item.supportedReasoningEfforts)
        ? item.supportedReasoningEfforts
            .filter(
              (effort) => typeof effort.reasoningEffort === 'string' && effort.reasoningEffort,
            )
            .map((effort) => ({
              reasoningEffort: effort.reasoningEffort as string,
              description: typeof effort.description === 'string' ? effort.description : '',
            }))
        : [];
      if (
        !id ||
        item.hidden === true ||
        efforts.length === 0 ||
        models.some((model) => model.id === id)
      )
        continue;
      const defaultEffort =
        typeof item.defaultReasoningEffort === 'string' &&
        efforts.some((effort) => effort.reasoningEffort === item.defaultReasoningEffort)
          ? item.defaultReasoningEffort
          : efforts[0].reasoningEffort;
      models.push({
        id,
        displayName: typeof item.displayName === 'string' ? item.displayName : id,
        isDefault: item.isDefault === true,
        defaultReasoningEffort: defaultEffort,
        supportedReasoningEfforts: efforts,
      });
    }
    if (!response.nextCursor) break;
    if (response.nextCursor === cursor)
      throw new Error('Codexのモデル一覧のページ送りに失敗しました。');
    cursor = response.nextCursor;
    if (page === 9) throw new Error('Codexのモデル一覧が多すぎます。');
  }
  if (!models.length) throw new Error('Codexで使用できるモデルが見つかりません。');
  return models;
}
async function codexModelSettings(context: CodexContext): Promise<CodexModelSettings> {
  if (!codexModelSelections) throw new Error('Codexモデル設定が初期化されていません。');
  const [models, saved] = await Promise.all([
    codexAvailableModels(),
    codexModelSelections.get(context.root, context.stage),
  ]);
  const requested = models.find((model) => model.id === saved?.model);
  const model = requested ?? models.find((entry) => entry.isDefault) ?? models[0];
  const effort =
    requested &&
    model.supportedReasoningEfforts.some((item) => item.reasoningEffort === saved?.effort)
      ? saved!.effort
      : model.defaultReasoningEffort;
  return { models, selection: { model: model.id, effort } };
}
async function codexChooseModel(
  state: ProjectWindowState,
  selection: unknown,
): Promise<CodexModelSelection> {
  const context = codexContextFor(state);
  if (
    !selection ||
    typeof selection !== 'object' ||
    typeof (selection as CodexModelSelection).model !== 'string' ||
    typeof (selection as CodexModelSelection).effort !== 'string'
  )
    throw new Error('Codexモデルと推論強度を選択してください。');
  const requested = selection as CodexModelSelection;
  const saved = await codexService().store.get(context.root, context.stage);
  if (saved.activeThreadId && codexBusy.has(saved.activeThreadId))
    throw new Error('回答生成中はモデルと推論強度を変更できません。');
  const models = await codexAvailableModels();
  const model = models.find((item) => item.id === requested.model);
  if (
    !model ||
    !model.supportedReasoningEfforts.some((item) => item.reasoningEffort === requested.effort)
  )
    throw new Error('このモデルと推論強度の組み合わせはCodexで利用できません。');
  if (!codexModelSelections) throw new Error('Codexモデル設定が初期化されていません。');
  await codexModelSelections.remember(context.root, context.stage, requested);
  return requested;
}
async function codexSend(
  state: ProjectWindowState,
  message: string,
  artifactStage?: GrokTask['stage'],
  workspace?: FileArtifactWorkspace,
): Promise<CodexSendResult> {
  const context = codexContextFor(state);
  const input = message.trim();
  if (!input || input.length > 750_000) throw new Error('Codexへの依頼文が空、または長すぎます。');
  const account = await codexAccount();
  if (!account.authenticated)
    throw new Error(
      'ChatGPTアカウントでCodexにサインインしてください。APIキー認証では送信しません。',
    );
  const { server, store } = codexService();
  const settings = await codexModelSettings(context);
  const saved = await store.get(context.root, context.stage);
  let threadId = saved.activeThreadId;
  if (threadId && codexBusy.has(threadId)) throw new Error('このチャットは回答生成中です。');
  // All file-producing turns run in a disposable workspace, not the project.
  // Normal conversations remain read-only, including after a writable turn.
  const cwd = workspace?.directory ?? context.root;
  const sandbox = workspace ? 'workspace-write' : 'read-only';
  if (!threadId) {
    const started = await server.request<{ thread: { id: string } }>('thread/start', {
      cwd,
      approvalPolicy: 'never',
      sandbox,
      serviceName: 'comfyui_batch_studio',
      ephemeral: false,
    });
    threadId = started.thread.id;
    await store.remember(context.root, context.stage, threadId);
  } else {
    await server.request('thread/resume', {
      threadId,
      cwd,
      approvalPolicy: 'never',
      sandbox,
    });
  }
  if (codexBusy.has(threadId)) throw new Error('このチャットは回答生成中です。');
  stateCodexActiveThread.set(state.window.id, threadId);
  codexBusy.add(threadId);
  const artifactFile = artifactStage ? expectedArtifact(artifactStage) : null;
  if (artifactFile && artifactStage)
    codexPendingArtifacts.set(threadId, {
      root: context.root,
      stage: artifactStage,
      fileName: artifactFile,
      workspace,
    });
  codexTurnMonitor.sending(threadId);
  try {
    const turnStart = server.request<{ turn: { id: string } }>('turn/start', {
      threadId,
      input: [{ type: 'text', text: input, text_elements: [] }],
      ...(workspace
        ? {
            cwd,
            approvalPolicy: 'never',
            sandboxPolicy: {
              type: 'workspaceWrite',
              writableRoots: [cwd],
              networkAccess: false,
            },
          }
        : { cwd, sandboxPolicy: { type: 'readOnly', networkAccess: false } }),
      model: settings.selection.model,
      effort: settings.selection.effort,
      summary: 'auto',
    });
    const turnIdRequest = turnStart.then((result) => {
      if (typeof result?.turn?.id !== 'string') throw new Error('CodexターンIDを取得できません。');
      return result.turn.id;
    });
    codexTurnStartRequests.set(threadId, turnIdRequest);
    const turnId = await turnIdRequest;
    if (codexBusy.has(threadId)) codexActiveTurnIds.set(threadId, turnId);
    if (workspace && codexBusy.has(threadId))
      await rememberCodexWorkspace(context.root, workspace, threadId, turnId);
  } catch (error) {
    // A completed turn can race with turn/start returning. Do not replace its
    // terminal state with a send failure or discard an artifact after completion.
    if (codexBusy.has(threadId)) {
      codexBusy.delete(threadId);
      codexPendingArtifacts.delete(threadId);
      codexActiveTurnIds.delete(threadId);
      codexTurnMonitor.failedToSend(
        threadId,
        error instanceof Error ? error.message : String(error),
      );
    }
    throw error;
  } finally {
    codexTurnStartRequests.delete(threadId);
  }
  // Return metadata without reading a rollout that may not yet be persisted.
  return {
    ...(await store.get(context.root, context.stage)),
    status: codexTurnStatus(threadId),
    artifact:
      artifactFile && artifactStage
        ? {
            provider: 'codex',
            root: context.root,
            stage: artifactStage,
            fileName: artifactFile,
            sourceId: threadId,
            phase: 'waiting',
          }
        : null,
  };
}
async function codexStopTurn(state: ProjectWindowState): Promise<CodexSnapshot> {
  const context = codexContextFor(state);
  const { server, store } = codexService();
  const saved = await store.get(context.root, context.stage);
  const threadId = saved.activeThreadId;
  if (!threadId || !codexBusy.has(threadId)) return codexSnapshot(state);
  let interrupt = codexInterruptRequests.get(threadId);
  if (!interrupt) {
    interrupt = (async () => {
      // The stop button can be pressed before turn/start returns its turn ID.
      const turnId =
        codexActiveTurnIds.get(threadId) ?? (await codexTurnStartRequests.get(threadId));
      if (!turnId) throw new Error('中止対象のCodexターンを特定できません。');
      if (!codexBusy.has(threadId)) return;
      await server.request('turn/interrupt', { threadId, turnId });
    })();
    codexInterruptRequests.set(threadId, interrupt);
  }
  try {
    await interrupt;
  } finally {
    if (codexInterruptRequests.get(threadId) === interrupt) codexInterruptRequests.delete(threadId);
  }
  // Do not mark the turn interrupted locally. turn/completed provides the
  // authoritative terminal status and releases the busy lock.
  return codexSnapshot(state);
}
function notifyAutoArtifact(event: AutoArtifactEvent) {
  for (const state of projectWindows.values()) {
    if (state.projectRoot && projectRootKey(state.projectRoot) === projectRootKey(event.root)) {
      state.localView.webContents.send(IPC.AUTO_ARTIFACT_EVENT, event);
      state.codexView.webContents.send(IPC.AUTO_ARTIFACT_EVENT, event);
    }
  }
}
async function collectCodexArtifact(
  threadId: string,
  pending: {
    root: string;
    stage: GrokTask['stage'];
    fileName: string;
    workspace?: FileArtifactWorkspace;
  },
  params: Record<string, unknown>,
): Promise<AutoArtifactEvent | null> {
  const turn = params.turn as { status?: unknown; id?: unknown } | undefined;
  if (turn?.status !== 'completed') {
    const failed: AutoArtifactEvent = {
      provider: 'codex',
      root: pending.root,
      stage: pending.stage,
      fileName: pending.fileName,
      sourceId: threadId,
      phase: 'failed',
      message: 'Codexが正常終了していないため、成果物は取り込みません。',
    };
    notifyAutoArtifact(failed);
    return failed;
  }
  if (pending.workspace) {
    try {
      const raw = await readCodexOutput(pending.workspace);
      const turnId = typeof turn.id === 'string' ? turn.id : 'last';
      return await importAutoArtifact(
        pending.root,
        'codex',
        pending.stage,
        threadId + '/' + turnId,
        raw,
        notifyAutoArtifact,
      );
    } catch (error) {
      const failed: AutoArtifactEvent = {
        provider: 'codex',
        root: pending.root,
        stage: pending.stage,
        fileName: pending.fileName,
        sourceId: threadId,
        phase: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
      notifyAutoArtifact(failed);
      return failed;
    }
  }
  // Backward compatibility for artifact turns created before file-based output.
  const server = codexService().server;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const read = await readCodexHistory(
        (method, params) => server.request(method, params),
        threadId,
      );
      const turns = read.thread?.turns ?? [];
      const current =
        typeof turn.id === 'string'
          ? turns.find((candidate) => candidate.id === turn.id)
          : turns.at(-1);
      if (!current || codexTaskFileForTurn(current) !== pending.fileName)
        throw new Error('Codexの完了した依頼と成果物を対応付けられません。');
      const items = current.items ?? [];
      const reply = [...items]
        .reverse()
        .find((item) => (item as { type?: string } | null)?.type === 'agentMessage');
      const raw =
        reply && typeof reply === 'object' ? messageText(reply as Record<string, unknown>) : '';
      if (!raw.trim()) throw new Error('Codexの完成した成果物本文がありません。');
      const sourceId = threadId + '/' + String(current.id ?? 'last');
      return importAutoArtifact(
        pending.root,
        'codex',
        pending.stage,
        sourceId,
        raw,
        notifyAutoArtifact,
      );
    } catch (error) {
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
        continue;
      }
      const failed: AutoArtifactEvent = {
        provider: 'codex',
        root: pending.root,
        stage: pending.stage,
        fileName: pending.fileName,
        sourceId: threadId,
        phase: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
      notifyAutoArtifact(failed);
      return failed;
    }
  }
  return null;
}
const codexTaskContexts: Record<GrokContextStage, GrokTask['stage'][]> = {
  story: ['story-initial', 'story-finalize', 'story-fix'],
  models: ['models', 'models-fix'],
  'prompt-plan': ['prompt-plan', 'prompt-plan-fix', 'prompt-plan-patch'],
  caption: ['caption'],
};
const codexReturnFile: Record<GrokContextStage, string> = {
  story: 'story.md',
  models: 'model_loras.json',
  'prompt-plan': 'prompt_plan.json',
  caption: 'caption_content.json',
};
async function codexSendTask(
  state: ProjectWindowState,
  stage: GrokTask['stage'],
  extra: string,
): Promise<CodexSendResult> {
  const context = codexContextFor(state);
  if (!codexTaskContexts[context.stage].includes(stage))
    throw new Error('選択した工程に対応しない依頼です。');
  if (stage === 'prompt-plan-patch') {
    const baseline = await promptPlanPatchBase(context.root);
    const workspace = await prepareCodexFileWorkspace(app.getPath('userData'), stage, [
      { name: 'prompt_plan.json', content: await readFile(baseline.filePath, 'utf8') },
    ]);
    const patchPrompt = `## Task
あなたはComfyUI Batch StudioのPrompt Plan Schema v2を修正します。
これは相談や全文再生成ではなく、この会話で合意した変更を、現在の既存計画へ部分適用するための差分生成依頼です。
作業ディレクトリの input/1-prompt_plan.json を読み込み、該当Branch/Leafを実際に確認してください。入力ファイルは変更しません。
現在のファイル本文のSHA-256（UTF-8のバイト列）: ${baseline.baseSha256}
現在の計画: ${baseline.branches} Branch / ${baseline.leaves} Leaf。
この会話の修正対象以外のBranch/Leaf、ID、枚数、モデル設定、タグを絶対に変更しないでください。

## 差分JSON形式（厳守）
{
  "schemaVersion": 1,
  "baseSha256": "${baseline.baseSha256}",
  "operations": [
    {
      "scope": "branch",
      "branchId": "既存Branch ID（例: b19）",
      "path": "prompt.triggerWords",
      "before": [{"modelRef": "実際の既存ref", "words": ["修正前の値"]}],
      "after": [{"modelRef": "実際の既存ref", "words": ["修正後の値"]}]
    }
  ]
}
- 上記のbefore/afterは構造例であり、実際の元ファイルから対象配列の全要素を正確に転記してください。推測で記載しないでください。
- 操作対象は、commonならscope=commonでpath=triggerWords、positive.category、positive.camera.pov/angle/framing/gaze/focus、negative.category、Branch/Leafならscope=branch/leafでpathの先頭にprompt.を付けた同じ形式です。
- BranchにはbranchId、LeafにはbranchIdとleafIdを指定します。共通Scopeにはどちらも指定しません。
- beforeとafterはどちらも対象の配列全体を入れ、beforeは現在のファイル内容と完全一致させてください。変更対象外の要素は維持してください。
- この差分はBatch Studioが基準ハッシュとbeforeを照合して原子的に下書きへ適用し、計画全件を検証します。
- JSONは上記3つのroot fieldのみ、operationはscope/branchId/leafId/path/before/afterのみを使用してください。
- 同じscope・Branch・Leaf・pathへの変更は1操作に統合してください。操作数は100件以下です。
- 修正する既存配列が見つからない、または配列の全値を正確に読めない場合、差分を作成したと主張せず理由を示してください。
- 原本全体や修正案だけの会話は出力しません。次の出力契約に従い、差分JSONをファイルに書き込んでください。
${extra ? `\n## 追加の修正条件\n${extra}` : ''}`;
    return codexSend(
      state,
      patchPrompt + '\n\n' + workspaceOutputInstruction(workspace),
      stage,
      workspace,
    );
  }
  const task = await buildGrokTask(context.root, stage, extra);
  // Only replace provider-specific file instructions. The shared Schema v2
  // JSON example and all validation rules must reach both Grok and Codex.
  const prompt = task.prompt
    .replace(artifactFileOutputRules(codexReturnFile[context.stage]), '')
    .replaceAll('Grok', 'Codex');
  if (stage === 'story-initial')
    return codexSend(
      state,
      prompt +
        '\n\n## Codex向け出力契約\nこれは対話用の検討依頼です。成果物ファイルはまだ作成しません。',
      stage,
    );
  const references: Array<{ name: string; content: string }> = [];
  const referenceGuide: string[] = [];
  for (const attachment of task.attachments) {
    if (!attachment.exists) continue;
    const content = await readFile(attachment.path, 'utf8');
    const filename = (attachment.name.split(/[\\/]/).at(-1) ?? 'reference.txt').replace(
      /[^a-zA-Z0-9_.-]/g,
      '_',
    );
    references.push({ name: filename, content });
    referenceGuide.push('input/' + references.length + '-' + filename + ' — ' + attachment.purpose);
  }
  const workspace = await prepareCodexFileWorkspace(app.getPath('userData'), stage, references);
  return codexSend(
    state,
    prompt +
      (referenceGuide.length ? '\n\n## 参照ファイル\n' + referenceGuide.join('\n') : '') +
      '\n\n' +
      workspaceOutputInstruction(workspace),
    stage,
    workspace,
  );
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

function register() {
  ipcMain.handle(IPC.APP_SETTINGS_GET, () => settingsStore().status());
  ipcMain.handle(IPC.APP_SETTINGS_SELECT_COMFYUI, async () => {
    const r = await dialog.showOpenDialog({
      title: 'ComfyUIのインストール先ディレクトリを選択',
      properties: ['openDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle(IPC.APP_SETTINGS_SAVE, async (_e, input: AppSettingsSaveInput) => {
    const result = await settingsStore().save(input);
    ensureCatalogRuntimePath();
    return result;
  });
  ipcMain.handle(IPC.PROJECT_SELECT, async (event) => {
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
  ipcMain.handle(IPC.PROJECT_LAST, async (event) => {
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
      await rememberProjectAndRefreshMenu(state.projectRoot);
      return project;
    } catch {
      state.projectRoot = null;
      return null;
    }
  });
  ipcMain.handle(IPC.PROJECT_RECENT, async () => {
    const projects = [];
    for (const root of await stateStore().recentProjectPaths()) {
      try {
        projects.push(await scanWithCatalog(root));
      } catch {}
    }
    return projects;
  });
  ipcMain.handle(IPC.PROJECT_REMOVE_RECENT, async (_e, root: unknown) => {
    validRoot(root);
    await stateStore().removeRecentProject(root);
    await refreshRecentProjectMenu();
  });
  ipcMain.handle(IPC.PROJECT_OPEN, async (event, root: unknown) => {
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
  ipcMain.handle(IPC.PROJECT_CLOSE, async (event) => {
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
  ipcMain.handle(IPC.PROJECT_SELECT_PARENT, async (_event, defaultPath: unknown) => {
    const initialDirectory =
      typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath.trim() : undefined;
    const r = await dialog.showOpenDialog({
      title: '作成先フォルダーを選択',
      defaultPath: initialDirectory,
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle(IPC.PROJECT_CREATE, async (event, parent: unknown, brief: ProjectBriefInput) => {
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
  ipcMain.handle(IPC.PROJECT_SCAN, (_e, root: unknown) => {
    validRoot(root);
    return scanProject(root);
  });
  ipcMain.handle(IPC.PROJECT_OPEN_FOLDER, async (_e, root: unknown) => {
    validRoot(root);
    const err = await shell.openPath(root);
    if (err) throw new Error(err);
  });
  ipcMain.handle(
    IPC.PROJECT_SAVE_SETTINGS,
    async (_e, root: unknown, settings: ProjectSettings) => {
      validRoot(root);
      await ensureProjectWritable(root);
      await saveProjectSettings(root, settings);
      return scanProject(root);
    },
  );
  ipcMain.handle(IPC.PROJECT_SAVE_BRIEF, async (_e, root: unknown, brief: ProjectBriefInput) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await saveProjectBrief(root, brief);
    return scanProject(root);
  });
  ipcMain.handle(IPC.ARTIFACT_READ, (_e, root: unknown, key: any, source: any) => {
    validRoot(root);
    return readArtifact(root, key, source);
  });
  ipcMain.handle(IPC.ARTIFACT_BEGIN_EDIT, async (_e, root: unknown, key: any) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return beginEditArtifact(root, key);
  });
  ipcMain.handle(IPC.ARTIFACT_SAVE_DRAFT, async (_e, root: unknown, key: any, content: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof content !== 'string') throw new Error('Invalid content');
    return saveDraft(root, key, content);
  });
  ipcMain.handle(
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
  ipcMain.handle(IPC.ARTIFACT_CONFIRM, async (_e, root: unknown, key: any) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await confirmArtifact(root, key);
    return scanProject(root);
  });
  ipcMain.handle(IPC.ARTIFACT_GROK_LORA_HISTORY, (_e, root: unknown) => {
    validRoot(root);
    return readGrokLoraSelectionHistory(root);
  });
  ipcMain.handle(IPC.ARTIFACT_RESET_FROM, async (_e, root: unknown, scope: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    validManualResetScope(scope);
    await manualResetFrom(root, scope);
    return scanProject(root);
  });
  ipcMain.handle(IPC.PROMPT_PLAN_SAVE, async (_e, root: unknown, plan: PromptPlanArtifact) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return savePromptPlan(root, plan);
  });
  ipcMain.handle(IPC.AUTO_ARTIFACT_GROK_ARM, (event, root: unknown, stage: unknown) => {
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
  ipcMain.handle(
    IPC.GROK_TASK_BUILD,
    (_e, root: unknown, stage: GrokTask['stage'], extra: unknown) => {
      validRoot(root);
      return buildGrokTask(root, stage, typeof extra === 'string' ? extra : '');
    },
  );
  ipcMain.handle(IPC.FILE_SHOW_IN_FOLDER, (_e, filePath: unknown) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath))
      throw new Error('Invalid file path');
    shell.showItemInFolder(filePath);
  });
  ipcMain.handle(IPC.CATALOG_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return catalogStatus(root);
  });
  ipcMain.handle(IPC.CATALOG_INTEGRATED_STATUS, () => integratedCatalogStatus());
  ipcMain.handle(IPC.CATALOG_INTEGRATED_SNAPSHOT, () => catalogService().catalog());
  ipcMain.handle(IPC.CATALOG_INTEGRATED_SYNC, async () => {
    await catalogService().startSync();
    return integratedCatalogStatus();
  });
  ipcMain.handle(IPC.CATALOG_LINK_PROJECT, async (_e, root: unknown) => {
    validRoot(root);
    return scanProject(root);
  });
  ipcMain.handle(IPC.CATALOG_TEMPLATES, () => catalogService().templates());
  ipcMain.handle(IPC.CATALOG_SAVE_TEMPLATE, (_e, input: CatalogSelectionTemplateInput) =>
    catalogService().saveTemplate(input),
  );
  ipcMain.handle(IPC.CATALOG_DELETE_TEMPLATE, (_e, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid template id');
    return catalogService().deleteTemplate(id);
  });
  ipcMain.handle(IPC.CATALOG_OPEN_MODEL, async (_e, url: unknown) => {
    if (!validCivitaiUrl(url)) throw new Error('Civitai URLが不正です。');
    await shell.openExternal(url as string);
  });
  ipcMain.handle(IPC.CIVITAI_SETTINGS, () => civitaiStore().status());
  ipcMain.handle(IPC.CIVITAI_SAVE_SETTINGS, async (_e, input: CivitaiConnectionInput) => {
    const result = await civitaiStore().save(input);
    const service = await reloadCivitaiCatalog();
    const initial = service.status();
    if (initial.state === 'idle' && initial.apiKeyConfigured) void service.startSync();
    return result;
  });
  ipcMain.handle(IPC.VASTAI_SETTINGS, () => vastStore().status());
  ipcMain.handle(IPC.VASTAI_SAVE_SETTINGS, (_e, input: VastAiConnectionInput) =>
    vastStore().save(input),
  );
  ipcMain.handle(IPC.VASTAI_TEST, async (_e, input: VastAiConnectionInput | undefined) => {
    const override = typeof input?.apiKey === 'string' ? input.apiKey.trim() : '';
    if (override) {
      const client = new VastAiClient(async () => override);
      await client.testConnection();
      return;
    }
    await vastClient().testConnection();
  });
  ipcMain.handle(IPC.VASTAI_SELECT_PRIVATE_KEY, async () => {
    const r = await dialog.showOpenDialog({
      title: 'Vast.ai SSH秘密鍵を選択',
      properties: ['openFile'],
    });
    return r.canceled ? null : r.filePaths[0];
  });
  ipcMain.handle(IPC.VASTAI_SELECT_PUBLIC_KEY, async () => {
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
  ipcMain.handle(IPC.VASTAI_INSTANCES, () => vastClient().listInstances());
  ipcMain.handle(IPC.VASTAI_COMFYUI_TEMPLATE, () => vastClient().comfyUiTemplate());
  ipcMain.handle(IPC.VASTAI_SEARCH_OFFERS, (_e, input: VastAiOfferSearchInput) =>
    vastClient().searchOffers(input),
  );
  ipcMain.handle(IPC.VASTAI_RENT_OFFER, async (_e, input: VastAiRentRequest) => {
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
  ipcMain.handle(IPC.VASTAI_START_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestStartInstance(validInstanceId(id));
  });
  ipcMain.handle(IPC.VASTAI_STOP_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestStopInstance(validInstanceId(id));
  });
  ipcMain.handle(IPC.VASTAI_DESTROY_INSTANCE, async (_e, id: unknown) => {
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
  ipcMain.handle(IPC.VASTAI_REBOOT_INSTANCE, async (_e, id: unknown) => {
    await vastClient().requestRebootInstance(validInstanceId(id));
  });
  ipcMain.handle(
    IPC.VASTAI_RESOLVE_SSH,
    async (_e, id: unknown): Promise<VastAiSshEndpoint> =>
      resolveVastSshEndpoint(validInstanceId(id)),
  );
  ipcMain.handle(IPC.WORKFLOW_COMPILE, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return compileWorkflow(root);
  });
  ipcMain.handle(IPC.AVAILABILITY_CHECK, async (_e, root: unknown) => {
    validRoot(root);
    const settings = await settingsStore().status();
    return checkAvailability(root, await r2LookupFor(root), settings.modelsPath);
  });
  ipcMain.handle(
    IPC.AVAILABILITY_CHECK_LORA_FILES,
    async (_e, root: unknown, fileNames: unknown) => {
      validRoot(root);
      if (!Array.isArray(fileNames) || fileNames.some((x) => typeof x !== 'string'))
        throw new Error('Invalid LoRA file names');
      const settings = await settingsStore().status();
      return checkLoraFileAvailability(
        root,
        fileNames,
        await r2LookupFor(root),
        settings.modelsPath,
      );
    },
  );
  ipcMain.handle(IPC.AVAILABILITY_OPEN_R2, async () => {});
  ipcMain.handle(IPC.PREFLIGHT_RUN, async (_e, root: unknown) => {
    validRoot(root);
    return executionPreflight(root);
  });
  ipcMain.handle(IPC.EXECUTION_START, async (_e, root: unknown) => {
    validRoot(root);
    await reconcilePersistedExecutionRuns(root);
    const run = await startExecutionRun(root, () => executionPreflight(root));
    await startExecutionRuntime(root, run);
    return run;
  });
  ipcMain.handle(IPC.EXECUTION_STATUS, async (_e, root: unknown) => {
    validRoot(root);
    await reconcilePersistedExecutionRuns(root);
    return getCurrentExecutionRun(root);
  });
  ipcMain.handle(IPC.EXECUTION_STORAGE_DIAGNOSTICS, async (event, root: unknown) => {
    validRoot(root);
    if (projectWindowForSender(event.sender).projectRoot !== path.resolve(root))
      throw new Error('Project mismatch.');
    return inspectExecutionRunStorage(root);
  });
  ipcMain.handle(IPC.EXECUTION_RESTORE_BACKUP, async (event, root: unknown, runId: unknown) => {
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
    return restoreExecutionRunBackup(root, runId);
  });
  ipcMain.handle(IPC.EXECUTION_LEAVE, async (event, root: unknown) => {
    validRoot(root);
    const state = projectWindowForSender(event.sender);
    if (state.projectRoot !== path.resolve(root)) throw new Error('Project mismatch.');
    // Stage browsing does not leave the project and must not stop a Run.
    // Window close, project switch and app exit retain their stop confirmation.
    return true;
  });
  ipcMain.handle(
    IPC.EXECUTION_STOP_FOR_EDIT,
    async (_e, root: unknown, runId: unknown, interrupt: unknown) => {
      validRoot(root);
      if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
      return stopRunForExit(root, runId, interrupt === true ? 'interrupt' : 'graceful');
    },
  );
  ipcMain.handle(IPC.EXECUTION_DISCARD_FOR_EDIT, async (event, root: unknown, runId: unknown) => {
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
  ipcMain.handle(IPC.EXECUTION_RECONCILE, async (_e, root: unknown, runId: unknown) => {
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
  ipcMain.handle(IPC.EXECUTION_GET, async (_e, root: unknown, runId: unknown) => {
    validRoot(root);
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    return getExecutionRun(root, runId);
  });
  ipcMain.handle(IPC.EXECUTION_STOP_SCHEDULING, async (_e, root: unknown, runId: unknown) => {
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
  ipcMain.handle(IPC.EXECUTION_FORCE_INTERRUPT, async (_e, root: unknown, runId: unknown) => {
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
  ipcMain.handle(IPC.EXECUTION_RESUME, async (_e, root: unknown, runId: unknown) => {
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
  ipcMain.handle(IPC.EXECUTION_RESTART_REMOTE, async (_e, root: unknown, runId: unknown) => {
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
  ipcMain.handle(IPC.EXECUTION_RESTART_FROM_SCRATCH, async (_e, root: unknown, runId: unknown) => {
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
  ipcMain.handle(IPC.FINAL_ARTIFACT_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return getFinalArtifactStatus(root);
  });
  ipcMain.handle(IPC.FINAL_ARTIFACT_SELECT_DIRECTORY, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return selectFinalArtifactDirectory(root);
  });
  ipcMain.handle(IPC.FINAL_ARTIFACT_LIST_IMAGES, (_e, root: unknown) => {
    validRoot(root);
    return listFinalArtifactImages(root);
  });
  ipcMain.handle(IPC.FINAL_ARTIFACT_READ_IMAGE, (_e, root: unknown, imagePath: unknown) => {
    validRoot(root);
    if (typeof imagePath !== 'string') throw new Error('Invalid final artifact image path');
    return readFinalArtifactImage(root, imagePath);
  });
  ipcMain.handle(IPC.FINAL_ARTIFACT_READ_PREVIEW, (_e, root: unknown, imagePath: unknown) => {
    validRoot(root);
    if (typeof imagePath !== 'string') throw new Error('Invalid final artifact image path');
    return readFinalArtifactPreview(root, imagePath);
  });
  ipcMain.handle(IPC.CAPTION_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return getCaptionStatus(root);
  });
  ipcMain.handle(IPC.CAPTION_SELECT_SOURCE_DIRECTORY, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await selectFinalArtifactDirectory(root);
    return getCaptionStatus(root);
  });
  ipcMain.handle(IPC.CAPTION_IMPORT_GROK, async (_e, root: unknown, raw: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof raw !== 'string') throw new Error('Invalid Grok caption response');
    return importCaptionGrok(root, raw);
  });
  ipcMain.handle(IPC.CAPTION_GENERATE, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return generateCaption(root);
  });
  ipcMain.handle(IPC.CAPTION_SAVE_PIXIV_TITLE, async (_e, root: unknown, title: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return savePixivTitle(root, title);
  });
  ipcMain.handle(IPC.THUMBNAIL_FONTS, () => listThumbnailFonts());
  ipcMain.handle(IPC.THUMBNAIL_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadThumbnailState(root);
  });
  ipcMain.handle(IPC.THUMBNAIL_RESTORE_BACKUP, async (event, root: unknown) => {
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
  ipcMain.handle(IPC.THUMBNAIL_INITIALIZE_CORRUPT, async (event, root: unknown) => {
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
  ipcMain.handle(IPC.THUMBNAIL_SAVE, async (_e, root: unknown, state: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return saveThumbnailState(root, state);
  });
  ipcMain.handle(IPC.THUMBNAIL_SELECT_IMAGE, async (_e, root: unknown) => {
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
  ipcMain.handle(IPC.THUMBNAIL_LIST_IMAGES, async (event, root: unknown) => {
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
  ipcMain.handle(IPC.THUMBNAIL_READ_IMAGE, (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return readThumbnailImage(imagePath);
  });
  ipcMain.handle(IPC.THUMBNAIL_READ_PREVIEW, async (event, imagePath: unknown) => {
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
  ipcMain.handle(IPC.THUMBNAIL_READ_EDITOR_IMAGE, async (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return (
      (await readCachedThumbnailImage(app.getPath('userData'), imagePath, 'editor')) ??
      readThumbnailImage(imagePath)
    );
  });
  ipcMain.handle(IPC.THUMBNAIL_STORE_WEBP_PREVIEW, (_e, imagePath: unknown, dataUrl: unknown) => {
    if (typeof imagePath !== 'string' || typeof dataUrl !== 'string')
      throw new Error('Invalid thumbnail preview data');
    return storeWebpThumbnailPreview(app.getPath('userData'), imagePath, dataUrl);
  });
  ipcMain.handle(IPC.THUMBNAIL_READ_TEMPLATE, (_e, pattern: unknown) =>
    readThumbnailTemplate(
      path.join(app.getAppPath(), 'dist-electron', 'thumbnail-templates'),
      pattern,
    ),
  );
  ipcMain.handle(
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
  ipcMain.handle(IPC.THUMBNAIL_PICKER_CONTEXT, (event) => {
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
  ipcMain.handle(IPC.THUMBNAIL_PICKER_PERF_OPEN, async (event) => {
    thumbnailPickerForSender(event.sender);
    const directory = path.dirname(pickerPerformanceLogPath(app.getPath('userData')));
    await mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  ipcMain.handle(IPC.THUMBNAIL_PICKER_PERF, (event, name: unknown, metrics: unknown) => {
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
  ipcMain.handle(IPC.THUMBNAIL_PICKER_PREVIEW, async (event, imagePath: unknown) => {
    const state = thumbnailPickerForSender(event.sender);
    const resolved = await validateThumbnailPickerImage(state, imagePath);
    if (!state.opener.isDestroyed())
      state.opener.send(IPC.THUMBNAIL_PICKER_PREVIEWED, {
        sessionId: state.sessionId,
        slot: state.slot,
        imagePath: resolved,
      });
  });
  ipcMain.handle(IPC.THUMBNAIL_PICKER_COMMIT, async (event, imagePath: unknown) => {
    const state = thumbnailPickerForSender(event.sender);
    await ensureProjectWritable(state.root);
    const resolved = await validateThumbnailPickerImage(state, imagePath);
    state.committed = true;
    if (!state.opener.isDestroyed())
      state.opener.send(IPC.THUMBNAIL_PICKER_COMMITTED, {
        sessionId: state.sessionId,
        slot: state.slot,
        imagePath: resolved,
      });
    state.window.close();
  });
  ipcMain.handle(
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
  ipcMain.handle(IPC.THUMBNAIL_DELETE_OUTPUTS, async (_e, root: unknown, documentId: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof documentId !== 'number' || !Number.isSafeInteger(documentId) || documentId < 1)
      throw new Error('Invalid thumbnail document');
    return deleteThumbnailOutputs(root, documentId);
  });
  ipcMain.handle(IPC.MARKETPLACE_LIST_THUMBNAILS, (_e, root: unknown) => {
    validRoot(root);
    return listExportedThumbnails(root);
  });
  ipcMain.handle(
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
  ipcMain.handle(
    IPC.MARKETPLACE_READ_SOURCE_PREVIEW,
    (_e, root: unknown, imagePath: unknown, sourceType: unknown) => {
      validRoot(root);
      if (
        typeof imagePath !== 'string' ||
        (sourceType !== 'thumbnail' && sourceType !== 'final-artifact')
      )
        throw new Error('Invalid marketplace source');
      return readMarketplaceSourcePreview(root, imagePath, sourceType);
    },
  );
  ipcMain.handle(IPC.MARKETPLACE_TARGETS, () => getMarketplaceImageTargets());
  ipcMain.handle(IPC.MARKETPLACE_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadMarketplaceImageState(root);
  });
  ipcMain.handle(IPC.MARKETPLACE_RESTORE_BACKUP, async (event, root: unknown) => {
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
  ipcMain.handle(IPC.MARKETPLACE_INITIALIZE_CORRUPT, async (event, root: unknown) => {
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
  ipcMain.handle(IPC.MARKETPLACE_SAVE, async (_e, root: unknown, state: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return saveMarketplaceImageState(root, state);
  });
  ipcMain.handle(
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
  ipcMain.handle(
    IPC.MARKETPLACE_GENERATE_ZIP,
    async (_e, root: unknown, format: unknown, state: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      return generateMarketplaceZip(root, format, state);
    },
  );
  ipcMain.handle(
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
  ipcMain.handle(
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
  ipcMain.handle(
    IPC.MARKETPLACE_PICKER_OPEN,
    (event, root: unknown, currentImagePath: unknown, sourceType: unknown) => {
      validRoot(root);
      if (typeof currentImagePath !== 'string') throw new Error('Invalid marketplace image path');
      if (sourceType !== 'thumbnail' && sourceType !== 'final-artifact')
        throw new Error('Invalid marketplace source');
      return openMarketplacePickerWindow(event.sender, root, currentImagePath, sourceType);
    },
  );
  ipcMain.handle(IPC.MARKETPLACE_PICKER_CONTEXT, (event) => {
    const state = marketplacePickerForSender(event.sender);
    return {
      sessionId: state.sessionId,
      root: state.root,
      currentImagePath: state.currentImagePath,
      sourceType: state.sourceType,
    };
  });
  ipcMain.handle(IPC.MARKETPLACE_PICKER_PREVIEW, async (event, imagePath: unknown) => {
    const state = marketplacePickerForSender(event.sender);
    const resolved = await validateMarketplacePickerImage(state, imagePath);
    if (!state.opener.isDestroyed())
      state.opener.send(IPC.MARKETPLACE_PICKER_PREVIEWED, {
        sessionId: state.sessionId,
        imagePath: resolved,
      });
  });
  ipcMain.handle(IPC.MARKETPLACE_PICKER_COMMIT, async (event, imagePath: unknown) => {
    const state = marketplacePickerForSender(event.sender);
    await ensureProjectWritable(state.root);
    const resolved = await validateMarketplacePickerImage(state, imagePath);
    state.committed = true;
    if (!state.opener.isDestroyed())
      state.opener.send(IPC.MARKETPLACE_PICKER_COMMITTED, {
        sessionId: state.sessionId,
        imagePath: resolved,
      });
    state.window.close();
  });
  ipcMain.handle(IPC.R2_SETTINGS, () => r2().settings());
  ipcMain.handle(IPC.R2_ENVIRONMENT, () => r2().environment());
  ipcMain.handle(IPC.R2_TEST, (_e, input: R2ConnectionInput) => r2().test(input));
  ipcMain.handle(IPC.R2_SAVE_SETTINGS, async (_e, input: R2ConnectionInput) => {
    const result = await r2().saveSettings(input);
    void r2Index()
      .sync()
      .catch((error) => console.warn('R2 index sync failed:', error));
    return result;
  });
  ipcMain.handle(IPC.R2_BUCKETS, () => r2().buckets());
  ipcMain.handle(IPC.R2_CREATE_BUCKET, async (_e, name: unknown) => {
    if (typeof name !== 'string') throw new Error('Invalid bucket');
    await r2().createBucket(name);
    void r2Index()
      .sync()
      .catch(() => {});
  });
  ipcMain.handle(IPC.R2_DELETE_BUCKET, async (_e, name: unknown) => {
    if (typeof name !== 'string') throw new Error('Invalid bucket');
    await r2().deleteBucket(name);
    void r2Index()
      .sync()
      .catch(() => {});
  });
  ipcMain.handle(IPC.R2_LIST, (_e, b: unknown, p: unknown, t: unknown) => {
    if (typeof b !== 'string' || typeof p !== 'string') throw new Error('Invalid R2 path');
    return r2().list(b, p, typeof t === 'string' ? t : null);
  });
  ipcMain.handle(IPC.R2_SEARCH, (_e, b: unknown, q: unknown, t: unknown) => {
    if (typeof b !== 'string' || typeof q !== 'string') throw new Error('Invalid search');
    return r2Index().search(b, q, typeof t === 'string' ? t : null);
  });
  ipcMain.handle(IPC.R2_DOWNLOAD_INFO, (_e, b: unknown, k: unknown, ex: unknown) => {
    if (typeof b !== 'string' || typeof k !== 'string') throw new Error('Invalid object');
    return r2().downloadInfo(b, k, typeof ex === 'number' ? ex : 3600);
  });
  ipcMain.handle(IPC.R2_BATCH_DOWNLOAD_INFO, (_e, b: unknown, keys: unknown, ex: unknown) => {
    if (typeof b !== 'string' || !Array.isArray(keys)) throw new Error('Invalid batch objects');
    return r2().batchDownloadInfo(
      b,
      keys.filter((x) => typeof x === 'string'),
      typeof ex === 'number' ? ex : 3600,
    );
  });
  ipcMain.handle(IPC.R2_PUT_URL_INFO, (_e, b: unknown, k: unknown, ex: unknown, ct: unknown) => {
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
  ipcMain.handle(IPC.R2_DELETE_OBJECTS, async (_e, b: unknown, keys: unknown) => {
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
  ipcMain.handle(IPC.R2_MOVE, async (_e, b: unknown, s: unknown, d: unknown, o: unknown) => {
    if (typeof b !== 'string' || typeof s !== 'string' || typeof d !== 'string')
      throw new Error('Invalid move');
    await r2().move(b, s, d, o === true);
    void r2Index()
      .sync()
      .catch(() => {});
  });
  ipcMain.handle(IPC.R2_SELECT_UPLOAD_FILES, async () => {
    const result = await dialog.showOpenDialog({
      title: 'R2へアップロードするファイルを選択',
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle(IPC.R2_BEGIN_UPLOAD, (_e, b: unknown, p: unknown, f: unknown, o: unknown) => {
    if (typeof b !== 'string' || typeof p !== 'string' || typeof f !== 'string')
      throw new Error('Invalid upload');
    return r2().beginUpload(b, p, f, o === true);
  });
  ipcMain.handle(IPC.R2_UPLOADS, () => r2().uploads());
  ipcMain.handle(IPC.R2_RESUME_UPLOAD, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid upload id');
    return r2().resumeUpload(id);
  });
  ipcMain.handle(IPC.R2_PAUSE_UPLOAD, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid upload id');
    return r2().pauseUpload(id);
  });
  ipcMain.handle(IPC.R2_CANCEL_UPLOAD, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid upload id');
    return r2().cancelUpload(id);
  });
  ipcMain.handle(IPC.R2_TEMPLATES, (_e, b: unknown) =>
    r2().templates(typeof b === 'string' ? b : undefined),
  );
  ipcMain.handle(IPC.R2_SAVE_TEMPLATE, (_e, input: any) => r2().saveTemplate(input));
  ipcMain.handle(IPC.R2_DELETE_TEMPLATE, (_e, id: unknown) => {
    if (typeof id !== 'string') throw new Error('Invalid template id');
    return r2().deleteTemplate(id);
  });
  ipcMain.handle(IPC.R2_METRICS, () => r2().metrics());
  ipcMain.handle(IPC.CLIPBOARD_WRITE_TEXT, (_e, text: unknown) => {
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
  ipcMain.handle(IPC.ASSISTANT_GET_PROVIDER, getAssistantProvider);
  ipcMain.handle(IPC.CODEX_GET_PROVIDER, getAssistantProvider);
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
  ipcMain.handle(IPC.ASSISTANT_SET_PROVIDER, setAssistantProvider);
  ipcMain.handle(IPC.CODEX_SET_PROVIDER, setAssistantProvider);
  ipcMain.handle(IPC.CODEX_SET_CONTEXT, (event, root: unknown, stage: unknown) => {
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
  ipcMain.handle(IPC.CODEX_CONTEXT, (event) => {
    const state = projectWindowForSender(event.sender);
    return state.codexContext;
  });
  ipcMain.handle(IPC.CODEX_SELECT_STAGE_TASK, (event, root: unknown, stage: unknown) => {
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

  ipcMain.handle(IPC.CODEX_STATUS, () => codexAccount());
  ipcMain.handle(IPC.CODEX_SIGN_IN, async () => {
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
  ipcMain.handle(IPC.CODEX_SNAPSHOT, (event) =>
    codexSnapshot(projectWindowForSender(event.sender)),
  );
  ipcMain.handle(IPC.CODEX_MODELS, (event) =>
    codexModelSettings(codexContextFor(projectWindowForSender(event.sender))),
  );
  ipcMain.handle(IPC.CODEX_SELECT_MODEL, (event, selection: unknown) =>
    codexChooseModel(projectWindowForSender(event.sender), selection),
  );
  ipcMain.handle(IPC.CODEX_NEW_CHAT, async (event) => {
    const state = projectWindowForSender(event.sender);
    const context = codexContextFor(state);
    const { store } = codexService();
    await store.clearActive(context.root, context.stage);
    stateCodexActiveThread.set(state.window.id, null);
    return codexSnapshot(state);
  });
  ipcMain.handle(IPC.CODEX_RESTORE_CHAT, async (event, id: unknown) => {
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
  ipcMain.handle(IPC.CODEX_STOP_TURN, (event) =>
    codexStopTurn(projectWindowForSender(event.sender)),
  );
  ipcMain.handle(IPC.CODEX_SEND, (event, input: unknown) => {
    if (typeof input !== 'string') throw new Error('Invalid Codex prompt.');
    return codexSend(projectWindowForSender(event.sender), input);
  });
  ipcMain.handle(IPC.CODEX_SEND_TASK, (event, stage: unknown, extra: unknown) => {
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
  ipcMain.handle(IPC.CODEX_LATEST_ARTIFACT, async (event) => {
    const state = projectWindowForSender(event.sender);
    const context = codexContextFor(state);
    const saved = await codexService().store.get(context.root, context.stage);
    return codexArtifactFor(context, saved.activeThreadId);
  });
  ipcMain.handle(IPC.CODEX_RETRY_ARTIFACT, async (event) => {
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
  ipcMain.handle(IPC.CODEX_SAVE_RESPONSE, async (event, response: unknown) => {
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
  ipcMain.handle(IPC.GROK_SET_VISIBLE, (event, v: unknown) => {
    const state = projectWindowForSender(event.sender);
    state.grokVisible = v === true;
    layoutProjectWindow(state);
    return paneState(state);
  });
  ipcMain.handle(IPC.GROK_SET_CONTEXT, (event, root: unknown, stage: unknown) => {
    validRoot(root);
    validGrokContextStage(stage);
    return setGrokContext(projectWindowForSender(event.sender), root, stage);
  });
  ipcMain.handle(IPC.GROK_SET_RATIO, (event, r: unknown) => {
    if (typeof r !== 'number' || !Number.isFinite(r)) throw new Error('Invalid ratio');
    const state = projectWindowForSender(event.sender);
    state.localRatio = Math.max(0.3, Math.min(0.7, r));
    layoutProjectWindow(state);
    return paneState(state);
  });
  ipcMain.handle(IPC.GROK_SET_DIVIDER_X, (event, x: unknown) => {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error('Invalid divider position');
    const state = projectWindowForSender(event.sender),
      bounds = state.window.getContentBounds();
    state.localRatio = Math.max(0.3, Math.min(0.7, (x - bounds.x) / Math.max(bounds.width, 1)));
    layoutProjectWindow(state);
    return paneState(state);
  });
  ipcMain.handle(IPC.GROK_RELOAD, (event) =>
    projectWindowForSender(event.sender).grokView.webContents.reload(),
  );
  ipcMain.handle(IPC.GROK_OPEN_EXTERNAL, () => shell.openExternal(GROK_URL));
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
  grokChatState = new GrokChatStateStore(userData);
  codexChatState = new CodexChatStateStore(userData);
  codexModelSelections = new CodexModelSelectionStore(userData);
  assistantProviderState = new AssistantProviderStore(userData);
  codexAppServer = new CodexAppServer();
  codexAppServer.on('notification', forwardCodexNotification);
  codexAppServer.on('disconnected', (message: string) => {
    codexTurnMonitor.disconnected();
    codexBusy.clear();
    codexTurnStartRequests.clear();
    codexActiveTurnIds.clear();
    codexInterruptRequests.clear();
    codexPendingArtifacts.clear();
    for (const state of projectWindows.values())
      state.codexView.webContents.send(IPC.CODEX_EVENT, {
        method: 'disconnected',
        params: { message },
      });
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
app.on('will-quit', () => codexAppServer?.stop());
app.on('window-all-closed', () => {
  if (!executionCoordinator.hasActiveRuns() && process.platform !== 'darwin') app.quit();
});
