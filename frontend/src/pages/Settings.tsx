import { Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../components/UI";
import { useStore } from "../store";

export function Settings() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const [form, setForm] = useState({
    mode: "dark",
    accent: "#8b5cf6",
    glass: 0.6,
    format_input: true,
    library_path: "",
    recycle_reject: true,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      mode: settings.theme.mode,
      accent: settings.theme.accent,
      glass: settings.theme.glass,
      format_input: settings.format_input,
      library_path: settings.library_path,
      recycle_reject: settings.recycle_reject,
    });
  }, [settings]);

  if (!settings) return <div className="p-8 text-sm text-[var(--muted)]">加载中…</div>;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <h1 className="mb-5 text-lg font-semibold">设置</h1>
      <div className="glass space-y-5 rounded-2xl p-5">
        <div>
          <label className="mb-2 block text-sm">主题模式</label>
          <div className="flex gap-2">
            {(
              [
                ["dark", "暗色"],
                ["light", "亮色"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setForm({ ...form, mode: value })}
                className={
                  "rounded-lg border px-4 py-1.5 text-sm transition-all " +
                  (form.mode === value
                    ? "border-transparent text-white"
                    : "border-[var(--border)] text-[var(--muted)]")
                }
                style={form.mode === value ? { background: "var(--accent)" } : undefined}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <label className="text-sm">主色</label>
          <input
            type="color"
            value={form.accent}
            onChange={(e) => setForm({ ...form, accent: e.target.value })}
            className="h-8 w-12 cursor-pointer rounded-lg border-0 bg-transparent"
          />
          <span className="font-mono text-xs text-[var(--muted)]">{form.accent}</span>
        </div>

        <div>
          <label className="mb-1 block text-sm">
            玻璃强度 <span className="text-xs text-[var(--muted)]">{form.glass.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={form.glass}
            onChange={(e) => setForm({ ...form, glass: Number(e.target.value) })}
            className="w-full accent-[var(--accent)]"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.format_input}
            onChange={(e) => setForm({ ...form, format_input: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          复制时进行格式规范化（清理连续逗号/多余空格）
        </label>

        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.recycle_reject}
            onChange={(e) => setForm({ ...form, recycle_reject: e.target.checked })}
            className="accent-[var(--accent)]"
          />
          筛选结束后 Reject 图片移入系统回收站（关闭则永久删除）
        </label>

        <div>
          <label className="mb-1 block text-sm">图片库路径（M2 使用）</label>
          <input
            value={form.library_path}
            onChange={(e) => setForm({ ...form, library_path: e.target.value })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">服务端口：{settings.port}（修改需重启）</span>
          <Button
            onClick={() =>
              saveSettings({
                theme: { mode: form.mode as "light" | "dark", accent: form.accent, glass: form.glass },
                format_input: form.format_input,
                library_path: form.library_path,
                recycle_reject: form.recycle_reject,
              })
            }
          >
            <Save size={14} /> 保存设置
          </Button>
        </div>
      </div>
    </div>
  );
}
