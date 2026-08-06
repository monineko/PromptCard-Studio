import { Images, type LucideIcon } from "lucide-react";
import type { MouseEvent } from "react";

function StackPhoto({ url }: { url?: string }) {
  return url ? (
    <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-white/45">
      <Images size={22} />
    </div>
  );
}

/**
 * 相册堆叠封面卡片：
 * 底部 2 张散落照片（±5~6° 倾斜）+ 顶层白色边框封面（N 张照片蒙层），
 * 下方为标题 / 日期胶囊 / 说明文字。Hover 时底层散开、封面抬起。
 */
export function AlbumStackCard({
  title,
  subtitle,
  count,
  date,
  coverUrls,
  color,
  icon: Icon,
  index,
  onOpen,
}: {
  title: string;
  subtitle: string;
  count: number;
  date?: string;
  coverUrls: string[];
  color: string;
  icon: LucideIcon;
  index: number;
  onOpen: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="album-card group flex animate-fade-in-up flex-col items-center text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      style={{ animationDelay: `${90 + index * 70}ms` }}
    >
      {/* 堆叠照片区域 */}
      <div className="relative aspect-[4/3] w-[84%]">
        {/* 最底层：右倾散落照片 */}
        <div className="absolute inset-0 translate-x-3 translate-y-2 rotate-[6deg] overflow-hidden rounded-xl border-4 border-white shadow-lg transition-all duration-500 ease-out group-hover:translate-x-5 group-hover:rotate-[9deg] group-hover:brightness-110">
          <StackPhoto url={coverUrls[2]} />
        </div>
        {/* 中间层：左倾散落照片 */}
        <div className="absolute inset-0 -translate-x-2.5 -translate-y-1 rotate-[-5deg] overflow-hidden rounded-xl border-4 border-white shadow-lg transition-all duration-500 ease-out group-hover:-translate-x-5 group-hover:rotate-[-8deg] group-hover:brightness-110">
          <StackPhoto url={coverUrls[1]} />
        </div>
        {/* 顶层封面：白色边框 + 圆角阴影 + N 张照片蒙层 */}
        <div className="relative z-10 h-full w-full overflow-hidden rounded-2xl border-4 border-white shadow-[0_16px_36px_-12px_rgba(0,0,0,0.5)] transition-all duration-500 ease-out group-hover:-translate-y-2 group-hover:scale-[1.025] group-hover:shadow-[0_26px_52px_-14px_rgba(0,0,0,0.6)]">
          {coverUrls[0] ? (
            <img
              src={coverUrls[0]}
              alt={title}
              draggable={false}
              className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
          ) : (
            <StackPhoto />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors duration-300 group-hover:bg-black/55">
            {count} 张照片
          </span>
          <span className="absolute bottom-2 left-2 translate-y-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white opacity-0 backdrop-blur-[4px] transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            点击打开 →
          </span>
        </div>
      </div>

      {/* 卡片下方信息 */}
      <div className="mt-3.5 w-full px-1">
        <h3 className="flex items-center justify-center gap-1.5 text-base font-bold transition-colors duration-300">
          <Icon size={16} style={{ color }} className="shrink-0" />
          <span className="truncate text-[var(--text)] transition-colors duration-300 group-hover:text-[var(--accent)]">
            {title}
          </span>
        </h3>
        <div className="mt-1.5 flex items-center justify-center">
          <span className="glass rounded-md px-2 py-0.5 text-[10px] font-medium tracking-wide text-[var(--muted)]">
            {date || "暂无记录"}
          </span>
        </div>
        <p className="mt-1.5 truncate text-xs text-[var(--muted)]">{subtitle}</p>
      </div>
    </button>
  );
}
