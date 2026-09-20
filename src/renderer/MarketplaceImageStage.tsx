import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  FinalArtifactImageSource,
  FinalArtifactStatus,
  MarketplaceCropRect,
  MarketplaceImageEditorState,
  MarketplaceImageTarget,
  ProjectSummary,
} from '../shared/types';
import { MarketplacePickerGeneration } from '../shared/marketplace-picker-generation';
import type { Runner } from './ui';
import './marketplace-image-stage.css';

const PRESETS = [
  [512, 512],
  [768, 768],
  [1024, 1024],
  [1280, 720],
  [1920, 1080],
  [1080, 1920],
] as const;

type DragState = { pointerId: number; x: number; y: number };

function fitCrop(
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): MarketplaceCropRect {
  const targetAspect = outputWidth / outputHeight;
  const sourceAspect = sourceWidth / sourceHeight;
  const width = sourceAspect > targetAspect ? sourceHeight * targetAspect : sourceWidth;
  const height = sourceAspect > targetAspect ? sourceHeight : sourceWidth / targetAspect;
  return {
    x: (sourceWidth - width) / 2,
    y: (sourceHeight - height) / 2,
    width,
    height,
  };
}

function clampCrop(
  crop: MarketplaceCropRect,
  sourceWidth: number,
  sourceHeight: number,
  outputWidth: number,
  outputHeight: number,
): MarketplaceCropRect {
  const fit = fitCrop(sourceWidth, sourceHeight, outputWidth, outputHeight);
  const aspect = outputWidth / outputHeight;
  let width = Math.max(fit.width / 5, Math.min(fit.width, crop.width));
  let height = width / aspect;
  if (height > fit.height) {
    height = Math.max(fit.height / 5, Math.min(fit.height, crop.height));
    width = height * aspect;
  }
  const x = Math.max(0, Math.min(sourceWidth - width, crop.x));
  const y = Math.max(0, Math.min(sourceHeight - height, crop.y));
  return { x, y, width, height };
}

function normalizeCrop(
  crop: MarketplaceCropRect | null,
  source: FinalArtifactImageSource,
  outputWidth: number,
  outputHeight: number,
) {
  return crop
    ? clampCrop(crop, source.width, source.height, outputWidth, outputHeight)
    : fitCrop(source.width, source.height, outputWidth, outputHeight);
}

