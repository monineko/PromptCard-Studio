import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useStore } from "../../store";
import { useGalleryVisual } from "../../store/galleryVisual";
import { SakuraCanvas } from "./SakuraCanvas";

/**
 * 全屏模糊背景轮播：
 * - 固定底层 (fixed inset-0 z-0)，当前相册图片高斯模糊 + 压暗 + 放大防留白
 * - 定时淡入淡出轮播（7s 一张）
 * - 上层叠加缓慢浮动的光斑与樱花粒子
 * 图片队列由图库页根据当前分类写入 galleryVisual store。
 */
export function AmbientBackground() {
  const backdrops = useGalleryVisual((s) => s.backdrops);
  const location = useLocation();
  const [index, setIndex] = useState(0);
  const keyStr = backdrops.map((b) => b.key).join("|");
  const inLibrary = location.pathname === "/library";
  const backgroundRotation = useStore((s) => s.settings?.effects.background_rotation);

  useEffect(() => {
    setIndex(0);
  }, [keyStr]);

  useEffect(() => {
    if (backdrops.length < 2) return;
    const timer = window.setInterval(() => {
      setIndex((i) => (i + 1) % backdrops.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [backdrops.length, keyStr]);

  const current = backdrops.length ? backdrops[index % backdrops.length] : null;

  // 关闭「背景图轮换」：纯静态背景（仅日/夜主题色），不渲染图片/光斑/樱花，降低性能需求
  if (backgroundRotation === false) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <AnimatePresence initial={false}>
        {current && (
          <motion.img
            key={current.key}
            src={current.url}
            alt=""
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeInOut" }}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ filter: "blur(var(--background-blur, 30px)) brightness(0.8)", transform: "scale(1.1)" }}
          />
        )}
      </AnimatePresence>

      {/* 主题色蒙层：保证明暗主题下前景文字可读 */}
      <div
        className="absolute inset-0"
        style={{ background: "color-mix(in srgb, var(--bg) 46%, transparent)" }}
      />

      {/* 光斑：缓慢浮动的模糊色块 */}
      <div
        className="ambient-blob"
        style={{
          left: "8%",
          top: "10%",
          width: 420,
          height: 420,
          background: "radial-gradient(circle, color-mix(in srgb, var(--accent) 26%, transparent), transparent 66%)",
        }}
      />
      <div
        className="ambient-blob ambient-blob-2"
        style={{
          right: "6%",
          top: "34%",
          width: 380,
          height: 380,
          background: "radial-gradient(circle, rgba(236,72,153,0.18), transparent 66%)",
        }}
      />
      <div
        className="ambient-blob ambient-blob-3"
        style={{
          left: "28%",
          bottom: "-10%",
          width: 540,
          height: 400,
          background: "radial-gradient(circle, rgba(139,92,246,0.16), transparent 66%)",
        }}
      />

      {inLibrary && <SakuraCanvas />}
    </div>
  );
}
