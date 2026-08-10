import { useEffect } from "react";
import { HashRouter, Link, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Images, Rocket } from "lucide-react";
import { api } from "./api";
import { DEFAULT_BACKDROPS } from "./assets/backgrounds";
import { AmbientBackground } from "./components/ambient/AmbientBackground";
import { FireworksCanvas } from "./components/ambient/FireworksCanvas";
import { AppSidebar } from "./components/AppSidebar";
import { ToastHost } from "./components/UI";
import { TopBar } from "./components/TopBar";
import { cn } from "./lib";
import { Gallery } from "./pages/Gallery";
import { Home } from "./pages/Home";
import { Settings } from "./pages/Settings";
import { useSidebarStore } from "./sidebarStore";
import { useStore } from "./store";
import { useGalleryVisual } from "./store/galleryVisual";

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
  const effects = useStore((s) => s.settings?.effects);

  useEffect(() => {
    init();
  }, [init]);

  // 加载用户背景图（backgrounds/ 文件夹素材），没有则回退内置素材
  useEffect(() => {
    let cancelled = false;
    api
      .backgrounds()
      .then((r) => {
        if (cancelled) return;
        const bd = r.images.map((im) => ({ key: `bg:${im.name}`, url: im.url }));
        useGalleryVisual.getState().setPreferred(bd.length ? bd : DEFAULT_BACKDROPS);
      })
      .catch(() => {
        if (!cancelled) useGalleryVisual.getState().setPreferred(DEFAULT_BACKDROPS);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 图片库页面不自动展开（进入图片流时才展开）；其他页面侧边栏自动向左侧隐藏
  useEffect(() => {
    if (location.pathname !== "/library") setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  return (
    <>
      <Shortcuts />
      <AmbientBackground />
      {effects?.review_particles !== false && <FireworksCanvas />}
      <div className="flex min-h-full flex-col">
        <TopBar />
        <AppSidebar />
        <main className={cn("relative z-10 min-h-0 flex-1 transition-[padding]", sidebarOpen && "pl-60")}>
          {ready ? (
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
                className="h-full"
              >
                <Routes location={location}>
                  <Route path="/" element={<Home />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/library" element={<Gallery />} />
                  <Route
                    path="/publish"
                    element={
                      <div className="flex h-full items-center justify-center p-8">
                        <div className="glass max-w-md rounded-2xl p-8 text-center">
                          <div
                            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg"
                            style={{ background: "var(--accent)" }}
                          >
                            <Rocket size={24} />
                          </div>
                          <h2 className="mb-2 text-lg font-semibold">发布处理</h2>
                          <p className="text-sm leading-relaxed text-[var(--muted)]">
                            在图片库中勾选图片，点击「快捷选取 → 发布处理」，
                            即可批量执行超分降噪、恢复原数据、数据抹除与批量重命名。
                            处理在独立暂存区进行，图库原图不受影响。
                          </p>
                          <Link
                            to="/library"
                            className="mt-5 inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-85"
                            style={{ background: "var(--accent)" }}
                          >
                            <Images size={16} /> 去图库选择图片
                          </Link>
                        </div>
                      </div>
                    }
                  />
                </Routes>
              </motion.div>
            </AnimatePresence>
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
