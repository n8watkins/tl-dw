import { useVirtualizer } from "@tanstack/react-virtual";
import { useRef, type CSSProperties, type ReactNode } from "react";

/**
 * Windowed list: renders only the rows in (or near) the viewport, so a list of
 * thousands of channels / history entries keeps ~20 DOM nodes instead of all of
 * them. Row heights are MEASURED (`measureElement`), so expandable cards that
 * grow/shrink on click work without a fixed row height.
 *
 * Search-compatible by construction: the caller passes the already-FILTERED
 * array as `items`, so we just window whatever list we're handed — filtering and
 * virtualization compose with no special handling.
 *
 * Scrolls inside a bounded container so the surrounding chrome (search box, tabs,
 * sort) stays put while the list scrolls. Pass `className` to reuse an existing
 * scroll-container style (e.g. `.history-scroll`), or set `style.maxHeight`.
 */
export function VirtualList<T>({
  items,
  getKey,
  renderItem,
  estimateSize = 72,
  gap = 8,
  overscan = 8,
  className,
  style,
}: {
  items: T[];
  getKey: (item: T, index: number) => string | number;
  renderItem: (item: T, index: number) => ReactNode;
  estimateSize?: number;
  gap?: number;
  overscan?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    getItemKey: (index) => getKey(items[index], index),
    overscan,
    gap,
  });

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ overflowY: "auto", position: "relative", ...style }}
    >
      {/* Sizer: full scroll height so the scrollbar reflects the whole list. */}
      <div style={{ height: virtualizer.getTotalSize(), position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((vi) => (
          <div
            key={vi.key}
            data-index={vi.index}
            ref={virtualizer.measureElement}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${vi.start}px)`,
            }}
          >
            {renderItem(items[vi.index], vi.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
