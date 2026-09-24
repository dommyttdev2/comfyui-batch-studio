import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Layer } from 'ag-psd';
import type {
  ProjectSummary,
  ThumbnailDocument,
  ThumbnailEditorState,
  ThumbnailImageSource,
  ThumbnailPattern,
  ThumbnailSlotKey,
  ThumbnailTextState,
} from '../shared/types';
import { useEditorAutosave } from './use-editor-autosave';
import { cachedEditorImage } from './thumbnail-image-memory-cache';
import type { Runner } from './ui';
import './thumbnail-stage.css';

const WIDTH = 1600;
const HEIGHT = 1200;
const LINE_WIDTH = 22;
const LEFT_TOP_X = 320;
const LEFT_BOTTOM_X = 560;
const RIGHT_TOP_X = 1280;
const RIGHT_BOTTOM_X = 1040;
const SIDE_SPLIT_OUTER_Y = 490;
const SIDE_SPLIT_INNER_Y = 590;
const LEFT_MID_X = Math.round(
  LEFT_TOP_X + (LEFT_BOTTOM_X - LEFT_TOP_X) * (SIDE_SPLIT_INNER_Y / HEIGHT),
);
const RIGHT_MID_X = Math.round(
  RIGHT_TOP_X + (RIGHT_BOTTOM_X - RIGHT_TOP_X) * (SIDE_SPLIT_INNER_Y / HEIGHT),
);

type Point = [number, number];
type LoadedImages = Record<string, HTMLImageElement>;
type TemplateOverlay = { psdName: string };

const PATTERN_LABELS: Record<ThumbnailPattern, string> = {
  '3-images': '3枚',
  '4-images-left-split': '4枚（左を上下分割）',
  '4-images-right-split': '4枚（右を上下分割）',
  '5-images-both-split': '5枚（左右を上下分割）',
};
const SLOT_LABELS: Record<ThumbnailSlotKey, string> = {
  LEFT: '左',
  LEFT_TOP: '左上',
  LEFT_BOTTOM: '左下',
  CENTER_MAIN: '中央',
  RIGHT: '右',
  RIGHT_TOP: '右上',
  RIGHT_BOTTOM: '右下',
};

function slotsFor(pattern: ThumbnailPattern): ThumbnailSlotKey[] {
  const left: ThumbnailSlotKey[] =
    pattern === '4-images-left-split' || pattern === '5-images-both-split'
      ? ['LEFT_TOP', 'LEFT_BOTTOM']
      : ['LEFT'];
  const right: ThumbnailSlotKey[] =
    pattern === '4-images-right-split' || pattern === '5-images-both-split'
      ? ['RIGHT_TOP', 'RIGHT_BOTTOM']
      : ['RIGHT'];
  return [...left, 'CENTER_MAIN', ...right];
}

function polygonFor(slot: ThumbnailSlotKey): Point[] {
  const polygons: Record<ThumbnailSlotKey, Point[]> = {
    LEFT: [
      [0, 0],
      [LEFT_TOP_X, 0],
      [LEFT_BOTTOM_X, HEIGHT],
      [0, HEIGHT],
    ],
    LEFT_TOP: [
      [0, 0],
      [LEFT_TOP_X, 0],
      [LEFT_MID_X, SIDE_SPLIT_INNER_Y],
      [0, SIDE_SPLIT_OUTER_Y],
    ],
    LEFT_BOTTOM: [
      [0, SIDE_SPLIT_OUTER_Y],
      [LEFT_MID_X, SIDE_SPLIT_INNER_Y],
      [LEFT_BOTTOM_X, HEIGHT],
      [0, HEIGHT],
    ],
    CENTER_MAIN: [
      [LEFT_TOP_X, 0],
      [RIGHT_TOP_X, 0],
      [RIGHT_BOTTOM_X, HEIGHT],
      [LEFT_BOTTOM_X, HEIGHT],
    ],
    RIGHT: [
      [RIGHT_TOP_X, 0],
      [WIDTH, 0],
      [WIDTH, HEIGHT],
      [RIGHT_BOTTOM_X, HEIGHT],
    ],
    RIGHT_TOP: [
      [RIGHT_TOP_X, 0],
      [WIDTH, 0],
      [WIDTH, SIDE_SPLIT_OUTER_Y],
      [RIGHT_MID_X, SIDE_SPLIT_INNER_Y],
    ],
    RIGHT_BOTTOM: [
      [RIGHT_MID_X, SIDE_SPLIT_INNER_Y],
      [WIDTH, SIDE_SPLIT_OUTER_Y],
      [WIDTH, HEIGHT],
      [RIGHT_BOTTOM_X, HEIGHT],
    ],
  };
  return polygons[slot];
}

function tracePolygon(context: CanvasRenderingContext2D, polygon: Point[]) {
  context.beginPath();
  polygon.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.closePath();
}

