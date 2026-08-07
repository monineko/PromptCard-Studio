import { CheckCircle2, ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { cn } from "../lib";
import { useGenerateStore } from "../store/generate";
import type { VibeItem } from "../types";

export function VibePanel() {
  const [items, setItems] = useState<VibeItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const params = useGenerateStore((s) => s.params);
  const vibes = useGenerateStore((s) => s.vibes);
  const setVibes = useGenerateStore((s) => s.setVibes);

  useEffect(() => {
    api
      .vibes()
      .then(setItems)
      .catch((e) => setError((e as Error).message));
  }, []);

  const add = (it: VibeItem) => {
    if (vibes.some((v) => v.id === it.id)) return;
    setVibes([
      ...vibes,
      {
        id: it.id,
        name: it.name,
        thumbnail: it.thumbnail,
        strength: it.default_strength,
        information_extracted: it.default_information_extracted,
      },
    ]);
  };

  return (
    <div className="glass rounded-2xl">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDown size={16} className="shrink-0 text-[var(--muted)]" />
        ) : (
          <ChevronRight size={16} className="shrink-0 text-[var(--muted)]" />
        )}
        <Sparkles size={15} className="shrink-0 text-[var(--accent)]" />
        <span className="text-sm font-semibold">Vibe 库</span>
        <span className="text-xs text-[var(--muted)]">
          {items.length} 个 · 点击胶囊添加到参数设置区
        </span>
      </button>
      {expanded && (
        <div className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3">
          {error && (
            <p className="col-span-full text-xs text-red-400">读取 Vibe 库失败：{error}</p>
          )}
          {items.map((it) => {
            const added = vibes.some((v) => v.id === it.id);
            const compatible = it.models.includes(params.model);
            return (
              <button
                key={it.id}
                type="button"
                onClick={() => add(it)}
                disabled={added}
                title={
                  added
                    ? "已添加"
                    : compatible
                      ? `添加 ${it.name}`
                      : "当前模型无对应编码，可切换 V4 模型后使用"
                }
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-all disabled:cursor-default",
                  added
                    ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                    : "border-[var(--border)] bg-[var(--input)] text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--hover)]",
                  !compatible && !added && "opacity-60"
                )}
              >
                {it.thumbnail ? (
                  <img
                    src={it.thumbnail}
                    alt=""
                    className="h-5 w-5 shrink-0 rounded-full border border-[var(--border)] object-cover"
                  />
                ) : (
                  <Sparkles size={12} className="shrink-0 text-[var(--muted)]" />
                )}
                <span className="truncate">{it.name}</span>
                {added && <CheckCircle2 size={12} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
