import { motion } from "framer-motion";
import { Moon, Palette, PanelLeftClose, PanelLeftOpen, Rocket, Sparkles, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../lib";
import { useSidebarStore } from "../sidebarStore";
import { useStore } from "../store";
import { IconBtn } from "./UI";

export function TopBar() {
  const settings = useStore((s) => s.settings);
  const setTheme = useStore((s) => s.setTheme);
  const sidebarOpen = useSidebarStore((s) => s.open);
  const setSidebarOpen = useSidebarStore((s) => s.setOpen);
  const mode = settings?.theme.mode ?? "dark";
  const accent = settings?.theme.accent ?? "#8b5cf6";
  const [hidden, setHidden] = useState(false);

  // 向下滚动时顶部导航自动隐藏（保留），向上滚动恢复
  useEffect(() => {
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      setHidden(y > lastY && y > 80);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const links = [
    { to: "/", label: "提示词工作区" },
    { to: "/settings", label: "设置" },
    { to: "/library", label: "图片库" },
    { to: "/publish", label: "发布处理", soon: true },
  ];

  return (
    <motion.header
      initial={false}
      animate={{ y: hidden ? -64 : 0 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="glass sticky top-0 z-30 flex items-center gap-3 border-x-0 border-t-0 px-3 py-2.5"
    >
      <IconBtn
        title={sidebarOpen ? "收起侧边栏" : "打开侧边栏"}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="h-8 w-8"
      >
        {sidebarOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </IconBtn>
      <div className="flex items-center gap-2">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-xl text-white shadow-lg"
          style={{ background: "var(--accent)" }}
        >
          <Sparkles size={16} />
        </span>
        <span className="text-sm font-semibold tracking-wide">Novelai Prompt Manager</span>
      </div>

      <nav className="ml-4 flex items-center gap-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            className={({ isActive }) =>
              cn(
                "relative flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm transition-colors",
                isActive ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              )
            }
          >
            {l.label}
            {l.soon && (
              <span className="rounded bg-[var(--hover)] px-1 text-[10px] text-[var(--muted)]">M2/M3</span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="ml-auto flex items-center gap-1.5">
        <label
          className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-[var(--muted)]"
          title="主色"
        >
          <Palette size={13} />
          <input
            type="color"
            value={accent}
            onChange={(e) => setTheme({ accent: e.target.value })}
            className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
          />
        </label>
        <IconBtn title={mode === "dark" ? "切换为亮色" : "切换为暗色"} onClick={() => setTheme({ mode: mode === "dark" ? "light" : "dark" })}>
          {mode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </IconBtn>
      </div>
    </motion.header>
  );
}
