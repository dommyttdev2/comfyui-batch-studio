import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ThumbnailImageItem,
  ThumbnailImageSource,
  ThumbnailPickerContext,
} from '../shared/types';
import './thumbnail-stage.css';

type ThumbnailPickerSize = 'large' | 'medium' | 'small';

export function ThumbnailPickerWindow() {
  const [context, setContext] = useState<ThumbnailPickerContext | null>(null);
  const [items, setItems] = useState<ThumbnailImageItem[]>([]);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<ThumbnailPickerSize>('medium');
  const [tentativePath, setTentativePath] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tentativeRef = useRef<string | null>(null);

  const filteredItems = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? items.filter((item) => item.name.toLocaleLowerCase().includes(needle)) : items;
  }, [items, query]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const nextContext = await window.batchStudio.thumbnail.pickerContext();
        const nextItems = await window.batchStudio.thumbnail.listImages(nextContext.root);
        if (cancelled) return;
        setContext(nextContext);
        setItems(nextItems);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectImage = (item: ThumbnailImageItem) => {
    setError('');
    if (tentativeRef.current === item.path) {
      void window.batchStudio.thumbnail
        .commitPicker(item.path)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
      return;
    }
    tentativeRef.current = item.path;
    setTentativePath(item.path);
    void window.batchStudio.thumbnail.previewPicker(item.path).catch((e: unknown) => {
      if (tentativeRef.current === item.path) {
        tentativeRef.current = null;
        setTentativePath('');
      }
      setError(e instanceof Error ? e.message : String(e));
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
}: {
  item: ThumbnailImageItem;
  tentative: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<ThumbnailImageSource | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = buttonRef.current;
    if (!element) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void window.batchStudio.thumbnail
          .readPreview(item.path)
          .then((source) => {
            if (cancelled) return;
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
          <img src={preview.dataUrl} alt="" />
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
