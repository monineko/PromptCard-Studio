import { ImagePlus, X } from "lucide-react";
import { useEffect, useState } from "react";

const DISMISSED_KEY = "promptcard:library-drag-import-notice-dismissed";

export function LibraryDragImportNotice({ enabled }: { enabled: boolean }) {
  const [open, setOpen] = useState(() => localStorage.getItem(DISMISSED_KEY) !== "1");

  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  if (!enabled || !open) return null;
  return (
    <aside className="fixed right-4 top-36 z-[89] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[var(--accent)]/35 bg-[var(--panel)]/95 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-start gap-3">
        <ImagePlus size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">现在可以直接拖图导入</div>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            将桌面、资源管理器、聊天软件或网页中的图片拖到图片库；拖到相册卡片可直接导入对应分类。
          </p>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              onChange={(event) => {
                if (!event.target.checked) return;
                localStorage.setItem(DISMISSED_KEY, "1");
                setOpen(false);
              }}
            />
            不再提示
          </label>
        </div>
        <button
          type="button"
          className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title="暂时关闭提示"
          onClick={() => setOpen(false)}
        >
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}