function polygonBounds(points: Point[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects =
      yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function drawSlot(
  context: CanvasRenderingContext2D,
  document: ThumbnailDocument,
  slot: ThumbnailSlotKey,
  images: LoadedImages,
) {
  const polygon = polygonFor(slot);
  const bounds = polygonBounds(polygon);
  context.save();
  tracePolygon(context, polygon);
  context.clip();
  const state = document.slots[slot];
  const image = state?.imagePath ? images[state.imagePath] : undefined;
  if (image) {
    const cover = Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight);
    const scale = cover * (state?.scale ?? 1);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    const centerX = bounds.left + bounds.width / 2 + (state?.offsetX ?? 0);
    const centerY = bounds.top + bounds.height / 2 + (state?.offsetY ?? 0);
    context.drawImage(image, centerX - width / 2, centerY - height / 2, width, height);
  } else {
    const gradient = context.createLinearGradient(
      bounds.left,
      bounds.top,
      bounds.left + bounds.width,
      bounds.top + bounds.height,
    );
    gradient.addColorStop(0, slot === 'CENTER_MAIN' ? '#713448' : '#3d304a');
    gradient.addColorStop(1, '#171321');
    context.fillStyle = gradient;
    context.fillRect(bounds.left, bounds.top, bounds.width, bounds.height);
    context.fillStyle = 'rgba(255,255,255,.72)';
    context.font = '600 32px "Segoe UI", sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      `${SLOT_LABELS[slot]}：画像を選択`,
      bounds.left + bounds.width / 2,
      bounds.top + bounds.height / 2,
    );
  }
  context.restore();
}

