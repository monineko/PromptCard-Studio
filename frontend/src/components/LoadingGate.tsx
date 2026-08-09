import { motion } from "framer-motion";
import { PackageOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * 可复用的「加载门」：
 * - loading=true 时在内容区域显示遮罩（进度条 + 文案），children 不渲染；
 * - 加载完成后遮罩快速淡出，此时 children 才挂载，
 *   因此页面的入场动画（如 animate-fade-in-up）会在遮罩消失后正常播放，不会被盖住。
 *
 * 遮罩用 portal 渲染到 document.body + fixed 定位，只覆盖顶部导航栏下方的内容区
 * （top: 52px 与应用顶部导航高度一致，导航栏保持可见；z-20 低于导航栏 z-30）。
 * 这样既不依赖页面容器高度计算（避免加载卡片先出现在顶部再回中），
 * 也不受路由切换动画（外层 transform）影响，卡片始终相对视口居中。
 *
 * 复用方式：
 *   <LoadingGate loading={loading} progress={progress} label="翻箱倒柜ing~">
 *     页面内容
 *   </LoadingGate>
 * - progress：0~1 的真实进度（可选）；省略时进度条为不确定循环动画。
 * - 需要其它文案时传 label 即可，图标与整体风格通用。
 */
export function LoadingGate({
  loading,
  label = "加载中…",
  progress,
  children,
}: {
  loading: boolean;
  label?: string;
  /** 0~1 的真实进度；省略时显示不确定进度动画 */
  progress?: number;
  children?: ReactNode;
}) {
  const pct = progress == null ? null : Math.max(0, Math.min(1, progress));
  const [shown, setShown] = useState(loading);
  const [exiting, setExiting] = useState(false);
  useEffect(() => {
    if (loading) {
      setExiting(false);
      setShown(true);
    } else if (shown) {
      setExiting(true);
      const timer = window.setTimeout(() => setShown(false), 200);
      return () => window.clearTimeout(timer);
    }
  }, [loading, shown]);

  return (
    <>
      {shown &&
        createPortal(
          <motion.div
            className="fixed inset-x-0 bottom-0 top-[52px] z-20 flex items-center justify-center"
            style={{
              background: "color-mix(in srgb, var(--bg) 68%, transparent)",
              backdropFilter: "blur(3px)",
              WebkitBackdropFilter: "blur(3px)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: exiting ? 0 : 1 }}
            transition={{ duration: 0.18 }}
          >
            <div className="glass flex w-[min(90vw,340px)] flex-col items-center gap-5 rounded-2xl px-8 py-10 shadow-2xl">
              <motion.div
                animate={{ y: [0, -6, 0], rotate: [0, -6, 0, 6, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                style={{ color: "var(--accent)" }}
              >
                <PackageOpen size={30} />
              </motion.div>

              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--hover)]">
                {pct != null ? (
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: "var(--accent)" }}
                    animate={{ width: `${pct * 100}%` }}
                    transition={{ duration: 0.3, ease: "easeOut" }}
                  />
                ) : (
                  <motion.div
                    className="h-full w-1/2 rounded-full"
                    style={{ background: "var(--accent)" }}
                    initial={{ x: "-110%" }}
                    animate={{ x: "220%" }}
                    transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                  />
                )}
              </div>

              <div className="flex items-baseline gap-0.5 text-sm text-[var(--muted)]">
                <span>{label}</span>
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    animate={{ opacity: [0.2, 1, 0.2] }}
                    transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                  >
                    .
                  </motion.span>
                ))}
              </div>

              {pct != null && (
                <span className="font-mono text-[11px] text-[var(--muted)]">
                  {Math.round(pct * 100)}%
                </span>
              )}
            </div>
          </motion.div>,
          document.body
        )}
      {!loading && children}
    </>
  );
}