function loadBrowserImage(source: FinalArtifactImageSource) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${source.name} をプレビューできませんでした。`));
    image.src = source.dataUrl;
  });
}

function browserSizedSource(source: FinalArtifactImageSource, image: HTMLImageElement) {
  const width = source.width > 0 ? source.width : image.naturalWidth;
  const height = source.height > 0 ? source.height : image.naturalHeight;
  if (width < 1 || height < 1)
    throw new Error(`${source.name} の画像サイズを取得できませんでした。`);
  return { ...source, width, height };
}

function normalizedWebpSourcePng(source: FinalArtifactImageSource, image: HTMLImageElement) {
  if (!source.path.toLocaleLowerCase().endsWith('.webp')) return undefined;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('WebP入力画像の正規化Canvasを作成できませんでした。');
  context.drawImage(image, 0, 0, source.width, source.height);
  return canvas.toDataURL('image/png');
}

function encodePngAsWebp(dataUrl: string, width: number, height: number) {
  return new Promise<string>((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('WebP出力用Canvasを作成できませんでした。'));
        return;
      }
      context.drawImage(image, 0, 0, width, height);
      resolve(canvas.toDataURL('image/webp', 1));
    };
    image.onerror = () => reject(new Error('Lanczos変換後画像をWebPへ変換できませんでした。'));
    image.src = dataUrl;
  });
}

function targetLabel(target: MarketplaceImageTarget) {
  return `${target.service} / ${target.label}`;
}

export function MarketplaceImageStage({ project, run }: { project: ProjectSummary; run: Runner }) {
  const [targets, setTargets] = useState<MarketplaceImageTarget[]>([]);
  const [state, setState] = useState<MarketplaceImageEditorState | null>(null);
  const [source, setSource] = useState<FinalArtifactImageSource | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [finalArtifact, setFinalArtifact] = useState<FinalArtifactStatus | null>(null);
  const [notice, setNotice] = useState('');
  const [lastPath, setLastPath] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const pickerSessionRef = useRef<string | null>(null);
  const pickerBeforeStateRef = useRef<MarketplaceImageEditorState | null>(null);
  const pickerBeforeMediaRef = useRef<{
    source: FinalArtifactImageSource | null;
    image: HTMLImageElement | null;
  } | null>(null);
  const pickerReadyPreviewRef = useRef<{
    path: string;
    state: MarketplaceImageEditorState;
  } | null>(null);
  const pickerGenerationRef = useRef(new MarketplacePickerGeneration());
  const pickerOpeningRef = useRef(false);
  const pickerCommitPendingRef = useRef(false);

  const activeTarget = useMemo(
    () => targets.find((target) => target.id === state?.activeTargetId) ?? targets[0] ?? null,
    [state?.activeTargetId, targets],
  );
  const activeWidth = state?.mode === 'custom' ? state.custom.width : (activeTarget?.width ?? 1);
  const activeHeight = state?.mode === 'custom' ? state.custom.height : (activeTarget?.height ?? 1);
  const activeCrop =
    state?.mode === 'custom'
      ? state.custom.crop
      : activeTarget
        ? (state?.targets[activeTarget.id]?.crop ?? null)
        : null;

  const setCrop = (crop: MarketplaceCropRect) => {
    if (!state) return;
    if (state.mode === 'custom') {
      setState({ ...state, custom: { ...state.custom, crop } });
      return;
    }
    if (!activeTarget) return;
    setState({
      ...state,
      targets: {
        ...state.targets,
        [activeTarget.id]: { crop },
      },
    });
  };

  const applySource = async (
    imagePath: string,
    baseState: MarketplaceImageEditorState,
    targetDefinitions: MarketplaceImageTarget[],
    preserveExisting: boolean,
    isCurrent: () => boolean = () => true,
  ): Promise<MarketplaceImageEditorState | null> => {
    const nextSource = await window.batchStudio.finalArtifact.readImage(
      project.rootPath,
      imagePath,
    );
    if (!isCurrent()) return null;
    if (!nextSource) throw new Error('選択した画像を読み込めませんでした。');
    const nextImage = await loadBrowserImage(nextSource);
    if (!isCurrent()) return null;
    const sizedSource = browserSizedSource(nextSource, nextImage);
    const nextTargets: MarketplaceImageEditorState['targets'] = {};
    for (const target of targetDefinitions) {
      nextTargets[target.id] = {
        crop: normalizeCrop(
          preserveExisting ? (baseState.targets[target.id]?.crop ?? null) : null,
          sizedSource,
          target.width,
          target.height,
        ),
      };
    }
    const customCrop = normalizeCrop(
      preserveExisting ? baseState.custom.crop : null,
      sizedSource,
      baseState.custom.width,
      baseState.custom.height,
    );
    const nextState = {
      ...baseState,
      sourceImagePath: nextSource.path,
      targets: nextTargets,
      custom: { ...baseState.custom, crop: customCrop },
    };
    if (!isCurrent()) return null;
    setSource(sizedSource);
    setImage(nextImage);
    setState(nextState);
    return nextState;
  };

  useEffect(() => {
    let cancelled = false;
    const loadToken = pickerGenerationRef.current.invalidate();
    const isCurrent = () => !cancelled && pickerGenerationRef.current.isCurrent(loadToken);
    void run(async () => {
      const [nextTargets, nextState, nextFinalArtifact] = await Promise.all([
        window.batchStudio.marketplace.targets(),
        window.batchStudio.marketplace.load(project.rootPath),
        window.batchStudio.finalArtifact.status(project.rootPath),
      ]);
      if (!isCurrent()) return;
      setTargets(nextTargets);
      setFinalArtifact(nextFinalArtifact);
      setState(nextState);
      if (!nextState.sourceImagePath) return;
      try {
        const nextSource = await window.batchStudio.finalArtifact.readImage(
          project.rootPath,
          nextState.sourceImagePath,
        );
        if (!nextSource || !isCurrent()) return;
        const nextImage = await loadBrowserImage(nextSource);
        if (!isCurrent()) return;
        const sizedSource = browserSizedSource(nextSource, nextImage);
        const normalizedTargets: MarketplaceImageEditorState['targets'] = {};
        for (const target of nextTargets)
          normalizedTargets[target.id] = {
            crop: normalizeCrop(
              nextState.targets[target.id]?.crop ?? null,
              sizedSource,
              target.width,
              target.height,
            ),
          };
        setSource(sizedSource);
        setImage(nextImage);
        setState({
          ...nextState,
          targets: normalizedTargets,
          custom: {
            ...nextState.custom,
            crop: normalizeCrop(
              nextState.custom.crop,
              sizedSource,
              nextState.custom.width,
              nextState.custom.height,
            ),
          },
        });
      } catch {
        if (isCurrent()) {
          setSource(null);
          setImage(null);
          setState({ ...nextState, sourceImagePath: '' });
        }
      }
    });
    return () => {
      cancelled = true;
      pickerGenerationRef.current.invalidate();
    };
  }, [project.rootPath]);

  useEffect(() => {
    if (!state || pickerSessionRef.current || pickerOpeningRef.current || pickerCommitPendingRef.current)
      return;
    const timer = window.setTimeout(() => {
      if (pickerSessionRef.current || pickerOpeningRef.current || pickerCommitPendingRef.current)
        return;
      void window.batchStudio.marketplace.save(project.rootPath, state).catch(() => {});
    }, 250);
    return () => window.clearTimeout(timer);
  }, [project.rootPath, state]);

  useEffect(() => {
    const removePreview = window.batchStudio.marketplace.onPickerPreview((selection) => {
      const token = pickerGenerationRef.current.preview(selection.sessionId);
      const base = pickerBeforeStateRef.current ?? state;
      if (token === null || !base) return;
      pickerReadyPreviewRef.current = null;
      const isCurrent = () =>
        pickerGenerationRef.current.isPreviewCurrent(selection.sessionId, token);
      void run(async () => {
        const nextState = await applySource(selection.imagePath, base, targets, false, isCurrent);
        if (!nextState || !isCurrent()) return;
        pickerReadyPreviewRef.current = { path: selection.imagePath, state: nextState };
        setNotice('画像を仮適用しています。同じ画像をもう一度選択すると確定します。');
      });
    });
    const removeCommit = window.batchStudio.marketplace.onPickerCommit((selection) => {
      const token = pickerGenerationRef.current.commit(selection.sessionId);
      if (token === null) return;
      const ready = pickerReadyPreviewRef.current;
      const before = pickerBeforeStateRef.current;
      pickerSessionRef.current = null;
      pickerBeforeStateRef.current = null;
      pickerBeforeMediaRef.current = null;
      pickerReadyPreviewRef.current = null;
      pickerCommitPendingRef.current = true;
      const isCurrent = () => pickerGenerationRef.current.isCurrent(token);
      void run(async () => {
        try {
          const base =
            before ?? state ?? (await window.batchStudio.marketplace.load(project.rootPath));
          if (!isCurrent()) return;
          const nextState =
            ready?.path === selection.imagePath
              ? state?.sourceImagePath === selection.imagePath
                ? state
                : ready.state
              : await applySource(selection.imagePath, base, targets, false, isCurrent);
          if (!nextState || !isCurrent()) return;
          await window.batchStudio.marketplace.save(project.rootPath, nextState);
          if (!isCurrent()) return;
          setNotice(
            '入力画像を確定しました。4種類のクロップは新しい画像に合わせてリセットしました。',
          );
        } finally {
          pickerCommitPendingRef.current = false;
        }
      });
    });
    const removeCancel = window.batchStudio.marketplace.onPickerCancel((session) => {
      const token = pickerGenerationRef.current.cancel(session.sessionId);
      if (token === null) return;
      const before = pickerBeforeStateRef.current;
      const beforeMedia = pickerBeforeMediaRef.current;
      pickerSessionRef.current = null;
      pickerBeforeStateRef.current = null;
      pickerBeforeMediaRef.current = null;
      pickerReadyPreviewRef.current = null;
      if (!before) return;
      setState(before);
      if (beforeMedia?.source && beforeMedia.image) {
        setSource(beforeMedia.source);
        setImage(beforeMedia.image);
        setNotice('画像選択をキャンセルし、元の画像へ戻しました。');
        return;
      }
      setSource(null);
      setImage(null);
      if (!before.sourceImagePath) {
        setNotice('画像選択をキャンセルしました。');
        return;
      }
      void run(async () => {
        const restored = await window.batchStudio.finalArtifact.readImage(
          project.rootPath,
          before.sourceImagePath,
        );
        if (!restored || !pickerGenerationRef.current.isCurrent(token)) return;
        const restoredImage = await loadBrowserImage(restored);
        if (!pickerGenerationRef.current.isCurrent(token)) return;
        setSource(browserSizedSource(restored, restoredImage));
        setImage(restoredImage);
        setNotice('画像選択をキャンセルし、元の画像へ戻しました。');
      });
    });
    return () => {
      removePreview();
      removeCommit();
      removeCancel();
    };
  }, [project.rootPath, state, targets]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#080a0d';
    context.fillRect(0, 0, canvas.width, canvas.height);
    if (!source || !image || !activeCrop) return;

    const padding = 28;
    const scale = Math.min(
      (canvas.width - padding * 2) / source.width,
      (canvas.height - padding * 2) / source.height,
    );
    const imageWidth = source.width * scale;
    const imageHeight = source.height * scale;
    const originX = (canvas.width - imageWidth) / 2;
    const originY = (canvas.height - imageHeight) / 2;
    context.drawImage(image, originX, originY, imageWidth, imageHeight);
    context.fillStyle = 'rgba(0,0,0,.58)';
    context.fillRect(originX, originY, imageWidth, imageHeight);

    const cropX = originX + activeCrop.x * scale;
    const cropY = originY + activeCrop.y * scale;
    const cropWidth = activeCrop.width * scale;
    const cropHeight = activeCrop.height * scale;
    context.save();
    context.beginPath();
    context.rect(cropX, cropY, cropWidth, cropHeight);
    context.clip();
    context.drawImage(image, originX, originY, imageWidth, imageHeight);
    context.restore();

    context.strokeStyle = '#ffffff';
    context.lineWidth = 2;
    context.strokeRect(cropX, cropY, cropWidth, cropHeight);
    context.strokeStyle = 'rgba(255,255,255,.65)';
    context.lineWidth = 1;
    for (const ratio of [1 / 3, 2 / 3]) {
      context.beginPath();
      context.moveTo(cropX + cropWidth * ratio, cropY);
      context.lineTo(cropX + cropWidth * ratio, cropY + cropHeight);
      context.stroke();
      context.beginPath();
      context.moveTo(cropX, cropY + cropHeight * ratio);
      context.lineTo(cropX + cropWidth, cropY + cropHeight * ratio);
      context.stroke();
    }
  }, [activeCrop, image, source]);

  const canvasToSource = (event: {
    clientX: number;
    clientY: number;
    currentTarget: HTMLCanvasElement;
  }) => {
    if (!source) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * event.currentTarget.width;
    const y = ((event.clientY - rect.top) / rect.height) * event.currentTarget.height;
    const padding = 28;
    const scale = Math.min(
      (event.currentTarget.width - padding * 2) / source.width,
      (event.currentTarget.height - padding * 2) / source.height,
    );
    const originX = (event.currentTarget.width - source.width * scale) / 2;
    const originY = (event.currentTarget.height - source.height * scale) / 2;
    return { x: (x - originX) / scale, y: (y - originY) / scale };
  };

  const moveCrop = (dx: number, dy: number) => {
    if (!source || !activeCrop) return;
    setCrop(
      clampCrop(
        { ...activeCrop, x: activeCrop.x + dx, y: activeCrop.y + dy },
        source.width,
        source.height,
        activeWidth,
        activeHeight,
      ),
    );
  };

  const setZoom = (zoom: number, anchor?: { x: number; y: number }) => {
    if (!source || !activeCrop) return;
    const fit = fitCrop(source.width, source.height, activeWidth, activeHeight);
    const nextZoom = Math.max(1, Math.min(5, zoom));
    const width = fit.width / nextZoom;
    const height = fit.height / nextZoom;
    const point = anchor ?? {
      x: activeCrop.x + activeCrop.width / 2,
      y: activeCrop.y + activeCrop.height / 2,
    };
    const rx = activeCrop.width > 0 ? (point.x - activeCrop.x) / activeCrop.width : 0.5;
    const ry = activeCrop.height > 0 ? (point.y - activeCrop.y) / activeCrop.height : 0.5;
    setCrop(
      clampCrop(
        {
          x: point.x - width * rx,
          y: point.y - height * ry,
          width,
          height,
        },
        source.width,
        source.height,
        activeWidth,
        activeHeight,
      ),
    );
  };

  const zoom =
    source && activeCrop
      ? Math.max(
          1,
          Math.min(
            5,
            fitCrop(source.width, source.height, activeWidth, activeHeight).width /
              activeCrop.width,
          ),
        )
      : 1;

  const openPicker = () => {
    if (!state || pickerOpeningRef.current || pickerSessionRef.current || pickerCommitPendingRef.current)
      return;
    const openingToken = pickerGenerationRef.current.invalidate();
    pickerOpeningRef.current = true;
    pickerBeforeStateRef.current = state;
    pickerBeforeMediaRef.current = { source, image };
    pickerReadyPreviewRef.current = null;
    void run(async () => {
      try {
        const session = await window.batchStudio.marketplace.openPicker(
          project.rootPath,
          state.sourceImagePath,
        );
        if (!pickerGenerationRef.current.isCurrent(openingToken)) return;
        pickerSessionRef.current = session.sessionId;
        pickerGenerationRef.current.begin(session.sessionId);
      } finally {
        pickerOpeningRef.current = false;
      }
    });
  };

  const updateCustomSize = (dimension: 'width' | 'height', raw: number) => {
    if (!state) return;
    const value = Math.max(1, Math.min(20000, Math.round(raw || 1)));
    const currentRatio = state.custom.width / state.custom.height;
    const width =
      dimension === 'width'
        ? value
        : state.custom.lockAspect
          ? Math.max(1, Math.round(value * currentRatio))
          : state.custom.width;
    const height =
      dimension === 'height'
        ? value
        : state.custom.lockAspect
          ? Math.max(1, Math.round(value / currentRatio))
          : state.custom.height;
    const custom = {
      ...state.custom,
      width,
      height,
      crop: source ? fitCrop(source.width, source.height, width, height) : null,
    };
    setState({ ...state, custom });
  };

  const applyPreset = (width: number, height: number) => {
    if (!state) return;
    setState({
      ...state,
      custom: {
        ...state.custom,
        width,
        height,
        crop: source ? fitCrop(source.width, source.height, width, height) : null,
      },
    });
  };

  const generate = () =>
    void run(async () => {
      if (!state || !source || !image) return;
      const sourcePngDataUrl = normalizedWebpSourcePng(source, image);
      let webpDataUrls: Record<string, string> | undefined;
      if (state.format === 'webp') {
        webpDataUrls = {};
        for (const target of targets) {
          const crop = state.targets[target.id]?.crop;
          if (!crop) throw new Error(`${targetLabel(target)} のクロップを設定してください。`);
          const png = await window.batchStudio.marketplace.renderPng(
            project.rootPath,
            state.sourceImagePath,
            crop,
            target.width,
            target.height,
            sourcePngDataUrl,
          );
          webpDataUrls[target.id] = await encodePngAsWebp(png, target.width, target.height);
        }
      }
      const result = await window.batchStudio.marketplace.generate(
        project.rootPath,
        state,
        webpDataUrls,
        sourcePngDataUrl,
      );
      setLastPath(result.outputPaths.at(-1) ?? result.outputDirectory);
      setNotice(`4種類を生成しました: ${result.outputDirectory}`);
    });

  const generateZip = () =>
    void run(async () => {
      if (!state) return;
      if (pickerSessionRef.current)
        throw new Error('画像選択を確定してからZIPを生成してください。');
      const result = await window.batchStudio.marketplace.generateZip(
        project.rootPath,
        state.format,
        state,
      );
      setLastPath(result.zipPath ?? result.outputDirectory);
      setNotice(`ZIPを生成しました: ${result.zipPath}`);
    });

  const exportCustom = () =>
    void run(async () => {
      if (!state || !source || !image || !state.custom.crop) return;
      const sourcePngDataUrl = normalizedWebpSourcePng(source, image);
      const webp =
        state.format === 'webp'
          ? await encodePngAsWebp(
              await window.batchStudio.marketplace.renderPng(
                project.rootPath,
                state.sourceImagePath,
                state.custom.crop,
                state.custom.width,
                state.custom.height,
                sourcePngDataUrl,
              ),
              state.custom.width,
              state.custom.height,
            )
          : undefined;
      const result = await window.batchStudio.marketplace.exportCustom(
        project.rootPath,
        state,
        webp,
        sourcePngDataUrl,
      );
      setLastPath(result.outputPaths[0] ?? result.outputDirectory);
      setNotice(`カスタム画像を生成しました: ${result.outputPaths[0]}`);
    });

  if (!state || !finalArtifact)
    return <div className="panel">販売サイト用画像の編集データを読み込んでいます…</div>;

  if (finalArtifact.state !== 'ready')
    return (
      <section className="panel">
        <h3>販売サイト用画像</h3>
        <p>
          この工程は「最終成果物」工程で指定した画像を入力にします。サムネイル工程の生成物は使用しません。
        </p>
        <div className="issue warning">
          ⚠ 最終成果物ディレクトリを設定し、対象画像を1枚以上用意してください。
        </div>
      </section>
    );

  const groupedServices = [...new Set(targets.map((target) => target.service))];

  return (
    <div className="marketplace-stage">
      <section className="marketplace-preview-panel">
        <div className="marketplace-preview-head">
          <div>
            <h3>プレビュー</h3>
            <small>
              最終成果物の元画像から直接クロップします。ドラッグで移動、ホイールで拡大できます。
            </small>
          </div>
          <button className="primary" onClick={openPicker}>
            最終成果物から画像を選択
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width={1100}
          height={760}
          onPointerDown={(event) => {
            if (!activeCrop || event.button !== 0) return;
            const point = canvasToSource(event);
            if (
              !point ||
              point.x < activeCrop.x ||
              point.x > activeCrop.x + activeCrop.width ||
              point.y < activeCrop.y ||
              point.y > activeCrop.y + activeCrop.height
            )
              return;
            dragRef.current = { pointerId: event.pointerId, x: point.x, y: point.y };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId || !(event.buttons & 1)) return;
            const point = canvasToSource(event);
            if (!point) return;
            moveCrop(point.x - drag.x, point.y - drag.y);
            dragRef.current = { pointerId: drag.pointerId, x: point.x, y: point.y };
          }}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onWheel={(event) => {
            if (!activeCrop) return;
            event.preventDefault();
            const anchor = canvasToSource(event);
            setZoom(zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08), anchor ?? undefined);
          }}
        />
        <div className="marketplace-preview-facts">
          <span>
            元画像 <b>{source ? `${source.width} × ${source.height}` : '未選択'}</b>
          </span>
          <span>
            Crop{' '}
            <b>
              {activeCrop
                ? `${Math.round(activeCrop.width)} × ${Math.round(activeCrop.height)}`
                : '-'}
            </b>
          </span>
          <span>
            Output{' '}
            <b>
              {activeWidth} × {activeHeight}
            </b>
          </span>
        </div>
        {notice && <p className="marketplace-notice">{notice}</p>}
      </section>

      <aside className="marketplace-inspector">
        <section className="panel">
          <h3>入力画像</h3>
          <p className="marketplace-path">{state.sourceImagePath || '画像未選択'}</p>
          <button className="primary" onClick={openPicker}>
            画像一覧から選択
          </button>
          <small>入力元: {finalArtifact.directory}（サムネイル工程の出力は参照しません）</small>
        </section>

        <section className="panel">
          <h3>出力モード</h3>
          <div className="marketplace-mode-buttons">
            <button
              className={state.mode === 'marketplace' ? 'active' : ''}
              onClick={() => setState({ ...state, mode: 'marketplace' })}
            >
              販売サイト
            </button>
            <button
              className={state.mode === 'custom' ? 'active' : ''}
              onClick={() => setState({ ...state, mode: 'custom' })}
            >
              カスタム
            </button>
          </div>
        </section>

        {state.mode === 'marketplace' ? (
          <section className="panel">
            <h3>販売サイトプリセット</h3>
            {groupedServices.map((service) => (
              <div key={service} className="marketplace-service-group">
                <b>{service}</b>
                <div className="marketplace-target-grid">
                  {targets
                    .filter((target) => target.service === service)
                    .map((target) => (
                      <button
                        key={target.id}
                        className={target.id === activeTarget?.id ? 'active' : ''}
                        onClick={() => setState({ ...state, activeTargetId: target.id })}
                      >
                        <span>{target.label}</span>
                        <small>
                          {target.width} × {target.height}
                        </small>
                      </button>
                    ))}
                </div>
              </div>
            ))}
          </section>
        ) : (
          <section className="panel">
            <h3>カスタム出力</h3>
            <div className="marketplace-size-grid">
              <label>
                幅
                <input
                  type="number"
                  min="1"
                  max="20000"
                  value={state.custom.width}
                  onChange={(event) => updateCustomSize('width', Number(event.target.value))}
                />
              </label>
              <label>
                高さ
                <input
                  type="number"
                  min="1"
                  max="20000"
                  value={state.custom.height}
                  onChange={(event) => updateCustomSize('height', Number(event.target.value))}
                />
              </label>
            </div>
            <label className="marketplace-inline-check">
              <input
                type="checkbox"
                checked={state.custom.lockAspect}
                onChange={(event) =>
                  setState({
                    ...state,
                    custom: { ...state.custom, lockAspect: event.target.checked },
                  })
                }
              />
              アスペクト比を固定
            </label>
            <div className="marketplace-preset-grid">
              {PRESETS.map(([width, height]) => (
                <button key={`${width}x${height}`} onClick={() => applyPreset(width, height)}>
                  {width} × {height}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="panel">
          <h3>クロップ</h3>
          <label>
            拡大率 {Math.round(zoom * 100)}%
            <input
              type="range"
              min="100"
              max="500"
              step="1"
              value={Math.round(zoom * 100)}
              disabled={!activeCrop}
              onChange={(event) => setZoom(Number(event.target.value) / 100)}
            />
          </label>
          <div className="marketplace-row">
            <button
              disabled={!source}
              onClick={() =>
                source && setCrop(fitCrop(source.width, source.height, activeWidth, activeHeight))
              }
            >
              フィット
            </button>
            <button
              disabled={!source || !activeCrop}
              onClick={() => {
                if (!source || !activeCrop) return;
                setCrop(
                  clampCrop(
                    {
                      ...activeCrop,
                      x: (source.width - activeCrop.width) / 2,
                      y: (source.height - activeCrop.height) / 2,
                    },
                    source.width,
                    source.height,
                    activeWidth,
                    activeHeight,
                  ),
                );
              }}
            >
              中央
            </button>
          </div>
        </section>

        <section className="panel marketplace-export">
          <h3>画像出力</h3>
          <label>
            形式
            <select
              value={state.format}
              onChange={(event) =>
                setState({
                  ...state,
                  format: event.target.value as MarketplaceImageEditorState['format'],
                })
              }
            >
              <option value="jpeg">JPEG（品質100）</option>
              <option value="png">PNG</option>
              <option value="webp">WebP（品質100）</option>
            </select>
          </label>
          {state.mode === 'marketplace' ? (
            <>
              <button className="primary" disabled={!source} onClick={generate}>
                4種類を生成
              </button>
              <button disabled={!source} onClick={generateZip}>
                ZIPを生成
              </button>
            </>
          ) : (
            <button className="primary" disabled={!source} onClick={exportCustom}>
              カスタム画像を生成
            </button>
          )}
          {lastPath && (
            <button onClick={() => window.batchStudio.file.showInFolder(lastPath)}>
              出力先を開く
            </button>
          )}
        </section>
      </aside>
    </div>
  );
}
