import { useEffect, useRef, useState } from "react";

/**
 * 灯箱内的可缩放图片：
 * - 滚轮以指针位置为锚点放大/缩小（1x–8x）；
 * - 放大后按下即可拖拽移动（无长按延迟）；
 * - 已移除“单击任意位置关闭”，关闭请用右上角按钮或 Esc。
 */
export function ZoomableImage({ src }: { src: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const viewRef = useRef(view);
  viewRef.current = view;

  const [grabbing, setGrabbing] = useState(false);
  const grabbingRef = useRef(false);
  const lastPoint = useRef({ x: 0, y: 0 });

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

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (viewRef.current.scale <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 部分浏览器特殊情况下会抛错，忽略 */
    }
    lastPoint.current = { x: e.clientX, y: e.clientY };
    grabbingRef.current = true;
    setGrabbing(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!grabbingRef.current) return;
    e.stopPropagation();
    const dx = e.clientX - lastPoint.current.x;
    const dy = e.clientY - lastPoint.current.y;
    lastPoint.current = { x: e.clientX, y: e.clientY };
    const v = viewRef.current;
    setView({ ...v, x: v.x + dx, y: v.y + dy });
  };

  const endPointer = () => {
    if (!grabbingRef.current) return;
    grabbingRef.current = false;
    setGrabbing(false);
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onPointerLeave={endPointer}
      className={
        "flex h-full w-full touch-none items-center justify-center overflow-hidden " +
        (grabbing ? "cursor-grabbing" : "cursor-zoom-in")
      }
      title="滚轮缩放 · 放大后按下拖动 · Esc 或右上角关闭"
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