function drawText(
  context: CanvasRenderingContext2D,
  text: ThumbnailTextState,
  strokeWidth: number,
) {
  if (!text.text) return;
  context.save();
  context.font = `${text.fontSize}px "${text.fontFamily}", serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  context.strokeStyle = 'rgba(0,0,0,.55)';
  context.lineWidth = strokeWidth;
  context.strokeText(text.text, text.x, text.y);
  context.fillStyle = text.color;
  context.fillText(text.text, text.x, text.y);
  context.restore();
}

export function renderThumbnail(
  canvas: HTMLCanvasElement,
  document: ThumbnailDocument,
  images: LoadedImages,
  template?: TemplateOverlay,
) {
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = '#0c0c10';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  for (const slot of slotsFor(document.pattern)) drawSlot(context, document, slot, images);

  // The PSD is validated before use, while these two overlays are redrawn from
  // its canonical values. Some PSD readers flatten transparent RGB layers onto
  // opaque black, which would otherwise cover every image after parsing.
  void template;
  context.strokeStyle = '#fff';
  context.lineWidth = LINE_WIDTH;
  context.lineCap = 'butt';
  context.beginPath();
  context.moveTo(LEFT_TOP_X, 0);
  context.lineTo(LEFT_BOTTOM_X, HEIGHT);
  context.moveTo(RIGHT_TOP_X, 0);
  context.lineTo(RIGHT_BOTTOM_X, HEIGHT);
  if (document.pattern === '4-images-left-split' || document.pattern === '5-images-both-split') {
    context.moveTo(0, SIDE_SPLIT_OUTER_Y);
    context.lineTo(LEFT_MID_X, SIDE_SPLIT_INNER_Y);
  }
  if (document.pattern === '4-images-right-split' || document.pattern === '5-images-both-split') {
    context.moveTo(RIGHT_MID_X, SIDE_SPLIT_INNER_Y);
    context.lineTo(WIDTH, SIDE_SPLIT_OUTER_Y);
  }
  context.stroke();

  const gradientStart = Math.round(HEIGHT * 0.67);
  const overlay = context.createLinearGradient(0, gradientStart, 0, HEIGHT);
  for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
    const alpha = (220 / 255) * ratio ** 1.35;
    overlay.addColorStop(ratio, `rgba(3,6,14,${alpha})`);
  }
  context.fillStyle = overlay;
  context.fillRect(0, gradientStart, WIDTH, HEIGHT - gradientStart);

  drawText(context, document.title, 7);
  drawText(context, document.subtitle, 3);
  if (document.subtitle.text) {
    context.save();
    context.font = `${document.subtitle.fontSize}px "${document.subtitle.fontFamily}", serif`;
    const textWidth = context.measureText(document.subtitle.text).width;
    const gap = 40;
    const length = 175;
    context.strokeStyle = document.subtitle.color;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(document.subtitle.x - textWidth / 2 - gap - length, document.subtitle.y);
    context.lineTo(document.subtitle.x - textWidth / 2 - gap, document.subtitle.y);
    context.moveTo(document.subtitle.x + textWidth / 2 + gap, document.subtitle.y);
    context.lineTo(document.subtitle.x + textWidth / 2 + gap + length, document.subtitle.y);
    context.stroke();
    context.restore();
  }
}

function loadBrowserImage(source: ThumbnailImageSource) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`${source.name} を読み込めませんでした。`));
    image.src = source.dataUrl;
  });
}

function findLayer(children: Layer[] | undefined, name: string): Layer | null {
  for (const layer of children ?? []) {
    if (layer.name === name) return layer;
    const nested = findLayer(layer.children, name);
    if (nested) return nested;
  }
  return null;
}

async function loadPsdOverlay(pattern: ThumbnailPattern): Promise<TemplateOverlay> {
  const { readPsd } = await import('ag-psd');
  const source = await window.batchStudio.thumbnail.readTemplate(pattern);
  const response = await fetch(source.dataUrl);
  const psd = readPsd(await response.arrayBuffer(), {
    skipLayerImageData: true,
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  if (psd.width !== WIDTH || psd.height !== HEIGHT)
    throw new Error(`${source.name} のキャンバスサイズが1600×1200ではありません。`);
  const divider = findLayer(psd.children, '02_DIVIDERS__WHITE_22PX');
  const gradient = findLayer(psd.children, '03_BOTTOM_GRADIENT__ABOVE_DIVIDERS');
  if (!divider || !gradient)
    throw new Error(`${source.name} に必要な分割線・グラデーションレイヤーがありません。`);
  return { psdName: source.name };
}

export function ThumbnailStage({ project, run }: { project: ProjectSummary; run: Runner }) {
  const [state, setState] = useState<ThumbnailEditorState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [fontFamilies, setFontFamilies] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteOutputFiles, setDeleteOutputFiles] = useState(false);
  const [deleteWarning, setDeleteWarning] = useState('');
  const [selectedSlot, setSelectedSlot] = useState<ThumbnailSlotKey>('CENTER_MAIN');
  const [images, setImages] = useState<LoadedImages>({});
  const [templates, setTemplates] = useState<Partial<Record<ThumbnailPattern, TemplateOverlay>>>(
    {},
  );
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [notice, setNotice] = useState('');
  const [lastExportPath, setLastExportPath] = useState('');
  const [pickerSession, setPickerSession] = useState<{
    sessionId: string;
    slot: ThumbnailSlotKey;
  } | null>(null);
  const [pickerPreview, setPickerPreview] = useState<{
    sessionId: string;
    slot: ThumbnailSlotKey;
    imagePath: string;
  } | null>(null);
  const pickerSessionRef = useRef<typeof pickerSession>(null);
  const pickerPreviewPathRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    slot: ThumbnailSlotKey;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    moved: boolean;
  } | null>(null);
  const loadedStateRef = useRef(false);
  const currentStateRef = useRef<ThumbnailEditorState | null>(null);
  currentStateRef.current = state;
  const { saveStatus, saveError, saveNow, retrySave } = useEditorAutosave(
    project.rootPath,
    'thumbnail',
    state,
    loadedStateRef.current,
    false,
    500,
  );

  const active = useMemo(
    () => state?.documents.find((item) => item.id === state.activeDocumentId) ?? null,
    [state],
  );
  const visibleSlots = active ? slotsFor(active.pattern) : [];
  const displayActive = useMemo(() => {
    if (!active || !pickerPreview) return active;
    return {
      ...active,
      slots: {
        ...active.slots,
        [pickerPreview.slot]: {
          imagePath: pickerPreview.imagePath,
          offsetX: 0,
          offsetY: 0,
          scale: 1,
        },
      },
    };
  }, [active, pickerPreview]);

  useEffect(() => {
    let cancelled = false;
    void window.batchStudio.thumbnail
      .fonts()
      .then((fonts) => {
        if (!cancelled) setFontFamilies(fonts);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadedStateRef.current = false;
    setState(null);
    void window.batchStudio.thumbnail
      .load(project.rootPath)
      .then((loaded) => {
        if (cancelled) return;
        setState(loaded);
        setLoadError('');
        // Do not block the editor on images belonging to other documents.
        loadedStateRef.current = true;
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [project.rootPath]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const paths = [
      ...new Set(
        slotsFor(active.pattern)
          .map((slot) => active.slots[slot]?.imagePath)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    void Promise.all(
      paths.map(async (imagePath) => {
        try {
          const source = await window.batchStudio.thumbnail.readEditorImage(imagePath);
          if (!source) throw new Error('画像を読み込めませんでした。');
          const image = await cachedEditorImage(source);
          if (!cancelled) setImages((current) => ({ ...current, [source.path]: image }));
        } catch {
          if (!cancelled)
            setImages((current) => {
              const next = { ...current };
              delete next[imagePath];
              return next;
            });
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [project.rootPath, active?.id, active?.pattern, active?.slots]);

  // Prepare images for the remaining documents after the active document is displayed.
  useEffect(() => {
    if (!state || !active) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const paths = [
        ...new Set(
          state.documents
            .filter((document) => document.id !== active.id)
            .flatMap((document) => Object.values(document.slots).map((slot) => slot.imagePath))
            .filter(Boolean),
        ),
      ];
      void (async () => {
        for (const imagePath of paths) {
          if (cancelled) break;
          try {
            const source = await window.batchStudio.thumbnail.readEditorImage(imagePath);
            if (!source) continue;
            const image = await cachedEditorImage(source);
            if (!cancelled) setImages((current) => ({ ...current, [source.path]: image }));
          } catch {
            /* A missing image must not block the active editor. */
          }
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [project.rootPath, state?.documents, active?.id]);

  const fullResolutionImages = async (document: ThumbnailDocument): Promise<LoadedImages> => {
    const entries = await Promise.all(
      [
        ...new Set(
          slotsFor(document.pattern)
            .map((slot) => document.slots[slot]?.imagePath)
            .filter((value): value is string => Boolean(value)),
        ),
      ].map(async (imagePath) => {
        const source = await window.batchStudio.thumbnail.readImage(imagePath);
        if (!source) throw new Error(`出力用の元画像を読み込めませんでした: ${imagePath}`);
        return [source.path, await loadBrowserImage(source)] as const;
      }),
    );
    return Object.fromEntries(entries);
  };

  useEffect(() => {
    if (!displayActive || !canvasRef.current) return;
    renderThumbnail(canvasRef.current, displayActive, images, templates[displayActive.pattern]);
  }, [displayActive, images, templates]);

  useEffect(() => {
    if (!active || templates[active.pattern]) return;
    let cancelled = false;
    void run(async () => {
      const overlay = await loadPsdOverlay(active.pattern);
      if (!cancelled) setTemplates((current) => ({ ...current, [active.pattern]: overlay }));
    });
    return () => {
      cancelled = true;
    };
  }, [active?.pattern]);

  useEffect(() => {
    if (active && !visibleSlots.includes(selectedSlot)) setSelectedSlot('CENTER_MAIN');
  }, [active?.pattern]);

  const addDocument = () => {
    setState((current) => {
      if (!current) return current;
      const id = Math.max(
        current.nextDocumentId ?? 1,
        ...current.documents.map((document) => document.id + 1),
      );
      if (!Number.isSafeInteger(id)) return current;
      const previous = current.documents[current.documents.length - 1];
      const document: ThumbnailDocument = {
        id,
        pattern: '5-images-both-split',
        slots: {},
        title: { ...previous.title, text: `Scene ${String(id).padStart(2, '0')}` },
        subtitle: { ...previous.subtitle, text: 'Midnight Elegance' },
      };
      return {
        ...current,
        activeDocumentId: id,
        nextDocumentId: id + 1,
        documents: [...current.documents, document],
      };
    });
    setDeletingId(null);
  };
  const confirmDeleteDocument = () =>
    void run(async () => {
      if (!state || deletingId === null || state.documents.length <= 1) return;
      const index = state.documents.findIndex((document) => document.id === deletingId);
      if (index < 0) return;
      const documents = state.documents.filter((document) => document.id !== deletingId);
      const next: ThumbnailEditorState = {
        ...state,
        documents,
        activeDocumentId:
          state.activeDocumentId === deletingId
            ? (documents[index]?.id ?? documents[index - 1]?.id ?? documents[0].id)
            : state.activeDocumentId,
      };
      await saveNow(next);
      setState(next);
      if (deleteOutputFiles)
        await window.batchStudio.thumbnail.deleteOutputs(project.rootPath, deletingId);
      setDeletingId(null);
      setDeleteOutputFiles(false);
      setDeleteWarning('');
      setNotice(`サムネイル ${String(deletingId).padStart(2, '0')} を削除しました。`);
    });
  const updateDocument = (update: (document: ThumbnailDocument) => ThumbnailDocument) => {
    setState(
      (current) =>
        current && {
          ...current,
          documents: current.documents.map((document) =>
            document.id === current.activeDocumentId ? update(document) : document,
          ),
        },
    );
  };
  const updateSlot = (
    slot: ThumbnailSlotKey,
    patch: Partial<ThumbnailDocument['slots'][ThumbnailSlotKey]>,
  ) => {
    updateDocument((document) => ({
      ...document,
      slots: {
        ...document.slots,
        [slot]: {
          imagePath: '',
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          ...document.slots[slot],
          ...patch,
        },
      },
    }));
  };
  const moveSlot = (slot: ThumbnailSlotKey, offsetX: number, offsetY: number) => {
    updateDocument((document) => {
      const current = document.slots[slot] ?? {
        imagePath: '',
        offsetX: 0,
        offsetY: 0,
        scale: 1,
      };
      return {
        ...document,
        slots: {
          ...document.slots,
          [slot]: {
            ...current,
            offsetX: current.offsetX + offsetX,
            offsetY: current.offsetY + offsetY,
          },
        },
      };
    });
  };
  useEffect(() => {
    const removePreview = window.batchStudio.thumbnail.onPickerPreview((selection) => {
      const session = pickerSessionRef.current;
      if (
        !session ||
        session.sessionId !== selection.sessionId ||
        session.slot !== selection.slot
      ) {
        void window.batchStudio.thumbnail
          .previewResult(
            selection.sessionId,
            selection.imagePath,
            selection.previewGeneration ?? -1,
            false,
            '画像選択セッションが終了しました。',
          )
          .catch(() => undefined);
        return;
      }
      pickerPreviewPathRef.current = selection.imagePath;
      void (async () => {
        try {
          const source = await window.batchStudio.thumbnail.readEditorImage(selection.imagePath);
          if (!source) throw new Error('画像を読み込めませんでした。');
          const image = await cachedEditorImage(source);
          if (
            pickerSessionRef.current?.sessionId !== selection.sessionId ||
            pickerPreviewPathRef.current !== selection.imagePath
          )
            return;
          setImages((current) => ({ ...current, [source.path]: image }));
          setPickerPreview(selection);
          await new Promise<void>((resolve) =>
            window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
          );
          if (pickerPreviewPathRef.current !== selection.imagePath) return;
          await window.batchStudio.thumbnail.previewResult(
            selection.sessionId,
            selection.imagePath,
            selection.previewGeneration ?? -1,
            true,
          );
        } catch (error) {
          await window.batchStudio.thumbnail
            .previewResult(
              selection.sessionId,
              selection.imagePath,
              selection.previewGeneration ?? -1,
              false,
              error instanceof Error ? error.message : String(error),
            )
            .catch(() => undefined);
          if (pickerPreviewPathRef.current === selection.imagePath) setPickerPreview(null);
        }
      })();
    });
    const removeCommit = window.batchStudio.thumbnail.onPickerCommit((selection) => {
      const session = pickerSessionRef.current;
      if (
        !session ||
        session.sessionId !== selection.sessionId ||
        session.slot !== selection.slot
      ) {
        void window.batchStudio.thumbnail
          .commitResult(
            selection.sessionId,
            selection.imagePath,
            false,
            '画像選択セッションが終了しました。',
          )
          .catch(() => undefined);
        return;
      }
      pickerPreviewPathRef.current = null;
      void (async () => {
        try {
          const source = await window.batchStudio.thumbnail.readEditorImage(selection.imagePath);
          if (!source) throw new Error('画像を読み込めませんでした。');
          const image = await cachedEditorImage(source);
          if (pickerSessionRef.current?.sessionId !== selection.sessionId) return;
          const base = currentStateRef.current;
          if (!base) throw new Error('サムネイル編集状態を読み込めません。');
          const next: ThumbnailEditorState = {
            ...base,
            documents: base.documents.map((document) =>
              document.id === base.activeDocumentId
                ? {
                    ...document,
                    slots: {
                      ...document.slots,
                      [selection.slot]: {
                        imagePath: source.path,
                        offsetX: 0,
                        offsetY: 0,
                        scale: 1,
                      },
                    },
                  }
                : document,
            ),
          };
          const saved = await saveNow(next);
          if (pickerSessionRef.current?.sessionId !== selection.sessionId) return;
          setImages((current) => ({ ...current, [source.path]: image }));
          setState(saved);
          setNotice(`${SLOT_LABELS[selection.slot]}へ ${source.name} を設定しました。`);
          await window.batchStudio.thumbnail.commitResult(
            selection.sessionId,
            selection.imagePath,
            true,
          );
          pickerSessionRef.current = null;
          setPickerSession(null);
          setPickerPreview(null);
        } catch (error) {
          await window.batchStudio.thumbnail
            .commitResult(
              selection.sessionId,
              selection.imagePath,
              false,
              error instanceof Error ? error.message : String(error),
            )
            .catch(() => undefined);
        }
      })();
    });
    const removeCancel = window.batchStudio.thumbnail.onPickerCancel((session) => {
      if (pickerSessionRef.current?.sessionId !== session.sessionId) return;
      pickerSessionRef.current = null;
      pickerPreviewPathRef.current = null;
      setPickerSession(null);
      setPickerPreview(null);
    });
    return () => {
      removePreview();
      removeCommit();
      removeCancel();
    };
  }, [saveNow]);

  const openImagePicker = (slot: ThumbnailSlotKey) => {
    setSelectedSlot(slot);
    setPickerPreview(null);
    pickerPreviewPathRef.current = null;
    void run(async () => {
      const opened = await window.batchStudio.thumbnail.openPicker(
        project.rootPath,
        slot,
        active?.slots[slot]?.imagePath ?? '',
      );
      const session = { sessionId: opened.sessionId, slot };
      pickerSessionRef.current = session;
      setPickerSession(session);
    });
  };
  const chooseFileImage = () =>
    void run(async () => {
      const source = await window.batchStudio.thumbnail.selectImage(project.rootPath);
      if (!source) return;
      const image = await loadBrowserImage(source);
      setImages((current) => ({ ...current, [source.path]: image }));
      updateSlot(selectedSlot, { imagePath: source.path, offsetX: 0, offsetY: 0, scale: 1 });
      setNotice(`${SLOT_LABELS[selectedSlot]}へ ${source.name} を設定しました。`);
    });
  const exportImage = () =>
    void run(async () => {
      if (!active || !state) return;
      await saveNow(state);
      const overlay = templates[active.pattern] ?? (await loadPsdOverlay(active.pattern));
      if (!templates[active.pattern])
        setTemplates((current) => ({ ...current, [active.pattern]: overlay }));
      const canvas = window.document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      renderThumbnail(canvas, active, await fullResolutionImages(active), overlay);
      const mime = format === 'png' ? 'image/png' : 'image/jpeg';
      const dataUrl = canvas.toDataURL(mime, 0.94);
      const result = await window.batchStudio.thumbnail.exportImage(
        project.rootPath,
        active.id,
        format,
        dataUrl,
      );
      setLastExportPath(result.path);
      setNotice(`出力しました: ${result.path}`);
    });
  const exportAll = () =>
    void run(async () => {
      const currentState = state;
      if (!currentState) return;
      await saveNow(currentState);
      const nextTemplates = { ...templates };
      let lastPath = '';
      for (const thumbnail of currentState.documents) {
        const overlay =
          nextTemplates[thumbnail.pattern] ?? (await loadPsdOverlay(thumbnail.pattern));
        nextTemplates[thumbnail.pattern] = overlay;
        const canvas = window.document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        renderThumbnail(canvas, thumbnail, await fullResolutionImages(thumbnail), overlay);
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        const result = await window.batchStudio.thumbnail.exportImage(
          project.rootPath,
          thumbnail.id,
          format,
          canvas.toDataURL(mime, 0.94),
        );
        lastPath = result.path;
      }
      setTemplates(nextTemplates);
      setLastExportPath(lastPath);
      setNotice(
        `${currentState.documents.length}枚を出力しました: ${lastPath.replace(/[^\\/]+$/, '')}`,
      );
    });

  if (!state || !active)
    return (
      <div className="panel">
        {loadError ? (
          <div className="issue warning" role="alert">
            編集データを読み取れません: {loadError}{' '}
            元ファイルを保持しています。バックアップを確認してください。
            <button
              onClick={() =>
                void window.batchStudio.thumbnail
                  .load(project.rootPath)
                  .then((loaded) => {
                    setState(loaded);
                    loadedStateRef.current = true;
                    setLoadError('');
                  })
                  .catch((error: unknown) =>
                    setLoadError(error instanceof Error ? error.message : String(error)),
                  )
              }
            >
              再読み込み
            </button>
            <button
              onClick={() =>
                void window.batchStudio.thumbnail
                  .restoreBackup(project.rootPath)
                  .then((loaded) => {
                    if (loaded) {
                      setState(loaded);
                      loadedStateRef.current = true;
                      setLoadError('');
                    }
                  })
                  .catch((error: unknown) =>
                    setLoadError(error instanceof Error ? error.message : String(error)),
                  )
              }
            >
              バックアップから復元
            </button>
            <button
              onClick={() =>
                void window.batchStudio.thumbnail
                  .initializeCorrupt(project.rootPath)
                  .then((loaded) => {
                    if (loaded) {
                      setState(loaded);
                      loadedStateRef.current = true;
                      setLoadError('');
                    }
                  })
                  .catch((error: unknown) =>
                    setLoadError(error instanceof Error ? error.message : String(error)),
                  )
              }
            >
              元ファイルを保全して初期化
            </button>
          </div>
        ) : (
          'サムネイル編集データを読み込んでいます…'
        )}
      </div>
    );
  const slotState = active.slots[selectedSlot] ?? {
    imagePath: '',
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  };
  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      ((event.clientX - rect.left) / rect.width) * WIDTH,
      ((event.clientY - rect.top) / rect.height) * HEIGHT,
    ];
  };

  return (
    <div className="thumbnail-stage">
      <div className="thumbnail-document-toolbar">
        <div className="thumbnail-documents" aria-label="編集するサムネイル">
          {state.documents.map((document) => (
            <button
              key={document.id}
              className={document.id === active.id ? 'active' : ''}
              onClick={() =>
                setState((current) => current && { ...current, activeDocumentId: document.id })
              }
            >
              {String(document.id).padStart(2, '0')}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="thumbnail-add-document"
          onClick={addDocument}
          aria-label="サムネイルを追加"
          title="サムネイルを追加"
        >
          ＋
        </button>
        <button
          type="button"
          className="thumbnail-delete-document"
          disabled={state.documents.length <= 1}
          onClick={() => {
            setDeletingId(active.id);
            setDeleteOutputFiles(false);
            setDeleteWarning('');
            void window.batchStudio.marketplace
              .load(project.rootPath)
              .then((marketplace) => {
                if (
                  marketplace.sourceType === 'thumbnail' &&
                  marketplace.sourceImagePath
                    .toLowerCase()
                    .includes(`thumbnail-${String(active.id).padStart(2, '0')}.`)
                )
                  setDeleteWarning(
                    'このサムネイルは販売サイト用画像の入力元として使用中です。編集データを削除すると、出力済み画像を残しても入力元の再選択が必要になります。',
                  );
              })
              .catch(() => undefined);
          }}
        >
          削除
        </button>
      </div>
      {deletingId !== null && (
        <div
          className="panel thumbnail-delete-confirm"
          role="alertdialog"
          aria-label="サムネイルの削除確認"
        >
          <p>サムネイル {String(deletingId).padStart(2, '0')} の編集データを削除しますか？</p>
          {deleteWarning && <p className="issue warning">{deleteWarning}</p>}
          <label>
            <input
              type="checkbox"
              checked={deleteOutputFiles}
              onChange={(event) => setDeleteOutputFiles(event.target.checked)}
            />{' '}
            出力済み画像も削除する
          </label>
          <button type="button" onClick={() => setDeletingId(null)}>
            キャンセル
          </button>
          <button type="button" className="danger" onClick={confirmDeleteDocument}>
            削除する
          </button>
        </div>
      )}
      <div className="thumbnail-editor-grid">
        <section className="thumbnail-preview-panel">
          <div className="thumbnail-preview-head">
            <div>
              <h3>プレビュー</h3>
              <small>1600 × 1200 px・PSDテンプレート使用・画像をドラッグして構図を調整</small>
            </div>
            <label>
              レイアウト
              <select
                value={active.pattern}
                onChange={(event) =>
                  updateDocument((document) => ({
                    ...document,
                    pattern: event.target.value as ThumbnailPattern,
                  }))
                }
              >
                {Object.entries(PATTERN_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <canvas
            ref={canvasRef}
            width={WIDTH}
            height={HEIGHT}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              const point = canvasPoint(event);
              const slot = [...visibleSlots]
                .reverse()
                .find((key) => pointInPolygon(point, polygonFor(key)));
              if (!slot) return;
              setSelectedSlot(slot);
              dragRef.current = {
                slot,
                startX: point[0],
                startY: point[1],
                lastX: point[0],
                lastY: point[1],
                moved: false,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!dragRef.current || !(event.buttons & 1)) return;
              const point = canvasPoint(event);
              const drag = dragRef.current;
              const moved =
                drag.moved || Math.hypot(point[0] - drag.startX, point[1] - drag.startY) > 10;
              if (!moved) return;
              moveSlot(drag.slot, point[0] - drag.lastX, point[1] - drag.lastY);
              dragRef.current = { ...drag, lastX: point[0], lastY: point[1], moved: true };
            }}
            onPointerUp={(event) => {
              const drag = dragRef.current;
              dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
              if (drag && !drag.moved) openImagePicker(drag.slot);
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
          />
          {notice && <p className="thumbnail-notice">{notice}</p>}
          <p className="thumbnail-notice" role="status">
            {saveStatus === 'editing'
              ? '編集中（保存待ち）'
              : saveStatus === 'saving'
                ? '保存中…'
                : saveStatus === 'error'
                  ? '保存失敗'
                  : '保存済み'}
          </p>
          {saveError && (
            <div className="issue warning" role="alert">
              編集内容を保存できませんでした: {saveError}
              <button onClick={retrySave}>保存を再試行</button>
            </div>
          )}
        </section>
        <aside className="thumbnail-inspector">
          <section className="panel">
            <h3>画像</h3>
            <div className="thumbnail-slot-tabs">
              {visibleSlots.map((slot) => (
                <button
                  key={slot}
                  className={slot === selectedSlot ? 'active' : ''}
                  onClick={() => setSelectedSlot(slot)}
                >
                  {SLOT_LABELS[slot]}
                </button>
              ))}
            </div>
            <p className="thumbnail-path">{slotState.imagePath || '画像未選択'}</p>
            <button className="primary" onClick={() => openImagePicker(selectedSlot)}>
              画像一覧から選択
            </button>
            <button onClick={chooseFileImage}>ファイルから選択…</button>
            <label>
              拡大率 {slotState.scale.toFixed(2)}×
              <input
                type="range"
                min="0.5"
                max="3"
                step="0.01"
                value={slotState.scale}
                onChange={(event) =>
                  updateSlot(selectedSlot, { scale: Number(event.target.value) })
                }
              />
            </label>
            <div className="thumbnail-number-grid">
              <label>
                X位置
                <input
                  type="number"
                  value={Math.round(slotState.offsetX)}
                  onChange={(event) =>
                    updateSlot(selectedSlot, { offsetX: Number(event.target.value) })
                  }
                />
              </label>
              <label>
                Y位置
                <input
                  type="number"
                  value={Math.round(slotState.offsetY)}
                  onChange={(event) =>
                    updateSlot(selectedSlot, { offsetY: Number(event.target.value) })
                  }
                />
              </label>
            </div>
            <button onClick={() => updateSlot(selectedSlot, { offsetX: 0, offsetY: 0, scale: 1 })}>
              位置と倍率をリセット
            </button>
          </section>
          <TextInspector
            label="タイトル"
            value={active.title}
            fontFamilies={fontFamilies}
            onChange={(title) => updateDocument((document) => ({ ...document, title }))}
          />
          <TextInspector
            label="サブタイトル"
            value={active.subtitle}
            fontFamilies={fontFamilies}
            onChange={(subtitle) => updateDocument((document) => ({ ...document, subtitle }))}
          />
          <section className="panel thumbnail-export">
            <h3>画像出力</h3>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as 'png' | 'jpeg')}
            >
              <option value="png">PNG</option>
              <option value="jpeg">JPEG</option>
            </select>
            <button className="primary" onClick={exportImage}>
              サムネイル {String(active.id).padStart(2, '0')} を出力
            </button>
            <button onClick={exportAll}>{state.documents.length}枚すべて出力</button>
            {lastExportPath && (
              <button onClick={() => window.batchStudio.file.showInFolder(lastExportPath)}>
                出力先を開く
              </button>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

function FontFamilyComboBox({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    setQuery(value);
    setShowAll(true);
  }, [value]);

  const filteredOptions = useMemo(() => {
    if (showAll) return options;
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options
      .filter((font) => font.toLocaleLowerCase().includes(needle))
      .sort((a, b) => {
        const aStarts = a.toLocaleLowerCase().startsWith(needle);
        const bStarts = b.toLocaleLowerCase().startsWith(needle);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.localeCompare(b);
      });
  }, [options, query, showAll]);

  useEffect(() => setActiveIndex(0), [query, options, showAll]);

  const selectFont = (font: string) => {
    setQuery(font);
    setShowAll(true);
    onChange(font);
    setOpen(false);
  };
  const commitExactMatchOrRestore = () => {
    const normalized = query.trim().toLocaleLowerCase();
    const exact = options.find((font) => font.toLocaleLowerCase() === normalized);
    if (exact) {
      setQuery(exact);
      if (exact !== value) onChange(exact);
    } else {
      setQuery(value);
    }
    setShowAll(true);
    setOpen(false);
  };

  return (
    <div
      className="thumbnail-font-combobox"
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (next && event.currentTarget.contains(next)) return;
        commitExactMatchOrRestore();
      }}
    >
      <div className="thumbnail-font-input-row">
        <input
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          value={query}
          style={{ fontFamily: value }}
          onFocus={() => {
            setShowAll(true);
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setShowAll(false);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) =>
                open ? Math.min(index + 1, Math.max(0, filteredOptions.length - 1)) : 0,
              );
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter' && open && filteredOptions[activeIndex]) {
              event.preventDefault();
              selectFont(filteredOptions[activeIndex]);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setQuery(value);
              setShowAll(true);
              setOpen(false);
            }
          }}
        />
        <button
          type="button"
          className="thumbnail-font-toggle"
          aria-label="フォント一覧を開く"
          aria-expanded={open}
          onClick={() =>
            setOpen((current) => {
              if (!current) setShowAll(true);
              return !current;
            })
          }
        >
          ▾
        </button>
      </div>
      {open && (
        <div id={listId} className="thumbnail-font-suggestions" role="listbox">
          {filteredOptions.length ? (
            filteredOptions.map((font, index) => (
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                key={font}
                className={index === activeIndex ? 'active' : ''}
                style={{ fontFamily: font }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectFont(font)}
              >
                {font}
              </button>
            ))
          ) : (
            <div className="thumbnail-font-empty">一致するフォントはありません</div>
          )}
        </div>
      )}
    </div>
  );
}

function TextInspector({
  label,
  value,
  fontFamilies,
  onChange,
}: {
  label: string;
  value: ThumbnailTextState;
  fontFamilies: string[];
  onChange: (value: ThumbnailTextState) => void;
}) {
  const set = <K extends keyof ThumbnailTextState>(key: K, next: ThumbnailTextState[K]) =>
    onChange({ ...value, [key]: next });
  const fontOptions = fontFamilies.includes(value.fontFamily)
    ? fontFamilies
    : [value.fontFamily, ...fontFamilies];
  return (
    <section className="panel thumbnail-text-controls">
      <h3>{label}</h3>
      <label>
        テキスト
        <input value={value.text} onChange={(event) => set('text', event.target.value)} />
      </label>
      <div className="thumbnail-control-label">
        <span>フォント</span>
        <FontFamilyComboBox
          value={value.fontFamily}
          options={fontOptions}
          onChange={(fontFamily) => set('fontFamily', fontFamily)}
        />
      </div>
      <div className="thumbnail-number-grid">
        <label>
          サイズ
          <input
            type="number"
            min="12"
            max="400"
            value={value.fontSize}
            onChange={(event) => set('fontSize', Number(event.target.value))}
          />
        </label>
        <label>
          色
          <input
            type="color"
            value={value.color}
            onChange={(event) => set('color', event.target.value)}
          />
        </label>
        <label>
          X位置
          <input
            type="number"
            value={Math.round(value.x)}
            onChange={(event) => set('x', Number(event.target.value))}
          />
        </label>
        <label>
          Y位置
          <input
            type="number"
            value={Math.round(value.y)}
            onChange={(event) => set('y', Number(event.target.value))}
          />
        </label>
      </div>
    </section>
  );
}
