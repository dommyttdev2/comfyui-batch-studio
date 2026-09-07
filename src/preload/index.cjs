const { contextBridge, ipcRenderer } = require('electron');

const IPC = Object.freeze({
  PROJECT_SELECT: 'project:select',
  PROJECT_SCAN: 'project:scan',
  PROJECT_OPEN_FOLDER: 'project:open-folder',
  CLIPBOARD_WRITE_TEXT: 'clipboard:write-text',
  GROK_SET_VISIBLE: 'grok:set-visible',
  GROK_SET_RATIO: 'grok:set-ratio',
  GROK_RELOAD: 'grok:reload',
  GROK_OPEN_EXTERNAL: 'grok:open-external',
});

contextBridge.exposeInMainWorld('batchStudio', {
  project: {
    select: () => ipcRenderer.invoke(IPC.PROJECT_SELECT),
    scan: (rootPath) => ipcRenderer.invoke(IPC.PROJECT_SCAN, rootPath),
    openFolder: (rootPath) => ipcRenderer.invoke(IPC.PROJECT_OPEN_FOLDER, rootPath),
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(IPC.CLIPBOARD_WRITE_TEXT, text),
  },
  grok: {
    setVisible: (visible) => ipcRenderer.invoke(IPC.GROK_SET_VISIBLE, visible),
    setRatio: (ratio) => ipcRenderer.invoke(IPC.GROK_SET_RATIO, ratio),
    reload: () => ipcRenderer.invoke(IPC.GROK_RELOAD),
    openExternal: () => ipcRenderer.invoke(IPC.GROK_OPEN_EXTERNAL),
  },
});
