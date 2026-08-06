import { useEffect, useRef } from "react";
import { useGalleryVisual } from "../../store/galleryVisual";

const COLORS = ["#f59e0b", "#ec4899", "#a78bfa", "#fbbf24", "#34d399", "#60a5fa", "#f472b6", "#ffffff"];

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  rot: number;
  rotV: number;
  shape: "rect" | "circle";
  drag: number;
};

/**
 * 点击烟花：监听 galleryVisual 中的 fire(x, y) 事件，
 * 在点击位置喷发一圈五彩粒子（canvas-confetti 同款手法），逐渐散开消失。
 */
export function FireworksCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const spawnedRef = useRef<Set<number>>(new Set());
  const spawnRef = useRef<(x: number, y: number) => void>(() => {});

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

    spawnRef.current = (x: number, y: number) => {
      const count = 72 + Math.floor(Math.random() * 38);
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 2.5 + Math.random() * 7.5;
        const life = 55 + Math.random() * 42;
        particlesRef.current.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 1.3,
          size: 2.2 + Math.random() * 3.2,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          life,
          maxLife: life,
          rot: Math.random() * Math.PI,
          rotV: (Math.random() - 0.5) * 0.35,
          shape: Math.random() < 0.55 ? "rect" : "circle",
          drag: 0.982,
        });
      }
    };

    const draw = () => {
      const particles = particlesRef.current;
      ctx.clearRect(0, 0, w, h);
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= 1;
        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + 0.12;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.rotV;
        const k = p.life / p.maxLife;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.min(1, k * 1.9);
        ctx.fillStyle = p.color;
        if (p.shape === "rect") {
          ctx.fillRect(-p.size, -p.size * 0.45, p.size * 2, p.size * 0.9);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      particlesRef.current = [];
    };
  }, []);

  const bursts = useGalleryVisual((s) => s.bursts);
  useEffect(() => {
    for (const b of bursts) {
      if (spawnedRef.current.has(b.id)) continue;
      spawnedRef.current.add(b.id);
      spawnRef.current(b.x, b.y);
    }
  }, [bursts]);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-[9000]" />;
}
