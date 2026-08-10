import { motion } from "framer-motion";
import { Moon, Palette, Sun } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import projectIcon from "../assets/icons/project-icon.png";
import { cn } from "../lib";
import { useStore } from "../store";
import { useNavStore } from "../store/navStore";
import { IconBtn } from "./UI";

export function TopBar() {
  const settings = useStore((s) => s.settings);
  const setTheme = useStore((s) => s.setTheme);
  const mode = settings?.theme.mode ?? "dark";
  const accent = settings?.theme.accent ?? "#8b5cf6";
  const navigate = useNavigate();

  const links = [
    { to: "/", label: "提示词工作区" },
    { to: "/library", label: "图片库" },
    { to: "/publish", label: "发布处理" },
    { to: "/settings", label: "设置" },
  ];

  return (
    <motion.header
      initial={false}
      className="glass sticky top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-x-0 border-t-0 px-3 py-2.5"
    >
      {/* 最左边：项目名与图标（点击回到提示词工作区） */}
      <button
        onClick={() => navigate("/")}
        className="flex w-fit cursor-pointer items-center gap-2 rounded-lg justify-self-start transition-opacity hover:opacity-80"
        title="回到提示词工作区"
      >
        <img
          src={projectIcon}
          alt="项目图标"
          className="h-8 w-8 rounded-xl object-contain shadow-lg"
        />
        <span className="text-sm font-semibold tracking-wide">PromptCard Studio</span>
      </button>

      {/* 居中的导航标签：当前选中项带浅色滑块，切换时滑动 */}
      <nav className="flex items-center gap-1">
        {links.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            onClick={() => {
              if (l.to === "/library") useNavStore.getState().goLibraryHome();
            }}
            className={({ isActive }) =>
              cn(
                "relative rounded-full px-4 py-1.5 text-sm font-bold transition-colors",
                isActive ? "text-[var(--accent)]" : "text-[var(--muted)] hover:text-[var(--text)]"
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <motion.span
                    layoutId="topnav-pill"
                    className="absolute inset-0 rounded-full"
                    style={{
                      background: "color-mix(in srgb, var(--accent) 20%, transparent)",
                      boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 32%, transparent)",
                    }}
                    transition={{ type: "spring", stiffness: 360, damping: 30 }}
                  />
                )}
                <span className="relative z-10 flex items-center gap-1">
                  {l.label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="flex items-center gap-1.5 justify-self-end">
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
        <IconBtn
          title={mode === "dark" ? "切换为亮色" : "切换为暗色"}
          onClick={() => setTheme({ mode: mode === "dark" ? "light" : "dark" })}
        >
          {mode === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </IconBtn>
      </div>
    </motion.header>
  );
}
