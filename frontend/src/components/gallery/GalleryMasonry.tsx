import { VirtualMasonry } from "react-hybrid-masonry";
import { api } from "../../api";
import type { LibraryImageItem } from "../../types";

export type GalleryItem = LibraryImageItem & { _idx: number };

/**
 * Gallery 可替换封装：瀑布流 + 虚拟滚动 + 懒加载。
 * 后续更换底层库时只需改这个组件，页面无需变动。
 */
export function GalleryMasonry({
  items,
  onItemClick,
  minColumnWidth = 190,
  gap = 12,
}: {
  items: LibraryImageItem[];
  onItemClick: (item: LibraryImageItem, index: number) => void;
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
          onClick={() => onItemClick(item, item._idx)}
        >
          <img
            src={api.libraryImageUrl(item.path)}
            alt={item.name}
            loading="lazy"
            className="h-full w-full object-cover"
            draggable={false}
          />
        </div>
      )}
    />
  );
}
