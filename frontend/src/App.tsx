import { useEffect } from "react";
import { HashRouter, Route, Routes, useLocation } from "react-router-dom";
import { AppSidebar } from "./components/AppSidebar";
import { ToastHost } from "./components/UI";
import { TopBar } from "./components/TopBar";
import { cn } from "./lib";
import { Gallery } from "./pages/Gallery";
import { Home } from "./pages/Home";
import { Placeholder } from "./pages/Placeholder";
import { Settings } from "./pages/Settings";
import { useSidebarStore } from "./sidebarStore";
import { useStore } from "./store";

function Shortcuts() {
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);
  return null;
}

function Shell() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);
  const sidebarOpen = useSidebarStore((s) => s.open);
  const setSidebarOpen = useSidebarStore((s) => s.setOpen);
  const location = useLocation();

  useEffect(() => {
    init();
  }, [init]);

  // 图库页面自动打开侧边栏，其他页面保持用户手动状态
  useEffect(() => {
    if (location.pathname === "/library") setSidebarOpen(true);
  }, [location.pathname, setSidebarOpen]);

  return (
    <>
      <Shortcuts />
      <div className="flex h-full flex-col">
        <TopBar />
        <AppSidebar />
        <main className={cn("min-h-0 flex-1 transition-[padding]", sidebarOpen && "pl-56")}>
          {ready ? (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/library" element={<Gallery />} />
              <Route
                path="/publish"
                element={
                  <Placeholder
                    module="publish"
                    title="发布处理"
                    desc="M3 模块：从图库勾选图片进入发布暂存区，批量执行超分降噪、数据抹除、批量重命名。"
                  />
                }
              />
            </Routes>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[var(--muted)]">
              正在加载…
            </div>
          )}
        </main>
      </div>
      <ToastHost />
    </>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
