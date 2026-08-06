import { motion } from "framer-motion";
import {
  Home,
  Images,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Rocket,
  Settings as SettingsIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { cn } from "../lib";
import { useSidebarStore } from "../sidebarStore";

const NAV_ITEMS = [
  { to: "/", label: "提示词工作区", icon: Home },
  { to: "/library", label: "图片库", icon: Images },
  { to: "/settings", label: "设置", icon: SettingsIcon },
  { to: "/publish", label: "发布处理", icon: Rocket, soon: true },
];

/**
 * 全局左侧抽屉侧边栏：
 * 上方页面导航 / 中间时间索引（仅图库图片流页）/ 底部筛选模式按钮。
 * 图库页面自动展开，其他页面可手动收起/打开（宽度动画，向左收起）。
 */
export function AppSidebar() {
  const open = useSidebarStore((s) => s.open);
  const groups = useSidebarStore((s) => s.groups);
  const activeGroup = useSidebarStore((s) => s.activeGroup);
  const reviewAvailable = useSidebarStore((s) => s.reviewAvailable);
  const scrollTo = useSidebarStore((s) => s.scrollTo);
  const startReview = useSidebarStore((s) => s.startReview);
  const setOpen = useSidebarStore((s) => s.setOpen);

  return (
    <>
      {/* 左侧居中半透明开关把手，随侧边栏边缘移动 */}
      <motion.button
        initial={false}
        animate={{ left: open ? 224 : 0, y: "-50%" }}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        onClick={() => setOpen(!open)}
        className="fixed top-1/2 z-40 flex h-11 w-6 items-center justify-center rounded-r-xl bg-black/30 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/50"
        title={open ? "收起侧边栏" : "打开侧边栏"}
      >
        {open ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />}
      </motion.button>

      <aside className="fixed bottom-0 left-0 top-14 z-20">
        <motion.div
          initial={false}
          animate={{ width: open ? 224 : 0 }}
          transition={{ duration: 0.22, ease: "easeInOut" }}
          className="h-full overflow-hidden"
        >
          <div className="glass flex h-full w-56 flex-col rounded-r-2xl border-y-0 border-l-0 p-3">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors",
                    isActive
                      ? "bg-[var(--accent)] font-medium text-white"
                      : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  )
                }
                title={item.label}
              >
                <item.icon size={15} />
                <span className="truncate">{item.label}</span>
                {item.soon && (
                  <span className="ml-auto rounded bg-[var(--hover)] px-1 text-[10px] text-[var(--muted)]">
                    M3
                  </span>
                )}
              </NavLink>
            ))}
          </nav>

          {groups.length > 0 && (
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <div className="mb-1.5 flex items-center gap-1 px-1 text-xs font-semibold text-[var(--muted)]">
                <ListOrdered size={12} /> 时间索引
              </div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-auto pr-0.5">
                {groups.map((g) => (
                  <button
                    key={g.key}
                    onClick={() => scrollTo?.(g.key)}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                      activeGroup === g.key
                        ? "bg-[var(--accent)] font-semibold text-white"
                        : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                    )}
                    title={`跳转到 ${g.label}`}
                  >
                    <span className="truncate">{g.label}</span>
                    <span className="shrink-0 tabular-nums opacity-70">{g.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {reviewAvailable && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <button
                onClick={() => startReview?.()}
                className="flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold text-white transition-opacity hover:opacity-85"
                style={{ background: "var(--accent)" }}
              >
                <Play size={16} /> 筛选模式
              </button>
            </div>
          )}
          </div>
        </motion.div>
      </aside>
    </>
  );
}
