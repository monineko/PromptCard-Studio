import { motion } from "framer-motion";
import {
  CheckSquare,
  ChevronDown,
  Home,
  Images,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Rocket,
  Settings as SettingsIcon,
} from "lucide-react";
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { cn } from "../lib";
import { useSidebarStore } from "../sidebarStore";
import { useNavStore } from "../store/navStore";

const NAV_ITEMS = [
  { to: "/", label: "提示词工作区", icon: Home },
  { to: "/library", label: "图片库", icon: Images },
  { to: "/settings", label: "设置", icon: SettingsIcon },
  { to: "/publish", label: "发布处理", icon: Rocket },
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
  const startQuickPick = useSidebarStore((s) => s.startQuickPick);
  const setOpen = useSidebarStore((s) => s.setOpen);
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const toggleCat = (key: string) =>
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      {/* 左侧居中半透明开关把手，随侧边栏边缘移动 */}
      <motion.button
        initial={false}
        animate={{ left: open ? 216 : 8, y: "-50%" }}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        onClick={() => setOpen(!open)}
        className="fixed top-1/2 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white shadow-lg backdrop-blur-md transition-colors hover:bg-black/60"
        title={open ? "收起侧边栏" : "打开侧边栏"}
      >
        {open ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
      </motion.button>

      {/* 悬浮卡片式侧边栏：与左边界留出空隙，独立圆角矩形 */}
      <aside className="fixed bottom-3 left-3 top-16 z-20">
        <motion.div
          initial={false}
          animate={{ width: open ? 224 : 0 }}
          transition={{ duration: 0.22, ease: "easeInOut" }}
          className="h-full overflow-hidden"
        >
          <div className="glass flex h-full w-56 flex-col rounded-2xl p-3 shadow-2xl">
          <nav className="space-y-1">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => {
                  if (item.to === "/library") useNavStore.getState().goLibraryHome();
                }}
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
              </NavLink>
            ))}
          </nav>

          {groups.length > 0 && (
            <div className="mt-4 flex min-h-0 flex-1 flex-col">
              <div className="mb-1.5 flex items-center gap-1 px-1 text-xs font-semibold text-[var(--muted)]">
                <ListOrdered size={12} /> 时间索引
              </div>
              <div className="min-h-0 flex-1 space-y-0.5 overflow-auto pr-0.5">
                {groups.map((g) =>
                  g.children?.length ? (
                    <div key={g.key}>
                      <button
                        onClick={() => toggleCat(g.key)}
                        className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-[var(--text)] transition-colors hover:bg-[var(--hover)]"
                        title="点击展开/收起日期"
                      >
                        <ChevronDown
                          size={12}
                          className={cn("shrink-0 transition-transform", !expandedCats.has(g.key) && "-rotate-90")}
                        />
                        <span className="truncate">{g.label}</span>
                        <span className="ml-auto shrink-0 tabular-nums opacity-70">{g.count}</span>
                      </button>
                      {expandedCats.has(g.key) && (
                        <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
                          {g.children.map((c) => (
                            <button
                              key={c.key}
                              onClick={() => scrollTo?.(c.key)}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-xs transition-colors",
                                activeGroup === c.key
                                  ? "bg-[var(--accent)] font-semibold text-white"
                                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                              )}
                              title={`跳转到 ${c.label}`}
                            >
                              <span className="truncate">{c.label}</span>
                              <span className="shrink-0 tabular-nums opacity-70">{c.count}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : (
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
                  )
                )}
              </div>
            </div>
          )}

          {reviewAvailable && (
            <div className="mt-3 border-t border-[var(--border)] pt-3">
              <button
                onClick={() => startQuickPick?.()}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--hover)] px-4 py-2.5 text-sm font-medium transition-colors hover:bg-[var(--accent)] hover:text-white"
                title="多选图片，批量移动到其他文件夹"
              >
                <CheckSquare size={15} /> 快捷选取
              </button>
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
