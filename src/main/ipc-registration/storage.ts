import type { R2ConnectionInput } from '../../shared/types.js';
import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerStorageIpc(dependencies: IpcRegistrationDependencies) {
  const { IPC, clipboard, dialog, handleIpc, r2, r2Index } = dependencies;

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
}
