import type { ThumbnailPattern, ThumbnailSlotKey } from './artifact-types.js';
export const WIDTH = 1600;
export const HEIGHT = 1200;
export const LINE_WIDTH = 22;
export const LEFT_TOP_X = 320;
export const LEFT_BOTTOM_X = 560;
export const RIGHT_TOP_X = 1280;
export const RIGHT_BOTTOM_X = 1040;
export const SIDE_SPLIT_OUTER_Y = 490;
export const SIDE_SPLIT_INNER_Y = 590;
export const LEFT_MID_X = Math.round(
  LEFT_TOP_X + (LEFT_BOTTOM_X - LEFT_TOP_X) * (SIDE_SPLIT_INNER_Y / HEIGHT),
);
export const RIGHT_MID_X = Math.round(
  RIGHT_TOP_X + (RIGHT_BOTTOM_X - RIGHT_TOP_X) * (SIDE_SPLIT_INNER_Y / HEIGHT),
);

export type Point = [number, number];
export function slotsFor(pattern: ThumbnailPattern): ThumbnailSlotKey[] {
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

export function polygonFor(slot: ThumbnailSlotKey): Point[] {
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

export function polygonBounds(points: Point[]) {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export function pointInPolygon(point: Point, polygon: Point[]) {
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

export function thumbnailSlotPlacement(
  slot: ThumbnailSlotKey,
  image: { width: number; height: number },
  state: { scale: number; offsetX: number; offsetY: number },
) {
  const bounds = polygonBounds(polygonFor(slot));
  if (!(image.width > 0 && image.height > 0))
    throw new Error('Invalid thumbnail source dimensions.');
  const scale = Math.max(bounds.width / image.width, bounds.height / image.height) * state.scale;
  const width = image.width * scale,
    height = image.height * scale;
  return {
    x: bounds.left + bounds.width / 2 + state.offsetX - width / 2,
    y: bounds.top + bounds.height / 2 + state.offsetY - height / 2,
    width,
    height,
  };
}
