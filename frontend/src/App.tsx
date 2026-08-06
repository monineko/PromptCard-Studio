import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";
import { ToastHost } from "./components/UI";
import { TopBar } from "./components/TopBar";
import { Gallery } from "./pages/Gallery";
import { Home } from "./pages/Home";
import { Placeholder } from "./pages/Placeholder";
import { Settings } from "./pages/Settings";
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

export default function App() {
  const init = useStore((s) => s.init);
  const ready = useStore((s) => s.ready);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <HashRouter>
      <Shortcuts />
      <div className="flex h-full flex-col">
        <TopBar />
        <main className="min-h-0 flex-1">
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
    </HashRouter>
  );
}
