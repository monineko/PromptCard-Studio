import { Check, Crown, Heart, ThumbsUp, Undo2, X, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, type TargetAndTransition } from "framer-motion";
import { api } from "../../api";
import { useGalleryVisual } from "../../store/galleryVisual";
import type { LibraryImageItem, ReviewTag } from "../../types";

const TAGS: { tag: ReviewTag; label: string; key: string; icon: typeof Crown; color: string }[] = [
  { tag: "treasure", label: "Treasure", key: "ArrowLeft", icon: Crown, color: "#f59e0b" },
  { tag: "fine", label: "Fine", key: "ArrowDown", icon: ThumbsUp, color: "#34d399" },
  { tag: "reject", label: "Reject", key: "ArrowRight", icon: XCircle, color: "#f87171" },
  { tag: "favorites", label: "收藏 (Like)", key: "ArrowUp", icon: Heart, color: "#ec4899" },
];

/**
 * 四方向离场动效：
 * - 上（Like/收藏）：粉色光芒 + 扫光 + 心形粒子向上飘散，卡片上抛
 * - 左（Treasure）：点击位置喷发烟花，卡片向左弧线抛出
 * - 下（Fine）：3D 翻转坠落（perspective + rotateX）
 * - 右（Reject）：瞬间灰化 + 向右下方旋转飞出并溶解
 * 动画期间锁定输入，动画结束后才切换到下一张。
 */
const EXIT_ANIM: Record<ReviewTag, TargetAndTransition> = {
  treasure: { opacity: 0, x: "-120vw", rotate: -20 },
  fine: { opacity: 0, y: "120vh", rotateX: 60, scale: 0.8 },
  reject: {
    opacity: 0,
    x: "120vw",
    y: 200,
    rotate: 45,
    filter: "grayscale(100%) contrast(80%) blur(8px)",
  },
  favorites: {
    opacity: 0,
    y: "-120vh",
    scale: 0.9,
    filter: "drop-shadow(0 0 28px rgba(255,105,180,0.9))",
  },
};

