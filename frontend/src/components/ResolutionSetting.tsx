import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "../lib";
import type { GenerateParamsPayload, GenerateResolution } from "../types";
import { Button, Modal } from "./UI";

type ResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";

const STEP = 64;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 4096;

export function snapResolutionDimension(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value / STEP) * STEP));
}

export function ResolutionSetting({
  params,
  resolutions,
  lastResolution,
  onChange,
}: {
  params: GenerateParamsPayload;
  resolutions: GenerateResolution[];
  lastResolution: { width: number; height: number } | null;
  onChange: (patch: Partial<GenerateParamsPayload>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ width: params.width, height: params.height });
  const [drag, setDrag] = useState<{
    handle: ResizeHandle;
    clientX: number;
    clientY: number;
    width: number;
    height: number;
    scale: number;
  } | null>(null);

  const current = resolutions.find((item) => item.width === params.width && item.height === params.height);
  const selected = resolutions.find((item) => item.width === draft.width && item.height === draft.height);
  const groups = useMemo(() => {
    const order = ["NORMAL", "LARGE", "WALLPAPER", "SMALL"];
    return order.map((category) => ({
      category,
      items: resolutions.filter((item) => item.category === category),
    }));
  }, [resolutions]);

  const maxDimension = Math.max(
    1920,
    draft.width,
    draft.height,
    lastResolution?.width ?? 0,
    lastResolution?.height ?? 0
  );
  const viewScale = Math.min(0.18, 300 / maxDimension);
  const visualWidth = Math.max(28, draft.width * viewScale);
  const visualHeight = Math.max(28, draft.height * viewScale);
  const lastVisualWidth = lastResolution ? Math.max(20, lastResolution.width * viewScale) : 0;
  const lastVisualHeight = lastResolution ? Math.max(20, lastResolution.height * viewScale) : 0;

  useEffect(() => {
    if (!drag) return;
    const onPointerMove = (event: PointerEvent) => {
      const dx = (event.clientX - drag.clientX) / drag.scale;
      const dy = (event.clientY - drag.clientY) / drag.scale;
      const growsRight = drag.handle.includes("e");
      const growsLeft = drag.handle.includes("w");
      const growsDown = drag.handle.includes("s");
      const growsUp = drag.handle.includes("n");
      setDraft({
        width: snapResolutionDimension(drag.width + (growsRight ? dx : growsLeft ? -dx : 0), drag.width),
        height: snapResolutionDimension(drag.height + (growsDown ? dy : growsUp ? -dy : 0), drag.height),
      });
    };
    const onPointerUp = () => setDrag(null);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [drag]);

  const startResize = (handle: ResizeHandle, event: ReactPointerEvent) => {
    event.preventDefault();
    setDrag({
      handle,
      clientX: event.clientX,
      clientY: event.clientY,
      width: draft.width,
      height: draft.height,
      scale: viewScale,
    });
  };

  const handles: { handle: ResizeHandle; className: string }[] = [
    { handle: "n", className: "-top-2 left-1/2 h-4 w-14 -translate-x-1/2 cursor-ns-resize" },
    { handle: "ne", className: "-right-2 -top-2 h-5 w-5 cursor-nesw-resize" },
    { handle: "e", className: "-right-2 top-1/2 h-14 w-4 -translate-y-1/2 cursor-ew-resize" },
    { handle: "se", className: "-bottom-2 -right-2 h-5 w-5 cursor-nwse-resize" },
    { handle: "s", className: "-bottom-2 left-1/2 h-4 w-14 -translate-x-1/2 cursor-ns-resize" },
    { handle: "sw", className: "-bottom-2 -left-2 h-5 w-5 cursor-nesw-resize" },
    { handle: "w", className: "-left-2 top-1/2 h-14 w-4 -translate-y-1/2 cursor-ew-resize" },
    { handle: "nw", className: "-left-2 -top-2 h-5 w-5 cursor-nwse-resize" },
  ];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft({ width: params.width, height: params.height });
          setOpen(true);
        }}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-2 text-left outline-none transition-colors hover:border-[var(--accent)] focus:border-[var(--accent)]"
        title="打开分辨率设置"
      >
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">
            {current ? `${current.label} · ${current.category}` : "Custom"}
          </span>
          <span className="block text-[10px] text-[var(--muted)]">{params.width} × {params.height}</span>
        </span>
        <span className="shrink-0 rounded-md bg-[var(--accent)] px-3 py-1 text-xs font-medium text-white">调整</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="分辨率设置" maxW="max-w-4xl">
        <div className="space-y-4">
          <div className="relative h-[360px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--input)]/55">
            <div className="absolute inset-x-0 top-3 text-center">
              <div className="text-sm font-semibold">{draft.width} × {draft.height}</div>
              <div className="text-[10px] text-[var(--muted)]">拖动粗边框或控制点；尺寸自动吸附到 64 的倍数</div>
            </div>

            {lastResolution && (
              <div
                className="pointer-events-none absolute bottom-7 left-1/2 -translate-x-1/2 border-2 border-dashed border-amber-400/65 bg-amber-400/5"
                style={{ width: lastVisualWidth, height: lastVisualHeight }}
                title={`上一次生成：${lastResolution.width} × ${lastResolution.height}`}
              />
            )}

            <div
              className="absolute left-1/2 top-[47%] flex -translate-x-1/2 -translate-y-1/2 select-none items-center justify-center border-4 border-[var(--accent)] bg-[var(--accent)]/10 shadow-[0_0_28px_color-mix(in_srgb,var(--accent)_20%,transparent)]"
              style={{ width: visualWidth, height: visualHeight }}
            >
              <span className="rounded bg-[var(--panel-solid)]/85 px-2 py-1 text-[10px] font-medium shadow">
                {selected ? `${selected.label} · ${selected.category}` : "Custom"}
              </span>
              {handles.map(({ handle, className }) => (
                <button
                  key={handle}
                  type="button"
                  aria-label={`拖动${handle}边缘调整分辨率`}
                  onPointerDown={(event) => startResize(handle, event)}
                  className={cn(
                    "absolute rounded-sm border-2 border-white bg-[var(--accent)] shadow",
                    className
                  )}
                />
              ))}
            </div>

            <div className="absolute bottom-2 left-3 flex items-center gap-2 text-[10px] text-[var(--muted)]">
              <span className="inline-block h-3 w-5 border-2 border-dashed border-amber-400/65" />
              {lastResolution
                ? `上一次生成 ${lastResolution.width} × ${lastResolution.height}`
                : "尚无上一次生成尺寸"}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <label className="text-xs text-[var(--muted)]">
              宽度
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_DIMENSION}
                step={STEP}
                value={draft.width}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    width: snapResolutionDimension(Number(event.target.value), value.width),
                  }))
                }
                className="ml-1.5 w-24 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-center text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <span className="text-xs text-[var(--muted)]">×</span>
            <label className="text-xs text-[var(--muted)]">
              高度
              <input
                type="number"
                min={MIN_DIMENSION}
                max={MAX_DIMENSION}
                step={STEP}
                value={draft.height}
                onChange={(event) =>
                  setDraft((value) => ({
                    ...value,
                    height: snapResolutionDimension(Number(event.target.value), value.height),
                  }))
                }
                className="ml-1.5 w-24 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-center text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]"
              />
            </label>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            {groups.map((group) => (
              <div key={group.category} className="flex flex-col gap-1 rounded-xl border border-[var(--border)] p-2">
                <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                  {group.category}
                </div>
                {group.items.map((item) => (
                  <button
                    key={`${group.category}:${item.label}`}
                    type="button"
                    onClick={() => setDraft({ width: item.width, height: item.height })}
                    className={cn(
                      "rounded-lg px-2 py-1.5 text-left transition-colors",
                      selected?.width === item.width && selected?.height === item.height
                        ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "text-[var(--text)] hover:bg-[var(--hover)]"
                    )}
                  >
                    <span className="block text-xs leading-tight">{item.label}</span>
                    <span className="block text-[10px] leading-tight text-[var(--muted)]">
                      {item.width} × {item.height}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            <div className="flex flex-col gap-1 rounded-xl border border-[var(--border)] p-2">
              <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                CUSTOM
              </div>
              <div
                className={cn(
                  "rounded-lg px-2 py-1.5 text-left text-xs",
                  !selected ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--muted)]"
                )}
              >
                <span className="block">Custom</span>
                <span className="block text-[10px] text-[var(--muted)]">拖动边框或输入数值</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
            <Button
              onClick={() => {
                onChange(draft);
                setOpen(false);
              }}
            >
              应用分辨率
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
