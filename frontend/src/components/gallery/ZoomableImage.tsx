import { useEffect, useRef, useState } from "react";

/**
 * 灯箱内的可缩放图片：滚轮以指针位置为锚点放大/缩小（1x–8x），
 * 点击任意位置触发 onClose；切换图片时自动复位。
 */
export function ZoomableImage({ src, onClose }: { src: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { scale, x, y } = viewRef.current;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const next = Math.min(8, Math.max(1, scale * factor));
      if (next === scale) return;
      if (next === 1) {
        setView({ scale: 1, x: 0, y: 0 });
        return;
      }
      // 保持指针下的图像点位置不变
      const ix = (px - rect.width / 2 - x) / scale;
      const iy = (py - rect.height / 2 - y) / scale;
      setView({
        scale: next,
        x: px - rect.width / 2 - ix * next,
        y: py - rect.height / 2 - iy * next,
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [src]);

  return (
    <div
      ref={ref}
      onClick={onClose}
      className="flex h-full w-full cursor-zoom-in items-center justify-center overflow-hidden"
      title="点击任意位置关闭 · 滚轮以指针为中心缩放"
    >
      <img
        src={src}
        alt=""
        draggable={false}
        className="max-h-full max-w-full select-none object-contain"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
          transition: view.scale === 1 ? "transform 0.15s ease-out" : "none",
        }}
      />
    </div>
  );
}
