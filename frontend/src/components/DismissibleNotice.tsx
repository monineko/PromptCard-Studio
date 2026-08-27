import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useState } from "react";

type DismissibleNoticeProps = {
  storageKey: string;
  title: string;
  children: ReactNode;
  icon: ReactNode;
  topClassName?: string;
};

/** 固定在页面右上角、可选择不再提示的轻量说明卡片。 */
export function DismissibleNotice({ storageKey, title, children, icon, topClassName = "top-20" }: DismissibleNoticeProps) {
  const [open, setOpen] = useState(() => localStorage.getItem(storageKey) !== "1");

  if (!open) return null;
  return (
    <aside className={`fixed right-4 ${topClassName} z-[89] w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-[var(--accent)]/35 bg-[var(--panel)]/95 p-4 shadow-2xl backdrop-blur-md`}>
      <div className="flex items-start gap-3">
        {icon}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 text-xs leading-5 text-[var(--muted)]">{children}</div>
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              onChange={(event) => {
                if (!event.target.checked) return;
                localStorage.setItem(storageKey, "1");
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
