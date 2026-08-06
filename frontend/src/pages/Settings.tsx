import { FolderOpen, Images, RefreshCw, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DEFAULT_BACKDROPS } from "../assets/backgrounds";
import { Button } from "../components/UI";
import { useStore } from "../store";
import { useGalleryVisual } from "../store/galleryVisual";

export function Settings() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const addToast = useStore((s) => s.addToast);
  const [form, setForm] = useState({
    mode: "dark",
    accent: "#8b5cf6",
    glass: 0.6,
    format_input: true,
    library_path: "",
    recycle_reject: true,
  });
  const [bgImages, setBgImages] = useState<{ name: string; url: string }[]>([]);
  const [bgFolder, setBgFolder] = useState("");
  const [bgLoading, setBgLoading] = useState(false);

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

  const loadBackgrounds = useCallback(async () => {
    setBgLoading(true);
    try {
      const r = await api.backgrounds();
      setBgImages(r.images);
      setBgFolder(r.folder);
    } catch (e) {
      addToast(`读取背景图失败: ${(e as Error).message}`, "err");
    } finally {
      setBgLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadBackgrounds();
  }, [loadBackgrounds]);

  if (!settings) return <div className="p-8 text-sm text-[var(--muted)]">加载中…</div>;

  return (
    <div className="animate-fade-in-up mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
      <h1 className="text-lg font-semibold">设置</h1>

      {/* ---------- 界面个性化 ---------- */}
      <div className="glass space-y-5 rounded-2xl p-5">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--accent)" }}
          >
            <Images size={14} />
          </span>
          <h2 className="text-sm font-semibold">界面个性化</h2>
        </div>

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

        <div className="rounded-2xl border border-dashed border-[var(--border)] p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">背景图</span>
            <span className="text-xs text-[var(--muted)]">
              {bgLoading ? "扫描中…" : `文件夹内 ${bgImages.length} 张`}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
            把图片放进背景图文件夹，点击"重新扫描"即可生效；图库页面浏览时仍优先展示当前分类图片。
          </p>

          {bgImages.length > 0 ? (
            <div className="mb-3 grid grid-cols-4 gap-2">
              {bgImages.slice(0, 8).map((im) => (
                <div
                  key={im.name}
                  title={im.name}
                  className="aspect-video overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--hover)]"
                >
                  <img src={im.url} alt={im.name} className="h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
              {bgImages.length > 8 && (
                <div className="flex aspect-video items-center justify-center rounded-lg border border-[var(--border)] text-[10px] text-[var(--muted)]">
                  +{bgImages.length - 8}
                </div>
              )}
            </div>
          ) : (
            <div className="mb-3 flex aspect-video max-w-[220px] items-center justify-center rounded-xl border border-dashed border-[var(--border)] text-xs text-[var(--muted)]">
              文件夹为空，放入图片后点"重新扫描"
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const r = await api.openBackgroundsFolder();
                  addToast(`已打开背景图文件夹：${r.path}`);
                } catch (e) {
                  addToast(`打开失败: ${(e as Error).message}`, "err");
                }
              }}
            >
              <FolderOpen size={13} /> 打开背景图文件夹
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void loadBackgrounds()} disabled={bgLoading}>
              <RefreshCw size={13} /> 重新扫描
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                useGalleryVisual.getState().setPreferred(DEFAULT_BACKDROPS);
                addToast("已恢复默认背景素材");
              }}
            >
              <Undo2 size={13} /> 恢复默认
            </Button>
          </div>
          <p className="mt-2 truncate text-[11px] text-[var(--muted)]" title={bgFolder}>
            {bgFolder || "背景图文件夹路径…"}
          </p>
        </div>
      </div>

      {/* ---------- 常规设置 ---------- */}
      <div className="glass space-y-5 rounded-2xl p-5">
        <h2 className="border-b border-[var(--border)] pb-2 text-sm font-semibold">常规设置</h2>

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
          Reject 回收站内删除图片时：移入系统回收站（关闭则永久删除）
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
