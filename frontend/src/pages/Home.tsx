import { SlidersHorizontal, Wand2 } from "lucide-react";
import { CardPanel } from "../components/CardPanel";
import { Workspace } from "../components/Workspace";

export function Home() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-4">
      <section className="glass rounded-2xl p-4">
        <h1 className="mb-3 text-base font-semibold">Prompt 工作区</h1>
        <Workspace />
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">添加 Wildcards</h2>
          <span className="text-xs text-[var(--muted)]">
            点击卡片包展开；卡片添加后自动进入对应分区
          </span>
        </div>
        <CardPanel />
      </section>

      <section className="glass rounded-2xl p-4">
        <h2 className="mb-3 text-base font-semibold">生成与参数（预留模块）</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] p-4 text-[var(--muted)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--hover)]">
              <Wand2 size={18} />
            </span>
            <div>
              <div className="text-sm font-medium text-[var(--text)]">图片生成</div>
              <div className="text-xs">对接 NovelAI 后在此批量生成（M4 规划中）</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-[var(--border)] p-4 text-[var(--muted)]">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--hover)]">
              <SlidersHorizontal size={18} />
            </span>
            <div>
              <div className="text-sm font-medium text-[var(--text)]">参数调节</div>
              <div className="text-xs">生成参数预设：分辨率、采样器、种子等（M4 规划中）</div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
