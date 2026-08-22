import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { BatchPanel } from "../components/BatchPanel";
import { CardPanel } from "../components/CardPanel";
import { GenerationPanel } from "../components/GenerationPanel";
import { HomeNav } from "../components/HomeNav";
import { Workspace } from "../components/Workspace";

export function Home() {
  const location = useLocation();

  // Home is mounted after Shell's route transition completes, so the target
  // exists here even when AnimatePresence is waiting for Gallery to exit.
  useEffect(() => {
    if (location.state?.scrollTarget !== "prompt-cards") return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("prompt-cards")?.scrollIntoView({ behavior: "auto", block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.key, location.state]);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-4">
      <section id="prompt-workspace" className="glass relative scroll-mt-20 rounded-2xl p-4">
        <h1 className="mb-3 text-base font-semibold">Prompt 工作区</h1>
        <Workspace />
      </section>

      <section id="prompt-cards" className="flex scroll-mt-20 flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Prompt 卡包</h2>
          <span className="text-xs text-[var(--muted)]">
            点击卡包查看卡片；点击卡片可添加到工作区
          </span>
        </div>
        <CardPanel />
      </section>

      <section id="ai-settings" className="glass relative scroll-mt-20 rounded-2xl p-4">
        <h2 className="mb-3 text-base font-semibold">参数设置</h2>
        <GenerationPanel />
      </section>

      <section id="batch-generation" className="glass scroll-mt-20 rounded-2xl p-4">
        <h2 className="mb-3 text-base font-semibold">批量生成</h2>
        <BatchPanel />
      </section>

      <HomeNav />
    </div>
  );
}