// 全屏大范围心形粒子：从卡片中心向四周大幅扩散上飘，约 2 秒
const HEART_PARTICLES = [
  { dx: -260, dy: -520, size: 30, rot: -24, delay: 0 },
  { dx: -150, dy: -700, size: 38, rot: 14, delay: 0.08 },
  { dx: -40, dy: -820, size: 44, rot: -6, delay: 0.16 },
  { dx: 60, dy: -760, size: 36, rot: 22, delay: 0.1 },
  { dx: 170, dy: -620, size: 32, rot: -18, delay: 0.2 },
  { dx: 260, dy: -480, size: 26, rot: 30, delay: 0.26 },
  { dx: -220, dy: -380, size: 24, rot: 12, delay: 0.3 },
  { dx: 210, dy: -350, size: 22, rot: -28, delay: 0.34 },
  { dx: 0, dy: -300, size: 20, rot: 8, delay: 0.24 },
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
  const [leaving, setLeaving] = useState<{ id: number; tag: ReviewTag; path: string } | null>(null);
  const [heartsBurst, setHeartsBurst] = useState<{ id: number; x: number; y: number } | null>(null);
  const [rejectFlash, setRejectFlash] = useState<{ id: number } | null>(null);
  const leavingSeq = useRef(0);
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;
  const centerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = items[index];
  const currentTag = current ? tags[current.path] : undefined;
  const taggedCount = Object.keys(tags).length;

  const tag = useCallback(
    (t: ReviewTag) => {
      if (!current || leavingRef.current) return; // 离场动画期间锁定，防止连击
      setTags((prev) => ({ ...prev, [current.path]: t }));
      setHistory((prev) => [...prev, index]);
      if (t === "treasure") {
        const rect = centerRef.current?.getBoundingClientRect();
        if (rect) {
          useGalleryVisual.getState().fire(rect.left + rect.width / 2, rect.top + rect.height / 2);
        }
      }
      if (t === "favorites") {
        // 心形粒子独立于卡片切换：全屏播放约 2 秒，从卡片中心向外扩散
        const rootRect = rootRef.current?.getBoundingClientRect();
        const cardRect = centerRef.current?.getBoundingClientRect();
        let sx = (rootRect?.width ?? window.innerWidth) / 2;
        let sy = (rootRect?.height ?? window.innerHeight) / 2;
        if (rootRect && cardRect) {
          sx = cardRect.left + cardRect.width / 2 - rootRect.left;
          sy = cardRect.top + cardRect.height / 2 - rootRect.top;
        }
        setHeartsBurst({ id: leavingSeq.current, x: sx, y: sy });
        window.setTimeout(() => setHeartsBurst(null), 2500);
      }
      if (t === "reject") {
        // 全屏溶解模糊：1 秒，不阻塞图片切换节奏
        setRejectFlash({ id: leavingSeq.current });
        window.setTimeout(() => setRejectFlash(null), 1300);
      }
      leavingSeq.current += 1;
      setLeaving({ id: leavingSeq.current, tag: t, path: current.path });
    },
    [current, index]
  );

  const finishLeaving = useCallback(() => {
    if (!leavingRef.current) return;
    leavingRef.current = null;
    setLeaving(null);
    setIndex((i) => Math.min(i + 1, items.length - 1));
  }, [items.length]);

  const undoLast = useCallback(() => {
    if (leavingRef.current) return;
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
    if (applying || leavingRef.current) return;
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
      if (applying || leavingRef.current) return;
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
  const locked = applying || !!leaving;

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
    <div ref={rootRef} className="relative flex h-full animate-fade-in-up flex-col">
      {/* 深色空间场景蒙层 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 50% 18%, rgba(34,36,50,0.42), rgba(6,7,10,0.86))",
        }}
      />

      {/* 全屏心形粒子（Like/收藏，独立于卡片切换，约 2 秒） */}
      <AnimatePresence>
        {heartsBurst && (
          <motion.div
            key={`hearts-${heartsBurst.id}`}
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
          >
            {HEART_PARTICLES.map((h, i) => (
              <motion.span
                key={`${heartsBurst.id}-h${i}`}
                initial={{ opacity: 0, x: 0, y: 0, scale: 0.3, rotate: 0 }}
                animate={{ opacity: [0, 1, 1, 0.85, 0], x: h.dx, y: h.dy, scale: 1.25, rotate: h.rot }}
                transition={{ duration: 2, delay: h.delay, ease: "easeOut" }}
                className="absolute text-rose-400"
                style={{
                  fontSize: h.size,
                  left: heartsBurst.x,
                  top: heartsBurst.y,
                  marginLeft: -h.size / 2,
                  marginTop: -h.size / 2,
                  textShadow: "0 0 18px rgba(255,105,180,0.95)",
                }}
              >
                ♥
              </motion.span>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 全屏溶解模糊（Reject，约 1 秒，不阻塞图片切换） */}
      <AnimatePresence>
        {rejectFlash && (
          <motion.div
            key={`reject-${rejectFlash.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 0.7, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
            className="pointer-events-none absolute inset-0 z-40"
            style={{ backdropFilter: "blur(12px) grayscale(1)", background: "rgba(8,9,12,0.35)" }}
          />
        )}
      </AnimatePresence>

      <div className="glass sticky top-0 z-20 flex items-center gap-3 border-x-0 border-t-0 px-4 py-2">
        <span className="text-sm font-medium">筛选模式 · {categoryLabel}</span>
        <span className="text-xs text-[var(--muted)]">
          {index + 1} / {items.length} · 已标记 {taggedCount}
        </span>
        {locked && <span className="text-[10px] text-[var(--muted)]">动画中…</span>}
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

        {/* 当前卡片舞台（perspective 供 Fine 3D 翻转使用） */}
        <div
          ref={centerRef}
          className="relative flex h-full max-h-[68vh] max-w-[46vw] min-w-0 items-center justify-center"
          style={{ perspective: 1000 }}
        >
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.img
              key={current.path}
              src={api.libraryImageUrl(current.path)}
              alt={current.name}
              initial={{ opacity: 0, scale: 0.92, x: 30 }}
              animate={{ opacity: 1, scale: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95, x: -20 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
              className="max-h-full max-w-full rounded-2xl object-contain shadow-[0_32px_90px_-24px_rgba(0,0,0,0.85)] will-change-transform"
            />
          </AnimatePresence>

          {/* 离场覆盖层：四方向各自轨迹与伴随特效 */}
          <AnimatePresence>
            {leaving && (
              <motion.div
                key={`leaving-${leaving.id}`}
                initial={
                  leaving.tag === "reject"
                    ? {
                        opacity: 1,
                        x: 0,
                        y: 0,
                        rotate: 0,
                        rotateX: 0,
                        scale: 1,
                        filter: "grayscale(100%) contrast(80%) blur(0px)",
                      }
                    : leaving.tag === "favorites"
                      ? {
                          opacity: 1,
                          x: 0,
                          y: 0,
                          rotate: 0,
                          rotateX: 0,
                          scale: 1,
                          filter: "drop-shadow(0 0 0px rgba(255,105,180,0))",
                        }
                      : { opacity: 1, x: 0, y: 0, rotate: 0, rotateX: 0, scale: 1 }
                }
                animate={EXIT_ANIM[leaving.tag]}
                transition={{ duration: 0.55, ease: [0.25, 0.8, 0.25, 1] }}
                onAnimationComplete={() => finishLeaving()}
                className="pointer-events-none absolute inset-0 z-30 will-change-transform will-change-opacity"
              >
                <img
                  src={api.libraryImageUrl(leaving.path)}
                  alt=""
                  draggable={false}
                  className="h-full w-full rounded-2xl object-contain"
                />
                {leaving.tag === "favorites" && (
                  <>
                    <div className="shine-sweep absolute inset-0 z-20 rounded-2xl" />
                    <div
                      className="absolute inset-0 z-10 rounded-2xl"
                      style={{
                        background:
                          "radial-gradient(circle at 50% 45%, rgba(255,105,180,0.28), transparent 68%)",
                      }}
                    />
                  </>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          {currentTag && (
            <span
              className="absolute left-3 top-3 z-10 rounded-full px-3 py-1 text-xs font-semibold text-white shadow"
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
              disabled={locked}
              className="flex min-w-[118px] flex-col items-center gap-0.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-transform hover:scale-[1.04] active:scale-95 disabled:pointer-events-none disabled:opacity-45"
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
            disabled={locked || !history.length}
            className="flex items-center gap-1.5 rounded-xl bg-[var(--hover)] px-4 py-3 text-sm disabled:pointer-events-none disabled:opacity-40"
            title="Backspace 撤销上一步"
          >
            <Undo2 size={15} /> 撤销
          </button>
          <button
            onClick={finish}
            disabled={locked}
            className="flex items-center gap-1.5 rounded-xl px-5 py-3 text-sm font-semibold text-white disabled:pointer-events-none disabled:opacity-50"
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
