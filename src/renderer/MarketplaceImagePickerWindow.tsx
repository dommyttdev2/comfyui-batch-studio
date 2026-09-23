import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FinalArtifactImageItem,
  FinalArtifactImageSource,
  MarketplacePickerContext,
  MarketplaceSourceType,
} from '../shared/types';
import './thumbnail-stage.css';

type PickerSize = 'large' | 'medium' | 'small';

export function MarketplaceImagePickerWindow() {
  const [context, setContext] = useState<MarketplacePickerContext | null>(null);
  const [items, setItems] = useState<FinalArtifactImageItem[]>([]);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState<PickerSize>('medium');
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
        const nextContext = await window.batchStudio.marketplace.pickerContext();
        const nextItems =
          nextContext.sourceType === 'thumbnail'
            ? await window.batchStudio.marketplace.listThumbnailImages(nextContext.root)
            : await window.batchStudio.finalArtifact.listImages(nextContext.root);
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

  const selectImage = (item: FinalArtifactImageItem) => {
    setError('');
    if (tentativeRef.current === item.path) {
      void window.batchStudio.marketplace
        .commitPicker(item.path)
        .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
      return;
    }
    tentativeRef.current = item.path;
    setTentativePath(item.path);
    void window.batchStudio.marketplace.previewPicker(item.path).catch((e: unknown) => {
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
            <h1>販売サイト用画像を選択</h1>
            <small>
              {context?.sourceType === 'thumbnail' ? '出力済みサムネイル' : '最終成果物'}
              から選択します。1回目でプレビューへ仮適用し、同じ画像をもう一度選択すると確定してWindowを閉じます。
            </small>
          </div>
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
              <MarketplacePickerChoice
                key={item.path}
                root={context?.root ?? ''}
                sourceType={context?.sourceType ?? 'final-artifact'}
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
              : context?.sourceType === 'thumbnail'
                ? '出力済みのサムネイルがありません。サムネイル工程で画像を出力してください。'
                : '最終成果物ディレクトリに選択できる画像がありません。'}
          </div>
        )}
      </section>
    </main>
  );
}

function MarketplacePickerChoice({
  root,
  sourceType,
  item,
  tentative,
  current,
  onSelect,
}: {
  root: string;
  sourceType: MarketplaceSourceType;
  item: FinalArtifactImageItem;
  tentative: boolean;
  current: boolean;
  onSelect: () => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<FinalArtifactImageSource | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = buttonRef.current;
    if (!element || !root) return;
    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        void window.batchStudio.marketplace
          .readSourcePreview(root, item.path, sourceType)
          .then((source) => {
            if (cancelled) return;
            if (source) setPreview(source);
            else setFailed(true);
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
  }, [item.path, root, sourceType]);

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
