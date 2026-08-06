import { useEffect, useRef } from "react";

const PETAL_COLORS = ["255,179,198", "255,205,214", "250,170,190", "255,222,229"];

type Petal = {
  x: number;
  y: number;
  size: number;
  speedY: number;
  swayAmp: number;
  swayFreq: number;
  phase: number;
  rot: number;
  rotV: number;
  color: string;
  alpha: number;
};

/**
 * 背景樱花落花粒子：透明 Canvas，26 片花瓣缓慢下落并左右摇摆。
 * 仅作视觉装饰，不接收任何交互事件。
 */
export function SakuraCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const petals: Petal[] = Array.from({ length: 26 }, (_, i) => ({
      x: Math.random() * w,
      y: Math.random() * h,
      size: 6 + Math.random() * 8,
      speedY: 0.35 + Math.random() * 0.55,
      swayAmp: 14 + Math.random() * 26,
      swayFreq: 0.004 + Math.random() * 0.007,
      phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI * 2,
      rotV: (Math.random() - 0.5) * 0.022,
      color: PETAL_COLORS[i % PETAL_COLORS.length],
      alpha: 0.45 + Math.random() * 0.35,
    }));

    let t = 0;
    const draw = () => {
      t += 1;
      ctx.clearRect(0, 0, w, h);
      for (const p of petals) {
        p.y += p.speedY;
        p.x += Math.sin(t * p.swayFreq + p.phase) * 0.42;
        p.rot += p.rotV;
        if (p.y > h + 18) {
          p.y = -18;
          p.x = Math.random() * w;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = p.alpha;
        const grad = ctx.createLinearGradient(0, -p.size, 0, p.size);
        grad.addColorStop(0, `rgba(${p.color},0.9)`);
        grad.addColorStop(1, `rgba(${p.color},0.3)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.bezierCurveTo(p.size * 0.9, -p.size * 0.4, p.size * 0.55, p.size * 0.75, 0, p.size);
        ctx.bezierCurveTo(-p.size * 0.55, p.size * 0.75, -p.size * 0.9, -p.size * 0.4, 0, -p.size);
        ctx.fill();
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />;
}
