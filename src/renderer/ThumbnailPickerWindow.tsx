import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ThumbnailImageItem,
  ThumbnailImageSource,
  ThumbnailPickerContext,
} from '../shared/types';
import './thumbnail-stage.css';

type ThumbnailPickerSize = 'large' | 'medium' | 'small';

const rendererScriptStarted = performance.now();
type ImageLoadTiming = { ipcMs: number; decodeMs: number; totalMs: number; webpFallback: boolean };
function reportPickerTiming(event: string, metrics: Record<string, number | string | boolean>) {
  void window.batchStudio.thumbnail.logPickerPerf(event, metrics).catch(() => undefined);
}

export function ThumbnailPickerWindow() {
  const [context, setContext] = useState<ThumbnailPickerContext | null>(null);
  const [items, setItems] = useState<ThumbnailImageItem[]>([]);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<ThumbnailPickerSize>('medium');
  const [tentativePath, setTentativePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tentativeRef = useRef<string | null>(null);
  const selectionPhaseRef = useRef<
    'idle' | 'preview-loading' | 'preview-ready' | 'committing' | 'committed'
  >('idle');
  const selectionGenerationRef = useRef(0);
  const mountedAt = useRef(performance.now());
  const imageStats = useRef({ loaded: 0, totalIpcMs: 0, totalDecodeMs: 0, maxImageMs: 0 });
  const listReceivedAt = useRef(0);
  const onImageLoaded = (timing: ImageLoadTiming) => {
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

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? items.filter((item) => item.name.toLocaleLowerCase().includes(needle)) : items;
  }, [items, query]);

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
            if (!cancelled)
              reportPickerTiming('list_painted', {
                count: nextItems.length,
                renderMs: performance.now() - listReceivedAt.current,
                sinceMountMs: performance.now() - mountedAt.current,
              });
          }),
        );
      } catch (e) {
        if (!cancelled) {
          reportPickerTiming('list_error', { sinceMountMs: performance.now() - mountedAt.current });
          setError(e instanceof Error ? e.message : String(e));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading) return;
    const started = performance.now();
    reportPickerTiming('grid_changed', { displaySize: size, count: filteredItems.length });
    const first = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        reportPickerTiming('grid_painted', {
          displaySize: size,
          count: filteredItems.length,
          renderMs: performance.now() - started,
        }),
      ),
    );
    return () => cancelAnimationFrame(first);
  }, [size, filteredItems, loading]);

  const selectImage = (item: ThumbnailImageItem) => {
    setError('');
    if (tentativeRef.current === item.path) {
      if (selectionPhaseRef.current !== 'preview-ready') {
        if (selectionPhaseRef.current === 'preview-loading')
          setError('プレビューを読み込んでいます。表示後にもう一度選択してください。');
        return;
      }
      selectionPhaseRef.current = 'committing';
      void window.batchStudio.thumbnail
        .commitPicker(item.path)
        .then(() => {
          selectionPhaseRef.current = 'committed';
        })
        .catch((e: unknown) => {
          selectionPhaseRef.current = 'preview-ready';
          setError(e instanceof Error ? e.message : String(e));
        });
      return;
    }
    const generation = ++selectionGenerationRef.current;
    tentativeRef.current = item.path;
    selectionPhaseRef.current = 'preview-loading';
    setTentativePath(item.path);
    void window.batchStudio.thumbnail
      .previewPicker(item.path)
      .then(() => {
        if (selectionGenerationRef.current === generation)
          selectionPhaseRef.current = 'preview-ready';
      })
      .catch((e: unknown) => {
        if (selectionGenerationRef.current === generation) {
          tentativeRef.current = null;
          selectionPhaseRef.current = 'idle';
          setTentativePath('');
          setError(e instanceof Error ? e.message : String(e));
        }
      });
  };

  return (
    <main className="thumbnail-image-picker-page">
      <section className="thumbnail-image-picker thumbnail-image-picker-standalone">
        <header className="thumbnail-image-picker-head">
          <div>
            <span className="eyebrow">ComfyUI Batch Studio</span>
            <h1>サムネイル画像を選択</h1>
            <small>
              1回目の選択でプレビューへ仮適用し、同じ画像をもう一度選択すると確定してWindowを閉じます。
            </small>
          </div>
          {context && <span className="thumbnail-image-picker-slot">対象: {context.slot}</span>}
        </header>
        <div className="thumbnail-image-picker-toolbar">
          <input
            type="search"
            placeholder="ファイル名で絞り込み"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoFocus
          />
          <div className="thumbnail-image-picker-size" aria-label="画像表示サイズ">
            {(
              [
                ['large', '大'],
                ['medium', '中'],
                ['small', '小'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={size === value ? 'active' : ''}
                aria-pressed={size === value}
                onClick={() => setSize(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span>
            {filteredItems.length} / {items.length} 枚
          </span>
          <button
            type="button"
            title="計測ログが保存されるフォルダーを開く"
            onClick={() => {
              void window.batchStudio.thumbnail.openPickerPerfLog().catch(() => undefined);
            }}
          >
            計測ログを開く
          </button>
        </div>
        {error && <div className="thumbnail-image-picker-error">{error}</div>}
        {loading ? (
          <div className="thumbnail-image-picker-message">画像一覧を読み込んでいます…</div>
        ) : filteredItems.length ? (
          <div className={`thumbnail-image-picker-grid ${size}`}>
            {filteredItems.map((item) => (
              <ThumbnailPickerChoice
                key={item.path}
                item={item}
                tentative={tentativePath === item.path}
                current={context?.currentImagePath === item.path}
                onSelect={() => selectImage(item)}
                onImageLoaded={onImageLoaded}
              />
            ))}
          </div>
        ) : (
          <div className="thumbnail-image-picker-message">
            {items.length
              ? '条件に一致する画像はありません。'
              : '最終成果物ディレクトリに選択できる画像がありません。'}
          </div>
        )}
      </section>
    </main>
  );
}

function ThumbnailPickerChoice({
  item,
  tentative,
  current,
  onSelect,
  onImageLoaded,
}: {
  item: ThumbnailImageItem;
  tentative: boolean;
  current: boolean;
  onSelect: () => void;
  onImageLoaded: (timing: ImageLoadTiming) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<ThumbnailImageSource | null>(null);
  const [failed, setFailed] = useState(false);
  const loadTiming = useRef<{ started: number; ipcDone: number; webpFallback: boolean } | null>(
    null,
  );
  const alreadyReported = useRef(false);

  useEffect(() => {
    const element = buttonRef.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadTiming.current = { started: performance.now(), ipcDone: 0, webpFallback: false };
        void window.batchStudio.thumbnail
          .readPreview(item.path)
          .then((source) => {
            if (cancelled) return;
            if (loadTiming.current) loadTiming.current.ipcDone = performance.now();
            if (!source) {
              setFailed(true);
              return;
            }
            if (!source.dataUrl.startsWith('data:image/webp;')) {
              setPreview(source);
              return;
            }
            // On Electron builds without native WebP decoding, generate the first
            // preview in Chromium and persist only the 320px PNG for later windows.
            if (loadTiming.current) loadTiming.current.webpFallback = true;
            const image = new Image();
            image.onload = () => {
              if (cancelled) return;
              const ratio = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
              canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
              const context = canvas.getContext('2d');
              if (!context) {
                setFailed(true);
                return;
              }
              context.drawImage(image, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL('image/png');
              setPreview({ ...source, width: canvas.width, height: canvas.height, dataUrl });
              void window.batchStudio.thumbnail
                .storeWebpPreview(item.path, dataUrl)
                .catch(() => undefined);
            };
            image.onerror = () => {
              if (!cancelled) setFailed(true);
            };
            image.src = source.dataUrl;
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { rootMargin: '240px' },
    );
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [item.path]);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`thumbnail-image-choice${tentative ? ' selected' : ''}`}
      aria-pressed={tentative}
      title={item.name}
      onClick={onSelect}
    >
      <span className="thumbnail-image-choice-preview">
        {preview ? (
          <img
            src={preview.dataUrl}
            alt=""
            onLoad={() => {
              const timing = loadTiming.current;
              if (alreadyReported.current || !timing || !timing.ipcDone) return;
              alreadyReported.current = true;
              onImageLoaded({
                ipcMs: timing.ipcDone - timing.started,
                decodeMs: performance.now() - timing.ipcDone,
                totalMs: performance.now() - timing.started,
                webpFallback: timing.webpFallback,
              });
            }}
          />
        ) : (
          <span>{failed ? 'プレビューなし' : '読み込み中…'}</span>
        )}
      </span>
      <span className="thumbnail-image-choice-name">{item.name}</span>
      {tentative ? (
        <span className="thumbnail-image-choice-current">仮適用中・もう一度で確定</span>
      ) : current ? (
        <span className="thumbnail-image-choice-current committed">現在</span>
      ) : null}
    </button>
  );
}
