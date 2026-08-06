import { Image, Rocket } from "lucide-react";

export function Placeholder({ module, title, desc }: { module: "library" | "publish"; title: string; desc: string }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="glass max-w-md rounded-2xl p-8 text-center">
        <div
          className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-lg"
          style={{ background: "var(--accent)" }}
        >
          {module === "library" ? <Image size={24} /> : <Rocket size={24} />}
        </div>
        <h2 className="mb-2 text-lg font-semibold">{title}</h2>
        <p className="text-sm leading-relaxed text-[var(--muted)]">{desc}</p>
        <span className="mt-4 inline-block rounded-full bg-[var(--hover)] px-3 py-1 text-xs text-[var(--muted)]">
          预留模块 · 规划中
        </span>
      </div>
    </div>
  );
}
