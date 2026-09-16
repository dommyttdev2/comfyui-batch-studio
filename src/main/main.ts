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
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
  ThumbnailSlotKey,
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
import { buildGrokTask } from './grok-context.js';
import { catalogStatus } from './model-catalog.js';
import { compileWorkflow } from './compiler.js';
import { checkAvailability, checkLoraFileAvailability } from './availability.js';
import { runPreflight } from './preflight.js';
import {
  abandonExecutionRunForRemoteReplacement,
  discardExecutionRun,
  getCurrentExecutionRun,
  getExecutionRun,
  listExecutionRuns,
  mutateExecutionRun,
  requestForceInterrupt,
  requestStopScheduling,
  resumeExecutionRun,
  startExecutionRun,
} from './execution-run.js';
import { LocalExecutionService } from './local-execution.js';
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
import { generateCaption, getCaptionStatus, importCaptionGrok } from './caption-service.js';
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
  renderMarketplacePng,
  saveMarketplaceImageState,
} from './marketplace-image-service.js';
import {
  exportThumbnail,
  listThumbnailFonts,
  listThumbnailImages,
  loadThumbnailState,
  readThumbnailImage,
  readThumbnailPreview,
  readThumbnailTemplate,
  saveThumbnailState,
} from './thumbnail-service.js';

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
type RendererWindowTool = StandaloneWindowTool | 'thumbnail-picker' | 'marketplace-picker';
type StandaloneToolWindowState = { window: BaseWindow; view: WebContentsView };
type ThumbnailPickerWindowState = {
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
type ProjectWindowState = {
  window: BaseWindow;
  localView: WebContentsView;
  grokView: WebContentsView;
  grokLoadingView: WebContentsView;
  projectRoot: string | null;
  restoreLastProject: boolean;
  grokVisible: boolean;
  grokLoading: boolean;
  grokLoadingGeneration: number;
  localRatio: number;
  activeGrokContext: { root: string; stage: GrokContextStage } | null;
  restoringGrokContext: boolean;
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
    return;
  }
  const lw = Math.max(420, Math.min(width - 420, Math.round(width * state.localRatio))),
    grokBounds = { x: lw, y: 0, width: width - lw, height };
  state.localView.setBounds({ x: 0, y: 0, width: lw, height });
  state.grokView.setBounds(grokBounds);
  state.grokLoadingView.setBounds(
    state.grokLoading ? grokBounds : { x: width, y: 0, width: 0, height },
  );
}
function projectWindowForSender(contents: WebContents) {
  for (const state of projectWindows.values())
    if (
      state.localView.webContents.id === contents.id ||
      state.grokView.webContents.id === contents.id
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
  state.projectRoot = resolved;
  await stateStore().rememberProject(resolved);
}
async function loadRenderer(v: WebContentsView, tool?: RendererWindowTool) {
  const dev = process.env.VITE_DEV_SERVER_URL;
  if (dev) {
    const url = new URL(dev);
    if (tool) url.searchParams.set('tool', tool);
    await v.webContents.loadURL(url.toString());
  } else
    await v.webContents.loadFile(
      path.resolve(__dirname, '../../dist-renderer/index.html'),
      tool ? { query: { tool } } : undefined,
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
  if (candidate?.projectRoot) await stateStore().rememberProject(candidate.projectRoot);
  else if (clearIfNone) await stateStore().clearProject();
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
      grokLoadingView,
      projectRoot: options.initialProjectRoot ? path.resolve(options.initialProjectRoot) : null,
      restoreLastProject: Boolean(options.restoreLastProject),
      grokVisible: false,
      grokLoading: false,
      grokLoadingGeneration: 0,
      localRatio: 0.45,
      activeGrokContext: null,
      restoringGrokContext: false,
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
  void grokLoadingView.webContents
    .loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(GROK_LOADING_HTML)}`)
    .catch((error) => console.warn('Grok loading placeholder failed:', error));
  configureGrokContents(grokView.webContents);
  attachGrokHistoryTracking(state);
  window.on('focus', () => {
    state.lastFocusedAt = ++projectWindowFocusSequence;
    lastFocusedProjectWindowId = windowId;
    if (state.projectRoot) void stateStore().rememberProject(state.projectRoot);
  });
  window.on('resize', () => layoutProjectWindow(state));
  window.on('closed', () => {
    for (const picker of thumbnailPickerWindows.values()) {
      if (picker.opener.id === localView.webContents.id) picker.window.close();
    }
    for (const picker of marketplacePickerWindows.values()) {
      if (picker.opener.id === localView.webContents.id) picker.window.close();
    }
    localView.webContents.close();
    grokView.webContents.close();
    grokLoadingView.webContents.close();
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
  return assertFinalArtifactImage(state.root, imagePath);
}

function openMarketplacePickerWindow(opener: WebContents, root: string, currentImagePath: string) {
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
  if (selected.canceled || !selected.filePaths[0]) return;
  const root = path.resolve(selected.filePaths[0]),
    existing = projectWindowForRoot(root, target.state ?? undefined);
  if (existing) {
    focusProjectWindow(existing);
    return;
  }
  if (target.mode === 'new') {
    await stateStore().rememberProject(root);
    createProjectWindow({ initialProjectRoot: root });
    return;
  }
  const state = target.state;
  if (!state) return;
  const project = await scanWithCatalog(root);
  await setWindowProject(state, root);
  focusProjectWindow(state);
  state.localView.webContents.send(IPC.PROJECT_MENU_COMMAND, 'open', project);
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
function installApplicationMenu() {
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
      await stateStore().rememberProject(state.projectRoot);
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
    state.projectRoot = null;
    state.activeGrokContext = null;
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
    const state = projectWindowForSender(event.sender),
      root = await createProject(parent, brief),
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
      await saveProjectSettings(root, settings);
      return scanProject(root);
    },
  );
  ipcMain.handle(IPC.PROJECT_SAVE_BRIEF, async (_e, root: unknown, brief: ProjectBriefInput) => {
    validRoot(root);
    await saveProjectBrief(root, brief);
    return scanProject(root);
  });
  ipcMain.handle(IPC.ARTIFACT_READ, (_e, root: unknown, key: any, source: any) => {
    validRoot(root);
    return readArtifact(root, key, source);
  });
  ipcMain.handle(IPC.ARTIFACT_BEGIN_EDIT, (_e, root: unknown, key: any) => {
    validRoot(root);
    return beginEditArtifact(root, key);
  });
  ipcMain.handle(IPC.ARTIFACT_SAVE_DRAFT, (_e, root: unknown, key: any, content: unknown) => {
    validRoot(root);
    if (typeof content !== 'string') throw new Error('Invalid content');
    return saveDraft(root, key, content);
  });
  ipcMain.handle(
    IPC.ARTIFACT_IMPORT_GROK,
    (_e, root: unknown, key: any, raw: unknown, stage: unknown) => {
      validRoot(root);
      if (typeof raw !== 'string') throw new Error('Invalid Grok response');
      if (stage !== undefined && stage !== 'models' && stage !== 'models-fix')
        throw new Error('Invalid Grok response stage');
      return importGrok(root, key, raw, stage);
    },
  );
  ipcMain.handle(IPC.ARTIFACT_CONFIRM, async (_e, root: unknown, key: any) => {
    validRoot(root);
    await confirmArtifact(root, key);
    return scanProject(root);
  });
  ipcMain.handle(IPC.ARTIFACT_GROK_LORA_HISTORY, (_e, root: unknown) => {
    validRoot(root);
    return readGrokLoraSelectionHistory(root);
  });
  ipcMain.handle(IPC.ARTIFACT_RESET_FROM, async (_e, root: unknown, scope: unknown) => {
    validRoot(root);
    validManualResetScope(scope);
    await manualResetFrom(root, scope);
    return scanProject(root);
  });
  ipcMain.handle(IPC.PROMPT_PLAN_SAVE, (_e, root: unknown, plan: PromptPlanArtifact) => {
    validRoot(root);
    return savePromptPlan(root, plan);
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
  ipcMain.handle(IPC.WORKFLOW_COMPILE, (_e, root: unknown) => {
    validRoot(root);
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
    const run = await startExecutionRun(root, () => executionPreflight(root));
    await startExecutionRuntime(root, run);
    return run;
  });
  ipcMain.handle(IPC.EXECUTION_STATUS, async (_e, root: unknown) => {
    validRoot(root);
    return getCurrentExecutionRun(root);
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
    if (typeof runId !== 'string') throw new Error('Invalid Execution Run ID');
    const run = await resumeExecutionRun(root, runId, () => executionPreflight(root));
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
  ipcMain.handle(IPC.FINAL_ARTIFACT_SELECT_DIRECTORY, (_e, root: unknown) => {
    validRoot(root);
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
    await selectFinalArtifactDirectory(root);
    return getCaptionStatus(root);
  });
  ipcMain.handle(IPC.CAPTION_IMPORT_GROK, (_e, root: unknown, raw: unknown) => {
    validRoot(root);
    if (typeof raw !== 'string') throw new Error('Invalid Grok caption response');
    return importCaptionGrok(root, raw);
  });
  ipcMain.handle(IPC.CAPTION_GENERATE, (_e, root: unknown) => {
    validRoot(root);
    return generateCaption(root);
  });
  ipcMain.handle(IPC.THUMBNAIL_FONTS, () => listThumbnailFonts());
  ipcMain.handle(IPC.THUMBNAIL_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadThumbnailState(root);
  });
  ipcMain.handle(IPC.THUMBNAIL_SAVE, (_e, root: unknown, state: unknown) => {
    validRoot(root);
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
  ipcMain.handle(IPC.THUMBNAIL_LIST_IMAGES, async (_e, root: unknown) => {
    validRoot(root);
    const finalArtifact = await getFinalArtifactStatus(root);
    if (!finalArtifact.exists || !finalArtifact.directory) return [];
    return listThumbnailImages(finalArtifact.directory);
  });
  ipcMain.handle(IPC.THUMBNAIL_READ_IMAGE, (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return readThumbnailImage(imagePath);
  });
  ipcMain.handle(IPC.THUMBNAIL_READ_PREVIEW, (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return readThumbnailPreview(imagePath);
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
    return {
      sessionId: state.sessionId,
      root: state.root,
      slot: state.slot,
      currentImagePath: state.currentImagePath,
    };
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
    (_e, root: unknown, documentId: unknown, format: unknown, dataUrl: unknown) => {
      validRoot(root);
      if (typeof documentId !== 'number' || documentId < 1 || documentId > 6)
        throw new Error('Invalid thumbnail document');
      if (format !== 'png' && format !== 'jpeg') throw new Error('Invalid thumbnail format');
      if (typeof dataUrl !== 'string') throw new Error('Invalid thumbnail image data');
      return exportThumbnail(root, documentId, format, dataUrl);
    },
  );
  ipcMain.handle(IPC.MARKETPLACE_TARGETS, () => getMarketplaceImageTargets());
  ipcMain.handle(IPC.MARKETPLACE_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadMarketplaceImageState(root);
  });
  ipcMain.handle(IPC.MARKETPLACE_SAVE, (_e, root: unknown, state: unknown) => {
    validRoot(root);
    return saveMarketplaceImageState(root, state);
  });
  ipcMain.handle(
    IPC.MARKETPLACE_GENERATE,
    (_e, root: unknown, state: unknown, webpDataUrls: unknown, sourcePngDataUrl: unknown) => {
      validRoot(root);
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
  ipcMain.handle(IPC.MARKETPLACE_GENERATE_ZIP, (_e, root: unknown, format: unknown) => {
    validRoot(root);
    return generateMarketplaceZip(root, format);
  });
  ipcMain.handle(
    IPC.MARKETPLACE_EXPORT_CUSTOM,
    (_e, root: unknown, state: unknown, webpDataUrl: unknown, sourcePngDataUrl: unknown) => {
      validRoot(root);
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
    ) => {
      validRoot(root);
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
      );
    },
  );
  ipcMain.handle(IPC.MARKETPLACE_PICKER_OPEN, (event, root: unknown, currentImagePath: unknown) => {
    validRoot(root);
    if (typeof currentImagePath !== 'string') throw new Error('Invalid marketplace image path');
    return openMarketplacePickerWindow(event.sender, root, currentImagePath);
  });
  ipcMain.handle(IPC.MARKETPLACE_PICKER_CONTEXT, (event) => {
    const state = marketplacePickerForSender(event.sender);
    return {
      sessionId: state.sessionId,
      root: state.root,
      currentImagePath: state.currentImagePath,
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
  if (quitApproved || !executionCoordinator.hasActiveRuns()) return;
  event.preventDefault();
  if (quitPromptOpen) return;
  quitPromptOpen = true;
  void dialog
    .showMessageBox({
      type: 'warning',
      title: '実行中のRunがあります',
      message: '実行中のRunがあります。Batch Studioを終了しますか？',
      detail: 'Applicationを終了すると、Windowを閉じる場合と異なり実行中Runも停止します。',
      buttons: ['キャンセル', '終了'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    .then((result) => {
      quitPromptOpen = false;
      if (result.response !== 1) return;
      quitApproved = true;
      app.quit();
    });
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
  installApplicationMenu();
  createProjectWindow({ restoreLastProject: true });
  app.on('activate', () => {
    const existing = lastFocusedProjectWindow();
    if (existing) focusProjectWindow(existing);
    else createProjectWindow({ restoreLastProject: true });
  });
}
if (hasSingleInstanceLock) void app.whenReady().then(initializeApplication);
app.on('window-all-closed', () => {
  if (!executionCoordinator.hasActiveRuns() && process.platform !== 'darwin') app.quit();
});
