import { ArrowLeft, CheckSquare, FolderInput, Loader2, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";

const POS_KEY = "npm_quickpick_pos";
const DEFAULT_POS = { x: 120, y: 140 };

const MOVE_TARGETS: { key: string; label: string }[] = [
  { key: "treasure", label: "Treasure" },
  { key: "fine", label: "Fine" },
  { key: "reject", label: "Reject" },
  { key: "favorites", label: "收藏 (Like)" },
  { key: "unrated", label: "未评分" },
];

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (typeof p.x === "number" && typeof p.y === "number") return { x: p.x, y: p.y };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_POS;
}

/**
 * 快捷选取悬浮窗：显示已选数量，支持批量移动到各分类文件夹；
 * Reject 分类内额外提供删除（按设置进系统回收站或永久删除）。
 * 可拖动、记忆位置、可关闭。
 */
export function QuickPickPopup({
  count,
  showDelete,
  busy,
  onMove,
  onDelete,
  onClose,
}: {
  count: number;
  showDelete: boolean;
  busy: boolean;
  onMove: (target: string) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [pos, setPos] = useState(loadPos);
  const [pickingTarget, setPickingTarget] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setPos({
      x: Math.max(8, e.clientX - dragRef.current.dx),
      y: Math.max(8, e.clientY - dragRef.current.dy),
    });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const next = {
      x: Math.max(8, e.clientX - dragRef.current.dx),
      y: Math.max(8, e.clientY - dragRef.current.dy),
    };
    setPos(next);
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  };

  return createPortal(
    <div
      className="glass fixed z-[10000] flex w-[330px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        className="flex cursor-move items-center gap-2 border-b border-[var(--border)] px-3 py-2.5 select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (dragRef.current = null)}
        title="拖动移动位置（位置会被记住）"
      >
        <CheckSquare size={14} style={{ color: "var(--accent)" }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">快捷选取</span>
        <span className="shrink-0 rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold text-white">
          已选 {count} 张
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title="关闭（退出快捷选取）"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3 py-2.5">
        {pickingTarget ? (
          <div className="space-y-1.5">
            <div className="mb-1 text-xs font-semibold text-[var(--muted)]">移动到哪个文件夹？</div>
            {MOVE_TARGETS.map((t) => (
              <button
                key={t.key}
                disabled={busy}
                onClick={() => onMove(t.key)}
                className="flex w-full items-center gap-2 rounded-lg bg-[var(--hover)] px-3 py-2 text-sm transition-colors hover:bg-[var(--accent)] hover:text-white disabled:opacity-40"
              >
                <FolderInput size={14} /> {t.label}
              </button>
            ))}
            <button
              onClick={() => setPickingTarget(false)}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
            >
              <ArrowLeft size={12} /> 返回
            </button>
          </div>
        ) : (
          <div className="space-y-1.5">
            <button
              disabled={!count || busy}
              onClick={() => setPickingTarget(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-40"
              style={{ background: "var(--accent)" }}
            >
              <FolderInput size={15} /> 移动到…
            </button>
            {showDelete && (
              <button
                disabled={!count || busy}
                onClick={onDelete}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-500/40 px-3 py-2.5 text-sm font-semibold text-red-400 transition-colors hover:bg-red-500/10 disabled:opacity-40"
                title="按设置移入系统回收站或永久删除"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} 删除
              </button>
            )}
            <p className="text-[11px] leading-relaxed text-[var(--muted)]">
              已选中的图片用浅灰色标记；点击图片可继续选择或取消选择。
            </p>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
