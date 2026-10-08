import type {
  MarketplaceCropRect,
  MarketplaceSourceType,
  ThumbnailSlotKey,
} from '../../shared/types.js';
import type { ThumbnailCacheTiming } from '../thumbnail-image-cache.js';
import type { PickerMetrics } from '../thumbnail-picker-perf.js';
import type { IpcRegistrationDependencies } from '../ipc-registration.js';

export function registerImageIpc(dependencies: IpcRegistrationDependencies) {
  const {
    IPC,
    app,
    deleteThumbnailOutputs,
    deleteThumbnailDocument,
    dialog,
    ensureProjectWritable,
    exportCustomMarketplaceImage,
    exportThumbnail,
    generateCaption,
    generateMarketplaceImages,
    generateMarketplaceZip,
    getCaptionStatus,
    getFinalArtifactStatus,
    getMarketplaceImageTargets,
    handleIpc,
    importCaptionGrok,
    initializeCorruptMarketplaceImageState,
    initializeCorruptThumbnailState,
    listExportedThumbnails,
    listFinalArtifactImages,
    listThumbnailFonts,
    listThumbnailImages,
    loadMarketplaceImageState,
    loadThumbnailState,
    logThumbnailPickerPerformance,
    marketplacePickerForSender,
    marketplacePickerWindows,
    mkdir,
    openMarketplacePickerWindow,
    openThumbnailPickerWindow,
    path,
    pickerPerformanceLogPath,
    projectWindowForSender,
    readCachedThumbnailImage,
    readFinalArtifactImage,
    readFinalArtifactPreview,
    readMarketplaceSource,
    readProjectMeta,
    readMarketplaceSourcePreview,
    readThumbnailImage,
    readThumbnailPreview,
    readThumbnailTemplate,
    renderMarketplacePng,
    restoreMarketplaceImageState,
    restoreThumbnailState,
    saveMarketplaceImageState,
    saveProjectSettings,
    savePixivTitle,
    saveThumbnailState,
    shell,
    storeWebpThumbnailPreview,
    thumbnailCachePruneMetrics,
    thumbnailPickerForSender,
    thumbnailPickerWindows,
    validateMarketplacePickerImage,
    validateThumbnailPickerImage,
  } = dependencies;
  const validRoot: IpcRegistrationDependencies['validRoot'] = dependencies.validRoot;
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

  handleIpc(IPC.FINAL_ARTIFACT_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return getFinalArtifactStatus(root);
  });
  handleIpc(IPC.FINAL_ARTIFACT_SELECT_DIRECTORY, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return selectFinalArtifactDirectory(root);
  });
  handleIpc(IPC.FINAL_ARTIFACT_LIST_IMAGES, (_e, root: unknown) => {
    validRoot(root);
    return listFinalArtifactImages(root);
  });
  handleIpc(IPC.FINAL_ARTIFACT_READ_IMAGE, (_e, root: unknown, imagePath: unknown) => {
    validRoot(root);
    if (typeof imagePath !== 'string') throw new Error('Invalid final artifact image path');
    return readFinalArtifactImage(root, imagePath);
  });
  handleIpc(IPC.FINAL_ARTIFACT_READ_PREVIEW, (_e, root: unknown, imagePath: unknown) => {
    validRoot(root);
    if (typeof imagePath !== 'string') throw new Error('Invalid final artifact image path');
    return readFinalArtifactPreview(root, imagePath);
  });
  handleIpc(IPC.CAPTION_STATUS, (_e, root: unknown) => {
    validRoot(root);
    return getCaptionStatus(root);
  });
  handleIpc(IPC.CAPTION_SELECT_SOURCE_DIRECTORY, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    await selectFinalArtifactDirectory(root);
    return getCaptionStatus(root);
  });
  handleIpc(IPC.CAPTION_IMPORT_GROK, async (_e, root: unknown, raw: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof raw !== 'string') throw new Error('Invalid Grok caption response');
    return importCaptionGrok(root, raw);
  });
  handleIpc(IPC.CAPTION_GENERATE, async (_e, root: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return generateCaption(root);
  });
  handleIpc(IPC.CAPTION_SAVE_PIXIV_TITLE, async (_e, root: unknown, title: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return savePixivTitle(root, title);
  });
  handleIpc(IPC.THUMBNAIL_FONTS, () => listThumbnailFonts());
  handleIpc(IPC.THUMBNAIL_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadThumbnailState(root);
  });
  handleIpc(IPC.THUMBNAIL_RESTORE_BACKUP, async (event, root: unknown) => {
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
  handleIpc(IPC.THUMBNAIL_INITIALIZE_CORRUPT, async (event, root: unknown) => {
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
  handleIpc(IPC.THUMBNAIL_SAVE, async (_e, root: unknown, state: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return saveThumbnailState(root, state);
  });
  handleIpc(IPC.THUMBNAIL_SELECT_IMAGE, async (_e, root: unknown) => {
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
  handleIpc(IPC.THUMBNAIL_LIST_IMAGES, async (event, root: unknown) => {
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
  handleIpc(IPC.THUMBNAIL_READ_IMAGE, (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return readThumbnailImage(imagePath);
  });
  handleIpc(IPC.THUMBNAIL_READ_PREVIEW, async (event, imagePath: unknown) => {
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
        const prune = thumbnailCachePruneMetrics(app.getPath('userData'));
        details.pruneRequests = prune.requests;
        details.pruneRuns = prune.runs;
        details.pruneCoalesced = prune.coalesced;
        details.pruneDeleted = prune.filesDeleted;
        details.pruneFailures = prune.deleteFailures;
        details.pruneLastMs = prune.lastDurationMs;
        details.pruneLastBytesAfter = prune.lastBytesAfter;
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
  handleIpc(IPC.THUMBNAIL_READ_EDITOR_IMAGE, async (_e, imagePath: unknown) => {
    if (typeof imagePath !== 'string') throw new Error('Invalid thumbnail image path');
    return (
      (await readCachedThumbnailImage(app.getPath('userData'), imagePath, 'editor')) ??
      readThumbnailImage(imagePath)
    );
  });
  handleIpc(IPC.THUMBNAIL_STORE_WEBP_PREVIEW, (_e, imagePath: unknown, dataUrl: unknown) => {
    if (typeof imagePath !== 'string' || typeof dataUrl !== 'string')
      throw new Error('Invalid thumbnail preview data');
    return storeWebpThumbnailPreview(app.getPath('userData'), imagePath, dataUrl);
  });
  handleIpc(IPC.THUMBNAIL_READ_TEMPLATE, (_e, pattern: unknown) =>
    readThumbnailTemplate(
      path.join(app.getAppPath(), 'dist-electron', 'thumbnail-templates'),
      pattern,
    ),
  );
  handleIpc(
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
  handleIpc(IPC.THUMBNAIL_PICKER_CONTEXT, (event) => {
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
  handleIpc(IPC.THUMBNAIL_PICKER_PERF_OPEN, async (event) => {
    thumbnailPickerForSender(event.sender);
    const directory = path.dirname(pickerPerformanceLogPath(app.getPath('userData')));
    await mkdir(directory, { recursive: true });
    const error = await shell.openPath(directory);
    if (error) throw new Error(error);
  });
  handleIpc(IPC.THUMBNAIL_PICKER_PERF, (event, name: unknown, metrics: unknown) => {
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
  handleIpc(IPC.THUMBNAIL_PICKER_PREVIEW, async (event, imagePath: unknown) => {
    const state = thumbnailPickerForSender(event.sender);
    const requestId = ++state.previewRequestId;
    const resolved = await validateThumbnailPickerImage(state, imagePath);
    if (requestId !== state.previewRequestId) throw new Error('新しい画像が選択されました。');
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const ready = state.selection.beginPreview(resolved);
    state.opener.send(IPC.THUMBNAIL_PICKER_PREVIEWED, {
      sessionId: state.sessionId,
      slot: state.slot,
      imagePath: resolved,
      previewGeneration: requestId,
    });
    return ready;
  });
  handleIpc(
    IPC.THUMBNAIL_PICKER_PREVIEW_RESULT,
    (
      event,
      sessionId: unknown,
      imagePath: unknown,
      generation: unknown,
      ok: unknown,
      message: unknown,
    ) => {
      const state = [...thumbnailPickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (
        !state ||
        generation !== state.previewRequestId ||
        typeof imagePath !== 'string' ||
        typeof ok !== 'boolean'
      )
        return false;
      return state.selection.previewResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
    },
  );
  handleIpc(IPC.THUMBNAIL_PICKER_COMMIT, async (event, imagePath: unknown) => {
    const state = thumbnailPickerForSender(event.sender);
    await ensureProjectWritable(state.root);
    const resolved = await validateThumbnailPickerImage(state, imagePath);
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const committed = state.selection.beginCommit(resolved);
    state.opener.send(IPC.THUMBNAIL_PICKER_COMMITTED, {
      sessionId: state.sessionId,
      slot: state.slot,
      imagePath: resolved,
    });
    await committed;
    state.committed = true;
    state.window.close();
  });
  handleIpc(
    IPC.THUMBNAIL_PICKER_COMMIT_RESULT,
    (event, sessionId: unknown, imagePath: unknown, ok: unknown, message: unknown) => {
      const state = [...thumbnailPickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (!state || typeof imagePath !== 'string' || typeof ok !== 'boolean') return false;
      const accepted = state.selection.commitResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
      if (accepted && ok) state.committed = true;
      return accepted;
    },
  );
  handleIpc(
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
  handleIpc(
    IPC.THUMBNAIL_DELETE_DOCUMENT,
    async (_e, root: unknown, id: unknown, expectedRevision: unknown, deleteOutputs: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      if (
        typeof id !== 'number' ||
        typeof expectedRevision !== 'number' ||
        typeof deleteOutputs !== 'boolean'
      )
        throw new Error('Invalid thumbnail deletion command');
      return deleteThumbnailDocument(root, id, expectedRevision, deleteOutputs);
    },
  );
  handleIpc(IPC.THUMBNAIL_DELETE_OUTPUTS, async (_e, root: unknown, documentId: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    if (typeof documentId !== 'number' || !Number.isSafeInteger(documentId) || documentId < 1)
      throw new Error('Invalid thumbnail document');
    return deleteThumbnailOutputs(root, documentId);
  });
  handleIpc(IPC.MARKETPLACE_LIST_THUMBNAILS, (_e, root: unknown) => {
    validRoot(root);
    return listExportedThumbnails(root);
  });
  handleIpc(
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
  handleIpc(
    IPC.MARKETPLACE_READ_SOURCE_PREVIEW,
    async (event, root: unknown, imagePath: unknown, sourceType: unknown) => {
      validRoot(root);
      if (
        typeof imagePath !== 'string' ||
        (sourceType !== 'thumbnail' && sourceType !== 'final-artifact')
      )
        throw new Error('Invalid marketplace source');
      const started = performance.now();
      const timing: ThumbnailCacheTiming = {};
      const source = await readMarketplaceSourcePreview(
        root,
        imagePath,
        sourceType,
        app.getPath('userData'),
        timing,
      );
      const picker = marketplacePickerWindows.get(event.sender.id);
      if (picker) {
        const metrics: PickerMetrics = {
          totalMs: performance.now() - started,
          cacheHit: timing.hit === true,
          transferKB: source ? (source.dataUrl.length * 0.75) / 1024 : 0,
          usedFallback: source?.dataUrl.startsWith('data:image/webp;base64,') === true,
        };
        for (const [key, value] of Object.entries(timing)) {
          if (typeof value === 'number' || typeof value === 'boolean') metrics[key] = value;
        }
        logThumbnailPickerPerformance(
          app.getPath('userData'),
          picker.sessionId,
          'marketplace_preview_read',
          metrics,
        );
      }
      return source;
    },
  );
  handleIpc(IPC.MARKETPLACE_TARGETS, () => getMarketplaceImageTargets());
  handleIpc(IPC.MARKETPLACE_LOAD, (_e, root: unknown) => {
    validRoot(root);
    return loadMarketplaceImageState(root);
  });
  handleIpc(IPC.MARKETPLACE_RESTORE_BACKUP, async (event, root: unknown) => {
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
  handleIpc(IPC.MARKETPLACE_INITIALIZE_CORRUPT, async (event, root: unknown) => {
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
  handleIpc(IPC.MARKETPLACE_SAVE, async (_e, root: unknown, state: unknown) => {
    validRoot(root);
    await ensureProjectWritable(root);
    return saveMarketplaceImageState(root, state);
  });
  handleIpc(
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
  handleIpc(
    IPC.MARKETPLACE_GENERATE_ZIP,
    async (_e, root: unknown, format: unknown, state: unknown) => {
      validRoot(root);
      await ensureProjectWritable(root);
      return generateMarketplaceZip(root, format, state);
    },
  );
  handleIpc(
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
  handleIpc(
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
        crop as MarketplaceCropRect,
        width,
        height,
        typeof sourcePngDataUrl === 'string' ? sourcePngDataUrl : undefined,
        sourceType as MarketplaceSourceType | undefined,
      );
    },
  );
  handleIpc(
    IPC.MARKETPLACE_PICKER_OPEN,
    (event, root: unknown, currentImagePath: unknown, sourceType: unknown) => {
      validRoot(root);
      if (typeof currentImagePath !== 'string') throw new Error('Invalid marketplace image path');
      if (sourceType !== 'thumbnail' && sourceType !== 'final-artifact')
        throw new Error('Invalid marketplace source');
      return openMarketplacePickerWindow(event.sender, root, currentImagePath, sourceType);
    },
  );
  handleIpc(IPC.MARKETPLACE_PICKER_CONTEXT, (event) => {
    const state = marketplacePickerForSender(event.sender);
    return {
      sessionId: state.sessionId,
      root: state.root,
      currentImagePath: state.currentImagePath,
      sourceType: state.sourceType,
    };
  });
  handleIpc(IPC.MARKETPLACE_PICKER_PREVIEW, async (event, imagePath: unknown) => {
    const state = marketplacePickerForSender(event.sender);
    const requestId = ++state.previewRequestId;
    const resolved = await validateMarketplacePickerImage(state, imagePath);
    if (requestId !== state.previewRequestId) throw new Error('新しい画像が選択されました。');
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const ready = state.selection.beginPreview(resolved);
    state.opener.send(IPC.MARKETPLACE_PICKER_PREVIEWED, {
      sessionId: state.sessionId,
      imagePath: resolved,
      previewGeneration: requestId,
    });
    return ready;
  });
  handleIpc(
    IPC.MARKETPLACE_PICKER_PREVIEW_RESULT,
    (
      event,
      sessionId: unknown,
      imagePath: unknown,
      generation: unknown,
      ok: unknown,
      message: unknown,
    ) => {
      const state = [...marketplacePickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (
        !state ||
        generation !== state.previewRequestId ||
        typeof imagePath !== 'string' ||
        typeof ok !== 'boolean'
      )
        return false;
      return state.selection.previewResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
    },
  );
  handleIpc(IPC.MARKETPLACE_PICKER_COMMIT, async (event, imagePath: unknown) => {
    const state = marketplacePickerForSender(event.sender);
    await ensureProjectWritable(state.root);
    const resolved = await validateMarketplacePickerImage(state, imagePath);
    if (state.opener.isDestroyed()) throw new Error('親Windowが閉じられました。');
    const committed = state.selection.beginCommit(resolved);
    state.opener.send(IPC.MARKETPLACE_PICKER_COMMITTED, {
      sessionId: state.sessionId,
      imagePath: resolved,
    });
    await committed;
    state.committed = true;
    state.window.close();
  });
  handleIpc(
    IPC.MARKETPLACE_PICKER_COMMIT_RESULT,
    (event, sessionId: unknown, imagePath: unknown, ok: unknown, message: unknown) => {
      const state = [...marketplacePickerWindows.values()].find(
        (item) => item.sessionId === sessionId && item.opener.id === event.sender.id,
      );
      if (!state || typeof imagePath !== 'string' || typeof ok !== 'boolean') return false;
      const accepted = state.selection.commitResult(
        imagePath,
        ok,
        typeof message === 'string' ? message : undefined,
      );
      if (accepted && ok) state.committed = true;
      return accepted;
    },
  );
}
