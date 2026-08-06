import { ChevronDown, FileJson, Loader2, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import type { LibraryImageItem, PngInfoResult } from "../../types";

const POS_KEY = "npm_png_panel_pos";
const DEFAULT_POS = { x: 96, y: 96 };

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
 * PNG 信息悬浮窗：可拖动、记忆位置（localStorage）、可关闭。
 * 与灯箱平级渲染（z-index 更高），点击/拖动窗口不会触发灯箱关闭。
 */
export function PngInfoPopup({
  item,
  info,
  loading,
  error,
  onRead,
  onClose,
  onSendToWorkspace,
}: {
  item: LibraryImageItem;
  info: PngInfoResult | null;
  loading: boolean;
  error: string;
  onRead: () => void;
  onClose: () => void;
  onSendToWorkspace: (prompt: string, uc: string) => void;
}) {
  const [pos, setPos] = useState(loadPos);
  const [showRaw, setShowRaw] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);
  const summary = info?.summary;

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

  return (
    <div
      className="glass fixed z-[2000] flex w-[430px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl shadow-2xl"
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
        <FileJson size={14} style={{ color: "var(--accent)" }} />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{item.name}</span>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title="关闭"
        >
          <X size={14} />
        </button>
      </div>

      <div className="max-h-[52vh] overflow-auto px-3 py-2.5 text-sm">
        {!info && !loading && !error && (
          <button
            onClick={onRead}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-85"
            style={{ background: "var(--accent)" }}
          >
            <FileJson size={13} /> 读取 PNG 信息
          </button>
        )}
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
            <Loader2 size={14} className="animate-spin" /> 正在解析…
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}

        {info && !error && (
          <div className="space-y-2">
            {summary?.prompt && (
              <div>
                <div className="mb-0.5 text-xs font-semibold text-[var(--accent)]">正面提示词</div>
                <div className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs leading-relaxed">
                  {summary.prompt}
                </div>
              </div>
            )}
            {summary?.uc && (
              <div>
                <div className="mb-0.5 text-xs font-semibold text-red-300">负面提示词</div>
                <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs leading-relaxed">
                  {summary.uc}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
              {summary?.width != null && <span>宽 {summary.width}</span>}
              {summary?.height != null && <span>高 {summary.height}</span>}
              {summary?.seed != null && <span>种子 {summary.seed}</span>}
              {summary?.sampler && <span>采样器 {summary.sampler}</span>}
              {summary?.steps != null && <span>步数 {summary.steps}</span>}
              {summary?.scale != null && <span>CFG {summary.scale}</span>}
              {info.source && <span>来源 {info.source}</span>}
              {info.generation_time && <span>生成时间 {info.generation_time}</span>}
            </div>

            <button
              onClick={() => setShowRaw((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
            >
              <ChevronDown size={12} className={showRaw ? "rotate-180" : ""} />
              {showRaw ? "收起" : "查看"}完整 JSON
            </button>
            {showRaw && (
              <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
                {JSON.stringify(info.parsed ?? info.raw, null, 2)}
              </pre>
            )}
          </div>
        )}
      </div>

      {summary?.prompt && (
        <div className="border-t border-[var(--border)] px-3 py-2">
          <button
            onClick={() => onSendToWorkspace(summary.prompt ?? "", summary.uc ?? "")}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-85"
            style={{ background: "var(--accent)" }}
          >
            <Send size={13} /> 发送到工作区（覆盖正面/负面）
          </button>
        </div>
      )}
    </div>
  );
}
