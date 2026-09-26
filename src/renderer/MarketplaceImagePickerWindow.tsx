import { useEffect, useState } from 'react';
import type { FinalArtifactImageItem, MarketplacePickerContext } from '../shared/types';
import { ImagePickerGrid } from './ImagePickerGrid';
import type { ImagePickerProvider } from './ImagePickerGrid';
import './thumbnail-stage.css';

export function MarketplaceImagePickerWindow() {
  const [context, setContext] = useState<MarketplacePickerContext | null>(null);
  const [items, setItems] = useState<FinalArtifactImageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const provider: ImagePickerProvider<FinalArtifactImageItem> = {
    currentImagePath: context?.currentImagePath ?? '',
    sourceType: context?.sourceType ?? 'final-artifact',
    preview: (path) => window.batchStudio.marketplace.previewPicker(path),
    commit: (path) => window.batchStudio.marketplace.commitPicker(path),
    readPreview: (item) =>
      context
        ? window.batchStudio.marketplace.readSourcePreview(
            context.root,
            item.path,
            context.sourceType,
          )
        : Promise.resolve(null),
    persistWebpPreview: (path, dataUrl) =>
      window.batchStudio.thumbnail.storeWebpPreview(path, dataUrl),
  };

  const sourceLabel = context?.sourceType === 'thumbnail' ? '出力済みサムネイル' : '最終成果物';
  const emptyMessage =
    context?.sourceType === 'thumbnail'
      ? '出力済みのサムネイルがありません。サムネイル工程で画像を出力してください。'
      : '最終成果物ディレクトリに選択できる画像がありません。';

  return (
    <ImagePickerGrid
      title="販売サイト用画像を選択"
      description={
        <>
          {sourceLabel}
          から選択します。1回目でプレビューへ仮適用し、同じ画像をもう一度選択すると確定してWindowを閉じます。
        </>
      }
      items={items}
      loading={loading}
      emptyMessage={emptyMessage}
      provider={provider}
      externalError={error}
    />
  );
}
