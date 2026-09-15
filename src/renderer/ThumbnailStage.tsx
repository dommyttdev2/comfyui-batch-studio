import { useEffect, useMemo, useRef, useState } from 'react';
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
type TemplateLayer = { canvas: HTMLCanvasElement; x: number; y: number };
type TemplateOverlay = { dividers: TemplateLayer; gradient: TemplateLayer };

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

  if (template) {
    context.drawImage(template.dividers.canvas, template.dividers.x, template.dividers.y);
    context.drawImage(template.gradient.canvas, template.gradient.x, template.gradient.y);
  } else {
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

    const overlay = context.createLinearGradient(0, HEIGHT * 0.67, 0, HEIGHT);
    overlay.addColorStop(0, 'rgba(3,6,14,0)');
    overlay.addColorStop(1, 'rgba(3,6,14,.86)');
    context.fillStyle = overlay;
    context.fillRect(0, HEIGHT * 0.67, WIDTH, HEIGHT * 0.33);
  }

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
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  if (psd.width !== WIDTH || psd.height !== HEIGHT)
    throw new Error(`${source.name} のキャンバスサイズが1600×1200ではありません。`);
  const divider = findLayer(psd.children, '02_DIVIDERS__WHITE_22PX');
  const gradient = findLayer(psd.children, '03_BOTTOM_GRADIENT__ABOVE_DIVIDERS');
  if (!divider?.canvas || !gradient?.canvas)
    throw new Error(`${source.name} に必要な分割線・グラデーションレイヤーがありません。`);
  return {
    dividers: { canvas: divider.canvas, x: divider.left ?? 0, y: divider.top ?? 0 },
    gradient: { canvas: gradient.canvas, x: gradient.left ?? 0, y: gradient.top ?? 0 },
  };
}

export function ThumbnailStage({ project, run }: { project: ProjectSummary; run: Runner }) {
  const [state, setState] = useState<ThumbnailEditorState | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<ThumbnailSlotKey>('CENTER_MAIN');
  const [images, setImages] = useState<LoadedImages>({});
  const [templates, setTemplates] = useState<Partial<Record<ThumbnailPattern, TemplateOverlay>>>(
    {},
  );
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [notice, setNotice] = useState('');
  const [lastExportPath, setLastExportPath] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{ slot: ThumbnailSlotKey; x: number; y: number } | null>(null);
  const loadedStateRef = useRef(false);

  const active = useMemo(
    () => state?.documents.find((item) => item.id === state.activeDocumentId) ?? null,
    [state],
  );
  const visibleSlots = active ? slotsFor(active.pattern) : [];

  useEffect(() => {
    let cancelled = false;
    void run(async () => {
      const loaded = await window.batchStudio.thumbnail.load(project.rootPath);
      if (cancelled) return;
      setState(loaded);
      const paths = [
        ...new Set(
          loaded.documents.flatMap((document) =>
            Object.values(document.slots)
              .map((slot) => slot.imagePath)
              .filter(Boolean),
          ),
        ),
      ];
      const sources = await Promise.all(
        paths.map((imagePath) => window.batchStudio.thumbnail.readImage(imagePath)),
      );
      const next: LoadedImages = {};
      for (const source of sources) {
        if (!source || cancelled) continue;
        try {
          next[source.path] = await loadBrowserImage(source);
        } catch {}
      }
      if (!cancelled) {
        setImages(next);
        loadedStateRef.current = true;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [project.rootPath]);

  useEffect(() => {
    if (!active || !canvasRef.current) return;
    renderThumbnail(canvasRef.current, active, images, templates[active.pattern]);
  }, [active, images, templates]);

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
    if (!state || !loadedStateRef.current) return;
    const timer = window.setTimeout(() => {
      void window.batchStudio.thumbnail.save(project.rootPath, state).catch(() => {});
    }, 500);
    return () => window.clearTimeout(timer);
  }, [project.rootPath, state]);

  useEffect(() => {
    if (active && !visibleSlots.includes(selectedSlot)) setSelectedSlot('CENTER_MAIN');
  }, [active?.pattern]);

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
  const chooseImage = () =>
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
      await window.batchStudio.thumbnail.save(project.rootPath, state);
      const overlay = templates[active.pattern] ?? (await loadPsdOverlay(active.pattern));
      if (!templates[active.pattern])
        setTemplates((current) => ({ ...current, [active.pattern]: overlay }));
      const canvas = window.document.createElement('canvas');
      canvas.width = WIDTH;
      canvas.height = HEIGHT;
      renderThumbnail(canvas, active, images, overlay);
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
      await window.batchStudio.thumbnail.save(project.rootPath, currentState);
      const nextTemplates = { ...templates };
      let lastPath = '';
      for (const thumbnail of currentState.documents) {
        const overlay =
          nextTemplates[thumbnail.pattern] ?? (await loadPsdOverlay(thumbnail.pattern));
        nextTemplates[thumbnail.pattern] = overlay;
        const canvas = window.document.createElement('canvas');
        canvas.width = WIDTH;
        canvas.height = HEIGHT;
        renderThumbnail(canvas, thumbnail, images, overlay);
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
      setNotice(`6枚を出力しました: ${lastPath.replace(/[^\\/]+$/, '')}`);
    });

  if (!state || !active)
    return <div className="panel">サムネイル編集データを読み込んでいます…</div>;
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
              const point = canvasPoint(event);
              const slot = [...visibleSlots]
                .reverse()
                .find((key) => pointInPolygon(point, polygonFor(key)));
              if (!slot) return;
              setSelectedSlot(slot);
              dragRef.current = { slot, x: point[0], y: point[1] };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              if (!dragRef.current || !(event.buttons & 1)) return;
              const point = canvasPoint(event);
              const drag = dragRef.current;
              moveSlot(drag.slot, point[0] - drag.x, point[1] - drag.y);
              dragRef.current = { slot: drag.slot, x: point[0], y: point[1] };
            }}
            onPointerUp={(event) => {
              dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
          />
          {notice && <p className="thumbnail-notice">{notice}</p>}
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
            <button className="primary" onClick={chooseImage}>
              画像を選択
            </button>
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
            onChange={(title) => updateDocument((document) => ({ ...document, title }))}
          />
          <TextInspector
            label="サブタイトル"
            value={active.subtitle}
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
            <button onClick={exportAll}>6枚すべて出力</button>
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

function TextInspector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ThumbnailTextState;
  onChange: (value: ThumbnailTextState) => void;
}) {
  const set = <K extends keyof ThumbnailTextState>(key: K, next: ThumbnailTextState[K]) =>
    onChange({ ...value, [key]: next });
  return (
    <section className="panel thumbnail-text-controls">
      <h3>{label}</h3>
      <label>
        テキスト
        <input value={value.text} onChange={(event) => set('text', event.target.value)} />
      </label>
      <label>
        フォント
        <select
          value={value.fontFamily}
          onChange={(event) => set('fontFamily', event.target.value)}
        >
          <option>Times New Roman</option>
          <option>Yu Mincho</option>
          <option>Georgia</option>
          <option>Meiryo</option>
        </select>
      </label>
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
