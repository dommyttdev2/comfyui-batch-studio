import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { VirtualPickerGrid } from './VirtualPickerGrid';
import type { PickerGridSize } from './VirtualPickerGrid';

export interface ImagePickerItem {
  path: string;
  name: string;
}

export interface ImagePickerSource extends ImagePickerItem {
  width: number;
  height: number;
  dataUrl: string;
}

export interface ImagePickerProvider<TItem extends ImagePickerItem> {
  currentImagePath: string;
  sourceType: string;
  preview: (path: string) => Promise<unknown>;
  commit: (path: string) => Promise<unknown>;
  readPreview: (item: TItem) => Promise<ImagePickerSource | null>;
  persistWebpPreview?: (path: string, dataUrl: string) => Promise<unknown>;
}

export interface ImagePickerLoadTiming {
  ipcMs: number;
  decodeMs: number;
  totalMs: number;
  webpFallback: boolean;
}

export function useImagePickerSession<TItem extends ImagePickerItem>(
  items: TItem[],
  provider: ImagePickerProvider<TItem>,
) {
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<PickerGridSize>('medium');
  const [tentativePath, setTentativePath] = useState('');
  const [error, setError] = useState('');
  const tentativeRef = useRef<string | null>(null);
  const selectionPhaseRef = useRef<
    'idle' | 'preview-loading' | 'preview-ready' | 'committing' | 'committed'
  >('idle');
  const selectionGenerationRef = useRef(0);
  const providerRef = useRef(provider);
  providerRef.current = provider;

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? items.filter((item) => item.name.toLocaleLowerCase().includes(needle)) : items;
  }, [items, query]);

  const selectImage = (item: TItem) => {
    setError('');
    if (tentativeRef.current === item.path) {
      if (selectionPhaseRef.current !== 'preview-ready') {
        if (selectionPhaseRef.current === 'preview-loading') {
          setError('プレビューを読み込んでいます。表示後にもう一度選択してください。');
        }
        return;
      }
      selectionPhaseRef.current = 'committing';
      void providerRef.current
        .commit(item.path)
        .then(() => {
          selectionPhaseRef.current = 'committed';
        })
        .catch((cause: unknown) => {
          selectionPhaseRef.current = 'preview-ready';
          setError(cause instanceof Error ? cause.message : String(cause));
        });
      return;
    }

    const generation = ++selectionGenerationRef.current;
    tentativeRef.current = item.path;
    selectionPhaseRef.current = 'preview-loading';
    setTentativePath(item.path);
    void providerRef.current
      .preview(item.path)
      .then(() => {
        if (selectionGenerationRef.current === generation) {
          selectionPhaseRef.current = 'preview-ready';
        }
      })
      .catch((cause: unknown) => {
        if (selectionGenerationRef.current !== generation) return;
        tentativeRef.current = null;
        selectionPhaseRef.current = 'idle';
        setTentativePath('');
        setError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  return {
    query,
    setQuery,
    size,
    setSize,
    tentativePath,
    error,
    setError,
    filteredItems,
    selectImage,
  };
}

export function ImagePickerGrid<TItem extends ImagePickerItem>({
  title,
  description,
  badge,
  items,
  loading,
  emptyMessage,
  provider,
  toolbarExtra,
  externalError,
  onMetrics,
  onGridChanged,
  onGridPainted,
  onImageLoaded,
}: {
  title: string;
  description: ReactNode;
  badge?: ReactNode;
  items: TItem[];
  loading: boolean;
  emptyMessage: string;
  provider: ImagePickerProvider<TItem>;
  toolbarExtra?: ReactNode;
  externalError?: string;
  onMetrics?: (visible: number, total: number, size: PickerGridSize) => void;
  onGridChanged?: (size: PickerGridSize, count: number) => void;
  onGridPainted?: (size: PickerGridSize, count: number, renderMs: number) => void;
  onImageLoaded?: (timing: ImagePickerLoadTiming) => void;
}) {
  const session = useImagePickerSession(items, provider);

  useEffect(() => {
    if (loading) return;
    const started = performance.now();
    onGridChanged?.(session.size, session.filteredItems.length);
    const first = requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        onGridPainted?.(session.size, session.filteredItems.length, performance.now() - started),
      ),
    );
    return () => cancelAnimationFrame(first);
  }, [loading, session.size, session.filteredItems, onGridChanged, onGridPainted]);

  return (
    <main className="thumbnail-image-picker-page">
      <section className="thumbnail-image-picker thumbnail-image-picker-standalone">
        <header className="thumbnail-image-picker-head">
          <div>
            <span className="eyebrow">ComfyUI Batch Studio</span>
            <h1>{title}</h1>
            <small>{description}</small>
          </div>
          {badge}
        </header>
        <div className="thumbnail-image-picker-toolbar">
          <input
            type="search"
            placeholder="ファイル名で絞り込み"
            value={session.query}
            onChange={(event) => session.setQuery(event.target.value)}
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
                className={session.size === value ? 'active' : ''}
                aria-pressed={session.size === value}
                onClick={() => session.setSize(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <span>
            {session.filteredItems.length} / {items.length} 枚
          </span>
          {toolbarExtra}
        </div>
        {(externalError || session.error) && (
          <div className="thumbnail-image-picker-error">{externalError || session.error}</div>
        )}
        {loading ? (
          <div className="thumbnail-image-picker-message">画像一覧を読み込んでいます…</div>
        ) : session.filteredItems.length ? (
          <VirtualPickerGrid
            items={session.filteredItems}
            size={session.size}
            activePath={session.tentativePath || provider.currentImagePath}
            onMetrics={onMetrics ? (visible, total) => onMetrics(visible, total, session.size) : undefined}
            renderItem={(item) => (
              <ImagePickerChoice
                provider={provider}
                item={item}
                tentative={session.tentativePath === item.path}
                current={provider.currentImagePath === item.path}
                onSelect={() => session.selectImage(item)}
                onImageLoaded={onImageLoaded}
              />
            )}
          />
        ) : (
          <div className="thumbnail-image-picker-message">
            {items.length ? '条件に一致する画像はありません。' : emptyMessage}
          </div>
        )}
      </section>
    </main>
  );
}

function ImagePickerChoice<TItem extends ImagePickerItem>({
  provider,
  item,
  tentative,
  current,
  onSelect,
  onImageLoaded,
}: {
  provider: ImagePickerProvider<TItem>;
  item: TItem;
  tentative: boolean;
  current: boolean;
  onSelect: () => void;
  onImageLoaded?: (timing: ImagePickerLoadTiming) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<ImagePickerSource | null>(null);
  const [failed, setFailed] = useState(false);
  const loadTiming = useRef<{ started: number; ipcDone: number; webpFallback: boolean } | null>(
    null,
  );
  const alreadyReported = useRef(false);
  const providerRef = useRef(provider);
  providerRef.current = provider;

  useEffect(() => {
    const element = buttonRef.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadTiming.current = { started: performance.now(), ipcDone: 0, webpFallback: false };
        void providerRef.current
          .readPreview(item)
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

            if (loadTiming.current) loadTiming.current.webpFallback = true;
            const image = new Image();
            image.onload = () => {
              if (cancelled) return;
              const ratio = Math.min(1, 320 / Math.max(image.naturalWidth, image.naturalHeight));
              const canvas = document.createElement('canvas');
              canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
              canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
              const drawing = canvas.getContext('2d');
              if (!drawing) {
                setFailed(true);
                return;
              }
              drawing.drawImage(image, 0, 0, canvas.width, canvas.height);
              const dataUrl = canvas.toDataURL('image/png');
              setPreview({ ...source, width: canvas.width, height: canvas.height, dataUrl });
              void providerRef.current
                .persistWebpPreview?.(item.path, dataUrl)
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
  }, [item]);

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
              if (alreadyReported.current || !timing || !timing.ipcDone || !onImageLoaded) return;
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
