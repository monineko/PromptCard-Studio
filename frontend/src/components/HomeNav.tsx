import { useEffect, useState } from "react";
import { cn } from "../lib";

const ITEMS = [
  { id: "prompt-workspace", label: "Prompt工作区" },
  { id: "prompt-cards", label: "Prompt 卡包" },
  { id: "ai-settings", label: "参数设置" },
];

/**
 * 首页右侧悬浮极简文字锚点导航：
 * 透明无外框、左侧细竖线分隔（上下渐变淡出）、文字左对齐竖线右侧，
 * 超长自动换行两行；滚动监听高亮（IntersectionObserver），点击平滑滚动。
 */
export function HomeNav() {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const sections = ITEMS.map((it) => document.getElementById(it.id)).filter(Boolean) as HTMLElement[];
    if (!sections.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px", threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, []);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <nav aria-label="页面导航" className="fixed right-4 top-1/2 z-[80] -translate-y-1/2">
      <div className="flex items-stretch gap-2.5">
        {/* 浅色分隔竖线：上下渐变淡出 */}
        <div
          className="w-[2px] shrink-0 rounded-full"
          style={{
            background:
              "linear-gradient(to bottom, transparent, color-mix(in srgb, var(--muted) 45%, transparent) 25%, color-mix(in srgb, var(--muted) 45%, transparent) 75%, transparent)",
          }}
        />
        <div className="flex flex-col justify-center gap-3.5">
          {ITEMS.map((it) => {
            const isActive = active === it.id;
            return (
              <button
                key={it.id}
                onClick={() => jump(it.id)}
                className={cn(
                  "max-w-[7rem] text-start text-[13px] leading-snug text-[var(--muted)] transition-all duration-300 hover:-translate-x-1 hover:text-[var(--text)]",
                  isActive && "font-semibold text-[var(--accent)]"
                )}
                style={{
                  color: isActive ? "var(--accent)" : undefined,
                  textShadow: isActive
                    ? "0 0 12px color-mix(in srgb, var(--accent) 55%, transparent)"
                    : undefined,
                }}
              >
                {it.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
