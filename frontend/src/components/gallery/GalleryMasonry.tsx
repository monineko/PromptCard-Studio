import { useCallback, useMemo } from "react";
import { VirtualMasonry } from "react-hybrid-masonry";
import { api } from "../../api";
import { cn } from "../../lib";
import type { LibraryImageItem } from "../../types";

export type GalleryItem = LibraryImageItem & { _idx: number };

/**
 * Gallery 可替换封装：瀑布流 + 虚拟滚动 + 懒加载。
 * 后续更换底层库时只需改这个组件，页面无需变动。
 */
export function GalleryMasonry({
  items,
  onItemClick,
  selectionMode = false,
  selectedPaths,
  onToggleSelect,
  minColumnWidth = 190,
  gap = 12,
  getImageUrl = (item) => api.libraryThumbnailUrl(item.path),
}: {
  items: LibraryImageItem[];
  onItemClick: (item: LibraryImageItem, index: number) => void;
  selectionMode?: boolean;
  selectedPaths?: Set<string>;
  onToggleSelect?: (item: LibraryImageItem, index: number) => void;
  minColumnWidth?: number;
  gap?: number;
  getImageUrl?: (item: LibraryImageItem) => string;
}) {
  const paged = useMemo<GalleryItem[]>(
    () => items.map((item, idx) => ({ ...item, _idx: idx })),
    [items]
  );
  // 图库内容变化（移动/删除/重扫）时强制重建内部分页状态
  const refreshKey = useMemo(
    () => paged.map((item) => `${item.path}:${item.mtime}`).join("|") || "empty",
    [paged]
  );
  const loadPage = useCallback(
    async (page: number, pageSize: number) => ({
      data: paged.slice((page - 1) * pageSize, page * pageSize),
      hasMore: page * pageSize < paged.length,
    }),
    [paged]
  );

  return (
    <VirtualMasonry<GalleryItem>
      key={refreshKey}
      loadData={loadPage}
      pageSize={48}
      minColumnWidth={minColumnWidth}
      gap={gap}
      renderItem={(item) => (
        <div
          className="card-shine group animate-fade-in-up cursor-pointer overflow-hidden rounded-xl bg-[var(--hover)] shadow-[0_2px_10px_rgba(0,0,0,0.16)] transition-shadow duration-300 hover:z-10 hover:shadow-[0_18px_42px_-12px_rgba(0,0,0,0.55)]"
          style={{
            position: "absolute",
            left: item.x,
            top: item.y,
            width: item.width,
            height: item.height,
            animationDelay: `${Math.min((item._idx % 18) * 30, 480)}ms`,
          }}
          onClick={() =>
            selectionMode ? onToggleSelect?.(item, item._idx) : onItemClick(item, item._idx)
          }
        >
          <img
            src={getImageUrl(item)}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-[450ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-110"
            draggable={false}
          />
          {/* 底部信息渐变：Hover 时淡出显现照片名与日期 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-3 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-2.5 pb-2 pt-10 opacity-0 transition-all duration-300 ease-out group-hover:translate-y-0 group-hover:opacity-100">
            <p className="truncate text-[11px] font-semibold text-white/95">{item.name}</p>
            <p className="mt-0.5 text-[10px] text-white/55">{item.date || "未分组"}</p>
          </div>
          {selectionMode && (
            <>
              {selectedPaths?.has(item.path) && <div className="absolute inset-0 bg-gray-400/50" />}
              <span
                className={cn(
                  "absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded-full border text-[11px] font-bold",
                  selectedPaths?.has(item.path)
                    ? "border-transparent bg-[var(--accent)] text-white"
                    : "border-[var(--border)] bg-black/30 text-transparent"
                )}
              >
                ✓
              </span>
            </>
          )}
        </div>
      )}
    />
  );
}
