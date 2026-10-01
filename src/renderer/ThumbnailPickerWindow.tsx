import { useEffect, useRef, useState } from 'react';
import type { ThumbnailImageItem, ThumbnailPickerContext } from '../shared/types';
import { ImagePickerGrid } from './ImagePickerGrid';
import type { ImagePickerLoadTiming, ImagePickerProvider } from './ImagePickerGrid';
import './thumbnail-stage.css';

const rendererScriptStarted = performance.now();

function reportPickerTiming(event: string, metrics: Record<string, number | string | boolean>) {
  void window.batchStudio.thumbnail.logPickerPerf(event, metrics).catch(() => undefined);
}

export function ThumbnailPickerWindow() {
  const [context, setContext] = useState<ThumbnailPickerContext | null>(null);
  const [items, setItems] = useState<ThumbnailImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const mountedAt = useRef(performance.now());
  const imageStats = useRef({ loaded: 0, totalIpcMs: 0, totalDecodeMs: 0, maxImageMs: 0 });
  const listReceivedAt = useRef(0);

  const onImageLoaded = (timing: ImagePickerLoadTiming) => {
    const stats = imageStats.current;
    stats.loaded++;
    stats.totalIpcMs += timing.ipcMs;
    stats.totalDecodeMs += timing.decodeMs;
    stats.maxImageMs = Math.max(stats.maxImageMs, timing.totalMs);
    if (
      stats.loaded === 1 ||
      stats.loaded === 5 ||
      stats.loaded === 10 ||
      stats.loaded === 20 ||
      stats.loaded === 50 ||
      stats.loaded % 100 === 0
    ) {
      reportPickerTiming('images_loaded', {
        loaded: stats.loaded,
        sinceMountMs: performance.now() - mountedAt.current,
        averageIpcMs: stats.totalIpcMs / stats.loaded,
        averageDecodeMs: stats.totalDecodeMs / stats.loaded,
        maxImageMs: stats.maxImageMs,
        webpFallback: timing.webpFallback,
      });
    }
    if (stats.loaded === 1) {
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          reportPickerTiming('first_image_painted', {
            sinceMountMs: performance.now() - mountedAt.current,
            imageIpcMs: timing.ipcMs,
            imageDecodeMs: timing.decodeMs,
          }),
        ),
      );
    }
  };

  useEffect(() => {
    let cancelled = false;
    reportPickerTiming('renderer_mounted', {
      sinceScriptMs: performance.now() - rendererScriptStarted,
    });
    void (async () => {
      try {
        const contextStarted = performance.now();
        const nextContext = await window.batchStudio.thumbnail.pickerContext();
        const contextMs = performance.now() - contextStarted;
        const listStarted = performance.now();
        const nextItems = await window.batchStudio.thumbnail.listImages(nextContext.root);
        const listIpcMs = performance.now() - listStarted;
        if (cancelled) return;
        listReceivedAt.current = performance.now();
        reportPickerTiming('list_received', {
          contextMs,
          listIpcMs,
          count: nextItems.length,
          sinceMountMs: listReceivedAt.current - mountedAt.current,
        });
        setContext(nextContext);
        setItems(nextItems);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!cancelled) {
              reportPickerTiming('list_painted', {
                count: nextItems.length,
                renderMs: performance.now() - listReceivedAt.current,
                sinceMountMs: performance.now() - mountedAt.current,
              });
            }
          }),
        );
      } catch (cause) {
        if (!cancelled) {
          reportPickerTiming('list_error', { sinceMountMs: performance.now() - mountedAt.current });
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const provider: ImagePickerProvider<ThumbnailImageItem> = {
    currentImagePath: context?.currentImagePath ?? '',
    sourceType: 'thumbnail',
    preview: (path) => window.batchStudio.thumbnail.previewPicker(path),
    commit: (path) => window.batchStudio.thumbnail.commitPicker(path),
    readPreview: (item) => window.batchStudio.thumbnail.readPreview(item.path),
    persistWebpPreview: (path, dataUrl) =>
      window.batchStudio.thumbnail.storeWebpPreview(path, dataUrl),
  };

  return (
    <ImagePickerGrid
      title="サムネイル画像を選択"
      description="1回目の選択でプレビューへ仮適用し、同じ画像をもう一度選択すると確定してWindowを閉じます。"
      badge={
        context ? (
          <span className="thumbnail-image-picker-slot">対象: {context.slot}</span>
        ) : undefined
      }
      items={items}
      loading={loading}
      emptyMessage="最終成果物ディレクトリに選択できる画像がありません。"
      provider={provider}
      externalError={error}
      toolbarExtra={
        <button
          type="button"
          title="計測ログが保存されるフォルダーを開く"
          onClick={() => {
            void window.batchStudio.thumbnail.openPickerPerfLog().catch(() => undefined);
          }}
        >
          計測ログを開く
        </button>
      }
      onMetrics={(visible, total, size) =>
        reportPickerTiming('virtual_rows', { visible, total, displaySize: size })
      }
      onGridChanged={(size, count) =>
        reportPickerTiming('grid_changed', { displaySize: size, count })
      }
      onGridPainted={(size, count, renderMs) =>
        reportPickerTiming('grid_painted', { displaySize: size, count, renderMs })
      }
      onImageLoaded={onImageLoaded}
    />
  );
}
