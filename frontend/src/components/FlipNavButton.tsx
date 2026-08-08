import type { ReactNode } from "react";
import { cn } from "../lib";

/**
 * 横向矩形 3D 翻转展开按钮：
 * 正面显示主文字，hover 沿 Y 轴翻转 180 度并扩展宽高，展示背面附加信息。
 */
export function FlipNavButton({
  front,
  back,
  onClick,
  className,
}: {
  front: ReactNode;
  back: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button onClick={onClick} className={cn("flip-btn group rounded-xl shadow-lg", className)}>
      <span className="flip-btn-inner relative block h-full w-full">
        <span className="flip-btn-face absolute inset-0 flex items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-3 text-sm font-bold text-white">
          {front}
        </span>
        <span className="flip-btn-back flip-btn-face absolute inset-0 flex items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--panel-solid)] px-2.5 text-center text-[11px] font-medium leading-snug text-[var(--text)]">
          {back}
        </span>
      </span>
    </button>
  );
}
