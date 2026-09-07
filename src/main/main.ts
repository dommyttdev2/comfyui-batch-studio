import { app, BaseWindow, clipboard, dialog, ipcMain, shell, WebContentsView } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { IPC } from '../shared/ipc.js';
import type { GrokPaneState } from '../shared/types.js';
import { scanProject } from './project-scan.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GROK_URL = 'https://grok.com/';
const GROK_PARTITION = 'persist:batch-studio-grok';
const MIN_LOCAL_WIDTH = 420;
const MIN_GROK_WIDTH = 420;

let mainWindow: BaseWindow | null = null;
let localView: WebContentsView | null = null;
let grokView: WebContentsView | null = null;
let grokVisible = true;
let localRatio = 0.45;

function isAllowedGrokNavigation(target: string): boolean {
  try {
    const url = new URL(target);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === 'https:' &&
      (host === 'grok.com' ||
        host.endsWith('.grok.com') ||
        host === 'x.com' ||
        host.endsWith('.x.com') ||
        host === 'twitter.com' ||
        host.endsWith('.twitter.com'))
    );
  } catch {
    return false;
  }
}

function paneState(): GrokPaneState {
  return { visible: grokVisible, ratio: localRatio };
}

function applyLayout(): void {
  if (!mainWindow || !localView || !grokView) return;

  const { width, height } = mainWindow.getContentBounds();
  if (!grokVisible || width < MIN_LOCAL_WIDTH + MIN_GROK_WIDTH) {
    localView.setBounds({ x: 0, y: 0, width, height });
    grokView.setBounds({ x: width, y: 0, width: 0, height });
    return;
  }

  const desiredLocal = Math.round(width * localRatio);
  const localWidth = Math.max(MIN_LOCAL_WIDTH, Math.min(width - MIN_GROK_WIDTH, desiredLocal));
  localView.setBounds({ x: 0, y: 0, width: localWidth, height });
  grokView.setBounds({ x: localWidth, y: 0, width: width - localWidth, height });
}

async function loadLocalRenderer(view: WebContentsView): Promise<void> {
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await view.webContents.loadURL(devUrl);
    return;
  }

  await view.webContents.loadFile(path.resolve(__dirname, '../../dist-renderer/index.html'));
}

function createWindow(): void {
  mainWindow = new BaseWindow({
    width: 1500,
    height: 900,
    minWidth: 900,
    minHeight: 640,
    title: 'ComfyUI Batch Studio',
  });

  localView = new WebContentsView({
    webPreferences: {
      preload: path.resolve(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  grokView = new WebContentsView({
    webPreferences: {
      partition: GROK_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.contentView.addChildView(localView);
  mainWindow.contentView.addChildView(grokView);

  grokView.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  grokView.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedGrokNavigation(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.on('resize', applyLayout);
  mainWindow.on('closed', () => {
    localView?.webContents.close();
    grokView?.webContents.close();
    localView = null;
    grokView = null;
    mainWindow = null;
  });

  applyLayout();
  void loadLocalRenderer(localView);
  void grokView.webContents.loadURL(GROK_URL);
}

function registerIpc(): void {
  ipcMain.handle(IPC.PROJECT_SELECT, async () => {
    const result = await dialog.showOpenDialog({
      title: 'プロジェクトフォルダーを選択',
      properties: ['openDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return scanProject(result.filePaths[0]);
  });

  ipcMain.handle(IPC.PROJECT_SCAN, async (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.length === 0) {
      throw new Error('Invalid project root path.');
    }
    return scanProject(rootPath);
  });

  ipcMain.handle(IPC.PROJECT_OPEN_FOLDER, async (_event, rootPath: unknown) => {
    if (typeof rootPath !== 'string' || rootPath.length === 0) {
      throw new Error('Invalid project root path.');
    }
    const error = await shell.openPath(rootPath);
    if (error) throw new Error(error);
  });

  ipcMain.handle(IPC.CLIPBOARD_WRITE_TEXT, (_event, text: unknown) => {
    if (typeof text !== 'string') throw new Error('Clipboard text must be a string.');
    clipboard.writeText(text);
  });

  ipcMain.handle(IPC.GROK_SET_VISIBLE, (_event, visible: unknown) => {
    grokVisible = visible === true;
    applyLayout();
    return paneState();
  });

  ipcMain.handle(IPC.GROK_SET_RATIO, (_event, ratio: unknown) => {
    if (typeof ratio !== 'number' || !Number.isFinite(ratio)) {
      throw new Error('Invalid pane ratio.');
    }
    localRatio = Math.max(0.3, Math.min(0.7, ratio));
    applyLayout();
    return paneState();
  });

  ipcMain.handle(IPC.GROK_RELOAD, () => {
    grokView?.webContents.reload();
  });

  ipcMain.handle(IPC.GROK_OPEN_EXTERNAL, async () => {
    await shell.openExternal(GROK_URL);
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (!mainWindow) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
