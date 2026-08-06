import { CardPanel } from "../components/CardPanel";
import { GenerationPanel } from "../components/GenerationPanel";
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
        <GenerationPanel />
      </section>
    </div>
  );
}
