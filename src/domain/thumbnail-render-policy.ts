import type { ThumbnailDocument, ThumbnailSlotKey, ThumbnailTextState } from './artifact-types.js';
import {
  HEIGHT,
  LEFT_BOTTOM_X,
  LEFT_MID_X,
  LEFT_TOP_X,
  LINE_WIDTH,
  type Point,
  polygonBounds,
  polygonFor,
  RIGHT_BOTTOM_X,
  RIGHT_MID_X,
  RIGHT_TOP_X,
  SIDE_SPLIT_INNER_Y,
  SIDE_SPLIT_OUTER_Y,
  slotsFor,
  thumbnailSlotPlacement,
  WIDTH,
} from './thumbnail-layout-policy.js';
export interface ThumbnailDrawingPort<Image, Gradient> {
  save(): void;
  restore(): void;
  beginPath(): void;
  closePath(): void;
  clip(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: Image, x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  strokeText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
  createLinearGradient(
    x: number,
    y: number,
    x2: number,
    y2: number,
  ): Gradient & { addColorStop(ratio: number, color: string): void };
  fillStyle: string | Gradient;
  strokeStyle: string | Gradient;
  font: string;
  lineWidth: number;
  lineJoin: 'round' | 'bevel' | 'miter';
  lineCap: 'butt' | 'round' | 'square';
  textAlign: 'center' | 'left' | 'right' | 'start' | 'end';
  textBaseline: 'top' | 'hanging' | 'middle' | 'alphabetic' | 'ideographic' | 'bottom';
}
const SLOT_LABELS: Record<ThumbnailSlotKey, string> = {
  LEFT: '左',
  LEFT_TOP: '左上',
  LEFT_BOTTOM: '左下',
  CENTER_MAIN: '中央',
  RIGHT: '右',
  RIGHT_TOP: '右上',
  RIGHT_BOTTOM: '右下',
};

function tracePolygon<Image, Gradient>(
  context: ThumbnailDrawingPort<Image, Gradient>,
  polygon: Point[],
) {
  context.beginPath();
  polygon.forEach(([x, y], index) => (index ? context.lineTo(x, y) : context.moveTo(x, y)));
  context.closePath();
}

function drawSlot<Image, Gradient>(
  context: ThumbnailDrawingPort<Image, Gradient>,
  item: ThumbnailDocument,
  slot: ThumbnailSlotKey,
  images: Record<string, { source: Image; width: number; height: number }>,
) {
  const polygon = polygonFor(slot);
  const bounds = polygonBounds(polygon);
  context.save();
  tracePolygon(context, polygon);
  context.clip();
  const state = item.slots[slot];
  const image = state?.imagePath ? images[state.imagePath] : undefined;
  if (image) {
    const placement = thumbnailSlotPlacement(
      slot,
      { width: image.width, height: image.height },
      { scale: state?.scale ?? 1, offsetX: state?.offsetX ?? 0, offsetY: state?.offsetY ?? 0 },
    );
    context.drawImage(image.source, placement.x, placement.y, placement.width, placement.height);
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

function drawText<Image, Gradient>(
  context: ThumbnailDrawingPort<Image, Gradient>,
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

export function drawThumbnail<Image, Gradient>(
  context: ThumbnailDrawingPort<Image, Gradient>,
  item: ThumbnailDocument,
  images: Record<string, { source: Image; width: number; height: number }>,
) {
  context.clearRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = '#0c0c10';
  context.fillRect(0, 0, WIDTH, HEIGHT);
  for (const slot of slotsFor(item.pattern)) drawSlot(context, item, slot, images);

  // The PSD is validated before use, while these two overlays are redrawn from
  // its canonical values. Some PSD readers flatten transparent RGB layers onto
  // opaque black, which would otherwise cover every image after parsing.

  context.strokeStyle = '#fff';
  context.lineWidth = LINE_WIDTH;
  context.lineCap = 'butt';
  context.beginPath();
  context.moveTo(LEFT_TOP_X, 0);
  context.lineTo(LEFT_BOTTOM_X, HEIGHT);
  context.moveTo(RIGHT_TOP_X, 0);
  context.lineTo(RIGHT_BOTTOM_X, HEIGHT);
  if (item.pattern === '4-images-left-split' || item.pattern === '5-images-both-split') {
    context.moveTo(0, SIDE_SPLIT_OUTER_Y);
    context.lineTo(LEFT_MID_X, SIDE_SPLIT_INNER_Y);
  }
  if (item.pattern === '4-images-right-split' || item.pattern === '5-images-both-split') {
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

  drawText(context, item.title, 7);
  drawText(context, item.subtitle, 3);
  if (item.subtitle.text) {
    context.save();
    context.font = `${item.subtitle.fontSize}px "${item.subtitle.fontFamily}", serif`;
    const textWidth = context.measureText(item.subtitle.text).width;
    const gap = 40;
    const length = 175;
    context.strokeStyle = item.subtitle.color;
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(item.subtitle.x - textWidth / 2 - gap - length, item.subtitle.y);
    context.lineTo(item.subtitle.x - textWidth / 2 - gap, item.subtitle.y);
    context.moveTo(item.subtitle.x + textWidth / 2 + gap, item.subtitle.y);
    context.lineTo(item.subtitle.x + textWidth / 2 + gap + length, item.subtitle.y);
    context.stroke();
    context.restore();
  }
}
