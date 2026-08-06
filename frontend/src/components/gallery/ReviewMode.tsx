import { Check, Crown, Heart, ThumbsUp, Undo2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../../api";
import type { LibraryImageItem, ReviewTag } from "../../types";

const TAGS: { tag: ReviewTag; label: string; key: string; icon: typeof Crown; color: string }[] = [
  { tag: "treasure", label: "Treasure", key: "ArrowLeft", icon: Crown, color: "#f59e0b" },
  { tag: "fine", label: "Fine", key: "ArrowDown", icon: ThumbsUp, color: "#34d399" },
  { tag: "reject", label: "Reject", key: "ArrowRight", icon: XCircle, color: "#f87171" },
  { tag: "favorites", label: "收藏 (Like)", key: "ArrowUp", icon: Heart, color: "#ec4899" },
];

/**
 * 筛选模式：一次放大一张，键盘 ←↓→↑ 打临时标签（↑=收藏/Like），
 * 只记标签不动文件；“结束筛选”后统一移动/删除，未评分图不动。
 */
export function ReviewMode({
  items,
  categoryLabel,
  startIndex = 0,
  recycleReject,
  onFinished,
  onCancel,
}: {
  items: LibraryImageItem[];
  categoryLabel: string;
  startIndex?: number;
  recycleReject: boolean;
  onFinished: (result: Awaited<ReturnType<typeof api.applyReview>>) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(startIndex);
  const [tags, setTags] = useState<Record<string, ReviewTag>>({});
  const [history, setHistory] = useState<number[]>([]);
  const [applying, setApplying] = useState(false);
  const [lastTag, setLastTag] = useState<ReviewTag | null>(null);
  const [burst, setBurst] = useState<number>(0);

  const current = items[index];
  const currentTag = current ? tags[current.path] : undefined;
  const taggedCount = Object.keys(tags).length;

  const tag = useCallback(
    (t: ReviewTag) => {
      if (!current) return;
      setLastTag(t);
      setTags((prev) => ({ ...prev, [current.path]: t }));
      setHistory((prev) => [...prev, index]);
      if (t === "treasure" || t === "favorites") setBurst((b) => b + 1);
      setIndex((i) => Math.min(i + 1, items.length - 1));
    },
    [current, index, items.length]
  );

  const burstParticles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * Math.PI * 2;
        const dist = 70 + (i % 3) * 26;
        const color = ["#f59e0b", "#ec4899", "#a78bfa", "#fbbf24", "#34d399"][i % 5];
        return {
          id: `${burst}-${i}`,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist,
          color,
          size: 5 + (i % 3) * 3,
        };
      }),
    [burst]
  );

  const undoLast = useCallback(() => {
    setHistory((prev) => {
      if (!prev.length) return prev;
      const last = prev[prev.length - 1];
      const item = items[last];
      if (item) {
        setTags((t) => {
          const next = { ...t };
          delete next[item.path];
          return next;
        });
      }
      setIndex(last);
      return prev.slice(0, -1);
    });
  }, [items]);

  const finish = useCallback(async () => {
    if (applying) return;
    setApplying(true);
    const moves = items.filter((it) => tags[it.path]).map((it) => ({ path: it.path, tag: tags[it.path] }));
    try {
      const result = await api.applyReview(moves, recycleReject);
      onFinished(result);
    } catch (e) {
      setApplying(false);
      window.alert(`结束筛选失败: ${(e as Error).message}`);
    }
  }, [applying, items, tags, recycleReject, onFinished]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (applying) return;
      const map: Record<string, ReviewTag> = {
        ArrowLeft: "treasure",
        ArrowDown: "fine",
        ArrowRight: "reject",
        ArrowUp: "favorites",
      };
      if (map[e.key]) {
        e.preventDefault();
        tag(map[e.key]);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        undoLast();
      } else if (e.key === "Enter") {
        e.preventDefault();
        finish();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applying, tag, undoLast, finish, onCancel]);

  const prev = index > 0 ? items[index - 1] : null;
  const next = index < items.length - 1 ? items[index + 1] : null;
  const keyHint = (key: string) =>
    key === "ArrowLeft" ? "←" : key === "ArrowDown" ? "↓" : key === "ArrowRight" ? "→" : "↑";

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-sm text-[var(--muted)]">这个分类里没有图片</p>
        <button onClick={onCancel} className="rounded-lg bg-[var(--hover)] px-4 py-2 text-sm">
          返回
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full animate-fade-in-up flex-col">
      {/* 深色空间场景蒙层 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 18%, rgba(34,36,50,0.42), rgba(6,7,10,0.86))",
        }}
      />

      <div className="glass sticky top-0 z-20 flex items-center gap-3 border-x-0 border-t-0 px-4 py-2">
        <span className="text-sm font-medium">筛选模式 · {categoryLabel}</span>
        <span className="text-xs text-[var(--muted)]">
          {index + 1} / {items.length} · 已标记 {taggedCount}
        </span>
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
        {/* 主色光晕，增强空间氛围 */}
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-1/2 h-[54vh] w-[54vh] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "radial-gradient(circle, var(--accent), transparent 70%)" }}
        />

        {/* 上一张：被中间遮盖的抽象卡片（无图时为占位块） */}
        <div className="z-0 -mr-10 w-56 shrink-0">
          <div className="aspect-square w-full -rotate-6 overflow-hidden rounded-2xl bg-[var(--hover)] opacity-45 shadow-[0_20px_50px_-18px_rgba(0,0,0,0.8)] brightness-[0.55]">
            {prev ? (
              <img
                src={api.libraryImageUrl(prev.path)}
                alt={prev.name}
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
                没有上一张
              </div>
            )}
          </div>
        </div>

        <div className="relative flex h-full max-h-[68vh] max-w-[46vw] min-w-0 items-center justify-center">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={current.path}
              src={api.libraryImageUrl(current.path)}
              alt={current.name}
              initial={{ opacity: 0, scale: 0.9, x: 80, rotate: 3 }}
              animate={{ opacity: 1, scale: 1, x: 0, rotate: 0 }}
              exit={
                lastTag === "reject"
                  ? { opacity: 0, x: 180, rotate: 12, scale: 0.94 }
                  : { opacity: 0, x: -140, rotate: -8, scale: 0.94 }
              }
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_90px_-24px_rgba(0,0,0,0.85)]"
            />
          </AnimatePresence>
          <AnimatePresence>
            {burst > 0 && (
              <div key={burst} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                {burstParticles.map((p) => (
                  <motion.span
                    key={p.id}
                    initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                    animate={{ opacity: 0, x: p.dx, y: p.dy, scale: 0.4 }}
                    transition={{ duration: 0.55, ease: "easeOut" }}
                    className="absolute rounded-full"
                    style={{ width: p.size, height: p.size, background: p.color }}
                  />
                ))}
              </div>
            )}
          </AnimatePresence>
          {currentTag && (
            <span
              className="absolute left-3 top-3 rounded-full px-3 py-1 text-xs font-semibold text-white shadow"
              style={{ background: TAGS.find((t) => t.tag === currentTag)?.color }}
            >
              {TAGS.find((t) => t.tag === currentTag)?.label}
            </span>
          )}
        </div>

        {/* 下一张：被中间遮盖的抽象卡片 */}
        <div className="z-0 -ml-10 w-56 shrink-0">
          <div className="aspect-square w-full rotate-6 overflow-hidden rounded-2xl bg-[var(--hover)] opacity-45 shadow-[0_20px_50px_-18px_rgba(0,0,0,0.8)] brightness-[0.55]">
            {next ? (
              <img
                src={api.libraryImageUrl(next.path)}
                alt={next.name}
                draggable={false}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-[var(--muted)]">
                没有下一张
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="glass relative z-10 border-x-0 border-b-0 px-4 py-3">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {TAGS.map((t) => (
            <button
              key={t.tag}
              onClick={() => tag(t.tag)}
              className="flex min-w-[118px] flex-col items-center gap-0.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.04] active:scale-95"
              style={{ background: t.color }}
              title={`快捷键 ${keyHint(t.key)}`}
            >
              <t.icon size={17} />
              {t.label}
              <span className="text-[10px] font-normal opacity-80">按键 {keyHint(t.key)}</span>
            </button>
          ))}

          <div className="mx-1 h-12 w-px bg-[var(--border)]" />

          <button
            onClick={undoLast}
            disabled={!history.length}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--hover)] px-4 py-3 text-sm disabled:opacity-40"
            title="Backspace 撤销上一步"
          >
            <Undo2 size={15} /> 撤销
          </button>
          <button
            onClick={finish}
            disabled={applying}
            className="flex items-center gap-1.5 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: "var(--accent)" }}
            title="开始移动文件到对应文件夹"
          >
            <Check size={16} /> 结束筛选
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--hover)] px-4 py-3 text-sm text-[var(--muted)] hover:text-[var(--text)]"
            title="放弃本次筛选，不移动图片"
          >
            <X size={15} /> 退出
          </button>
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--muted)]">
          结束筛选：开始移动文件到对应文件夹 · 退出：放弃本次筛选（不移动图片）
        </p>
      </div>
    </div>
  );
}
