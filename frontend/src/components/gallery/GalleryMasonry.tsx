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
}: {
  items: LibraryImageItem[];
  onItemClick: (item: LibraryImageItem, index: number) => void;
  selectionMode?: boolean;
  selectedPaths?: Set<string>;
  onToggleSelect?: (item: LibraryImageItem, index: number) => void;
  minColumnWidth?: number;
  gap?: number;
}) {
  const paged: GalleryItem[] = items.map((item, idx) => ({ ...item, _idx: idx }));
  // 图库内容变化（移动/删除/重扫）时强制重建内部分页状态
  const refreshKey = paged.map((i) => `${i.path}:${i.mtime}`).join("|") || "empty";

  return (
    <VirtualMasonry<GalleryItem>
      key={refreshKey}
      loadData={async (page, pageSize) => ({
        data: paged.slice((page - 1) * pageSize, page * pageSize),
        hasMore: page * pageSize < paged.length,
      })}
      pageSize={48}
      minColumnWidth={minColumnWidth}
      gap={gap}
      renderItem={(item) => (
        <div
          className="group cursor-pointer overflow-hidden rounded-xl bg-[var(--hover)] transition-transform duration-150 hover:z-10 hover:scale-[1.03]"
          style={{ position: "absolute", left: item.x, top: item.y, width: item.width, height: item.height }}
          onClick={() =>
            selectionMode ? onToggleSelect?.(item, item._idx) : onItemClick(item, item._idx)
          }
        >
          <img
            src={api.libraryImageUrl(item.path)}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover"
            draggable={false}
          />
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
