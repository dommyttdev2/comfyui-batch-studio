import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc.js';
import type { BatchStudioApi, GrokPaneState, ProjectSummary } from '../shared/types.js';

const api: BatchStudioApi = {
  project: {
    select: () => ipcRenderer.invoke(IPC.PROJECT_SELECT) as Promise<ProjectSummary | null>,
    scan: (rootPath) => ipcRenderer.invoke(IPC.PROJECT_SCAN, rootPath) as Promise<ProjectSummary>,
    openFolder: (rootPath) => ipcRenderer.invoke(IPC.PROJECT_OPEN_FOLDER, rootPath) as Promise<void>,
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_TEXT, text) as Promise<void>,
  },
  grok: {
    setVisible: (visible) => ipcRenderer.invoke(IPC.GROK_SET_VISIBLE, visible) as Promise<GrokPaneState>,
    setRatio: (ratio) => ipcRenderer.invoke(IPC.GROK_SET_RATIO, ratio) as Promise<GrokPaneState>,
    reload: () => ipcRenderer.invoke(IPC.GROK_RELOAD) as Promise<void>,
    openExternal: () => ipcRenderer.invoke(IPC.GROK_OPEN_EXTERNAL) as Promise<void>,
  },
};

contextBridge.exposeInMainWorld('batchStudio', api);
