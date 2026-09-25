import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type PickerGridSize = 'large' | 'medium' | 'small';
const COLUMNS: Record<PickerGridSize, number> = { large: 3, medium: 5, small: 7 };
const GAP = 12;
const PADDING = 40;
const EXTRA_HEIGHT = 36;
const OVERSCAN = 3;

export function virtualPickerRange(
  count: number,
  columns: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
) {
  const rows = Math.ceil(count / columns);
  const start = Math.min(rows, Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN));
  const end = Math.min(rows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN);
  return { start, end, rows };
}

export function VirtualPickerGrid<T extends { path: string }>({
  items,
  size,
  activePath,
  renderItem,
  onMetrics,
}: {
  items: T[];
  size: PickerGridSize;
  activePath: string;
  renderItem: (item: T) => ReactNode;
  onMetrics?: (visible: number, total: number) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState({ width: 0, height: 0, top: 0 });
  const columns = COLUMNS[size];
  const cellWidth = Math.max(72, (geometry.width - PADDING - GAP * (columns - 1)) / columns);
  const rowHeight = Math.ceil(cellWidth + EXTRA_HEIGHT + GAP);
  const range = virtualPickerRange(items.length, columns, rowHeight, geometry.top, geometry.height);
  const anchor = useRef({ columns, rowHeight, firstPath: '' });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () =>
      setGeometry({
        width: viewport.clientWidth,
        height: viewport.clientHeight,
        top: viewport.scrollTop,
      });
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    measure();
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const previous = anchor.current;
    if (previous.columns !== columns || previous.rowHeight !== rowHeight) {
      const index = items.findIndex((item) => item.path === previous.firstPath);
      viewport.scrollTop = Math.floor(Math.max(0, index) / columns) * rowHeight;
      setGeometry((current) => ({ ...current, top: viewport.scrollTop }));
    }
    anchor.current = {
      columns,
      rowHeight,
      firstPath: items[range.start * columns]?.path ?? '',
    };
  }, [columns, rowHeight, items, range.start]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const activeIndex = items.findIndex((item) => item.path === activePath);
    viewport.scrollTop = activeIndex < 0 ? 0 : Math.floor(activeIndex / columns) * rowHeight;
    setGeometry((current) => ({ ...current, top: viewport.scrollTop }));
  }, [items, activePath, columns, rowHeight]);

  const rows = useMemo(
    () =>
      Array.from({ length: range.end - range.start }, (_, offset) => {
        const row = range.start + offset;
        return { row, entries: items.slice(row * columns, (row + 1) * columns) };
      }),
    [items, columns, range.start, range.end],
  );

  useEffect(() => {
    onMetrics?.(
      rows.reduce((count, row) => count + row.entries.length, 0),
      items.length,
    );
  }, [rows, items.length, onMetrics]);

  return (
    <div
      ref={viewportRef}
      className="thumbnail-image-picker-viewport"
      onScroll={(event) =>
        setGeometry((current) => ({ ...current, top: event.currentTarget.scrollTop }))
      }
    >
      <div
        className="thumbnail-image-picker-virtual-space"
        style={{ height: range.rows * rowHeight }}
      >
        {rows.map(({ row, entries }) => (
          <div
            key={row}
            className={`thumbnail-image-picker-grid thumbnail-image-picker-row ${size}`}
            style={{ top: row * rowHeight, height: rowHeight - GAP }}
          >
            {entries.map((item) => (
              <div key={item.path} className="thumbnail-image-picker-cell">
                {renderItem(item)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
