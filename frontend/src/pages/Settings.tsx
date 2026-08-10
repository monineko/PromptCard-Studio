import { FolderOpen, Images, KeyRound, Power, RefreshCw, Save, Undo2, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { DEFAULT_BACKDROPS } from "../assets/backgrounds";
import { Button, ConfirmDialog } from "../components/UI";
import { useStore } from "../store";
import { useGalleryVisual } from "../store/galleryVisual";
import type { DictionaryStatus } from "../types";

export function Settings() {
  const settings = useStore((s) => s.settings);
  const saveSettings = useStore((s) => s.saveSettings);
  const setEffects = useStore((s) => s.setEffects);
  const addToast = useStore((s) => s.addToast);
  const [form, setForm] = useState({
    mode: "dark",
    accent: "#8b5cf6",
    glass: 0.6,
    format_input: true,
    library_path: "",
    recycle_reject: true,
    multi_character: true,
    show_chinese: true,
    auto_note: true,
  });
  const [dictStatus, setDictStatus] = useState<DictionaryStatus | null>(null);
  const [bgImages, setBgImages] = useState<{ name: string; url: string }[]>([]);
  const [bgFolder, setBgFolder] = useState("");
  const [bgLoading, setBgLoading] = useState(false);
  const [naiToken, setNaiToken] = useState("");
  const [naiConfigured, setNaiConfigured] = useState(false);
  const [naiAnlas, setNaiAnlas] = useState<number | null>(null);
  const [naiError, setNaiError] = useState("");
  const [naiSaving, setNaiSaving] = useState(false);
  const [naiChecking, setNaiChecking] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);

  const doShutdown = async () => {
    try {
      await api.systemShutdown();
      setShutdownOpen(false);
      addToast("本地服务已关闭，可关闭本页面；重新使用请运行 start_local.cmd");
    } catch (e) {
      addToast(`关闭失败：${(e as Error).message}`, "err");
      setShutdownOpen(false);
    }
  };

  useEffect(() => {
    if (!settings) return;
    setForm({
      mode: settings.theme.mode,
      accent: settings.theme.accent,
      glass: settings.theme.glass,
      format_input: settings.format_input,
      library_path: settings.library_path,
      recycle_reject: settings.recycle_reject,
      multi_character: settings.multi_character,
      show_chinese: settings.show_chinese,
      auto_note: settings.auto_note,
    });
  }, [settings]);

  useEffect(() => {
    api
      .dictStatus()
      .then(setDictStatus)
      .catch(() => {});
  }, []);

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

  const loadGenerateStatus = useCallback(async () => {
    setNaiChecking(true);
    try {
      const r = await api.generateStatus();
      setNaiConfigured(r.configured);
      setNaiAnlas(r.anlas);
      setNaiError(r.anlas_error || "");
    } catch (e) {
      setNaiError((e as Error).message);
    } finally {
      setNaiChecking(false);
    }
  }, []);

  useEffect(() => {
    void loadGenerateStatus();
  }, [loadGenerateStatus]);

  if (!settings) return <div className="p-8 text-sm text-[var(--muted)]">加载中…</div>;

  return (
    <div className="animate-fade-in-up mx-auto w-full max-w-2xl space-y-5 px-4 py-6">
      <h1 className="text-lg font-semibold">设置</h1>

      {/* ---------- NovelAI 连接 ---------- */}
      <div className="glass space-y-4 rounded-2xl p-5">
        <div className="flex items-center gap-2 border-b border-[var(--border)] pb-2">
          <span
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--accent)" }}
          >
            <Zap size={14} />
          </span>
          <h2 className="text-sm font-semibold">NovelAI 连接</h2>
          <span className="ml-auto flex items-center gap-1.5 text-xs">
            <span
              className={
                "inline-block h-2 w-2 rounded-full " +
                (naiChecking ? "animate-pulse bg-amber-400" : naiConfigured ? "bg-green-400" : "bg-red-400")
              }
            />
            {naiChecking ? "检查中…" : naiConfigured ? "已配置" : "未配置"}
          </span>
        </div>

        <div>
          <label className="mb-1 block text-sm">Token</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound
                size={14}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]"
              />
              <input
                type="password"
                value={naiToken}
                onChange={(e) => setNaiToken(e.target.value)}
                placeholder={naiConfigured ? "已保存，输入新 token 可覆盖" : "粘贴 NovelAI token（仅存本地，不回显）"}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] py-2 pl-9 pr-3 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>
            <Button
              size="sm"
              disabled={naiSaving || !naiToken.trim()}
              onClick={async () => {
                setNaiSaving(true);
                try {
                  await api.saveGenerateToken(naiToken.trim());
                  setNaiToken("");
                  setNaiConfigured(true);
                  addToast("Token 已保存到本地 config.json");
                  void loadGenerateStatus();
                } catch (e) {
                  addToast(`保存失败: ${(e as Error).message}`, "err");
                } finally {
                  setNaiSaving(false);
                }
              }}
            >
              保存
            </Button>
            {naiConfigured && (
              <Button
                size="sm"
                variant="ghost"
                disabled={naiSaving}
                onClick={async () => {
                  setNaiSaving(true);
                  try {
                    await api.saveGenerateToken("");
                    setNaiToken("");
                    setNaiConfigured(false);
                    setNaiAnlas(null);
                    setNaiError("");
                    addToast("已清除 Token");
                  } catch (e) {
                    addToast(`清除失败: ${(e as Error).message}`, "err");
                  } finally {
                    setNaiSaving(false);
                  }
                }}
              >
                清除
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--muted)]">
            Token 只写入项目本地 config.json（已加入 .gitignore），不会出现在任何接口响应或提交记录中。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--input)]/40 px-3 py-2.5">
          <span className="text-sm">
            剩余点数：<b className={naiAnlas !== null && naiAnlas > 0 ? "text-green-400" : "text-[var(--text)]"}>
              {naiAnlas !== null ? naiAnlas : naiError ? "—" : "…"}
            </b>
          </span>
          {naiError && <span className="max-w-[320px] truncate text-xs text-red-400">{naiError}</span>}
          <Button size="sm" variant="ghost" onClick={() => void loadGenerateStatus()} disabled={naiChecking}>
            <RefreshCw size={12} /> {naiChecking ? "查询中…" : "刷新点数"}
          </Button>
        </div>
      </div>

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

        <div className="space-y-3">
          <div className="text-xs font-medium text-[var(--muted)]">特效开关（更改立即生效并自动保存）</div>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.effects.background_rotation}
              onChange={(e) => setEffects({ background_rotation: e.target.checked })}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              开启背景图轮换
              <span className="block text-xs text-[var(--muted)]">
                取消后背景为纯静态颜色，仅随日间/夜间切换，降低性能需求
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.effects.review_particles}
              onChange={(e) => setEffects({ review_particles: e.target.checked })}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              开启图片筛选粒子
              <span className="block text-xs text-[var(--muted)]">
                取消后筛选模式按钮按下的烟花、爱心等粒子效果关闭
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.effects.review_animations}
              onChange={(e) => setEffects({ review_animations: e.target.checked })}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              开启图片筛选动效
              <span className="block text-xs text-[var(--muted)]">
                取消后筛选模式仅保留图片替换（去掉飞入出/变色/淡化），切换间隔更短
              </span>
            </span>
          </label>
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

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.multi_character}
            onChange={(e) => setForm({ ...form, multi_character: e.target.checked })}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            开启多角色
            <span className="block text-xs text-[var(--muted)]">
              开启：工作区「角色」分区的每个块作为独立角色槽传入生图。关闭：角色分区并入正面提示词，
              适合把角色分区当作临时挑词区时使用。
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.show_chinese}
            onChange={(e) => setForm({ ...form, show_chinese: e.target.checked })}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            显示中文翻译
            <span className="block text-xs text-[var(--muted)]">
              勾选后提示词块显示词典中文标注；取消勾选则隐藏。备注不受影响，仍可正常显示与编辑，
              手动填写的翻译也仍可在编辑弹窗中修改。
            </span>
          </span>
        </label>

        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.auto_note}
            onChange={(e) => setForm({ ...form, auto_note: e.target.checked })}
            className="mt-0.5 accent-[var(--accent)]"
          />
          <span>
            自动备注
            <span className="block text-xs text-[var(--muted)]">
              勾选后，分块或输入提示词命中词典时自动按分类预填备注（角色/动作/表情等）；
              取消勾选则只标注中文翻译，不预填备注。
            </span>
          </span>
        </label>

        <div className="rounded-2xl border border-dashed border-[var(--border)] p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-sm font-medium">提示词词典</span>
            <span className="text-xs text-[var(--muted)]">
              {dictStatus ? `内置 ${dictStatus.builtin_count} 条 · 自定义 ${dictStatus.custom_count} 条` : "读取中…"}
            </span>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-[var(--muted)]">
            分块后自动用本地词典给提示词标注中文；词典里没有的词可在块弹窗手动填写并「保存到词典」。
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              onClick={async () => {
                try {
                  const r = await api.openDictionaryFolder();
                  addToast(`已打开词典文件夹：${r.path}`);
                } catch (e) {
                  addToast(`打开失败: ${(e as Error).message}`, "err");
                }
              }}
            >
              <FolderOpen size={13} /> 打开词典文件夹
            </Button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            升级/迁移项目时，把项目根目录整个 <b>dictionary</b> 文件夹复制到新项目根目录即可保留你的自定义词典；
            custom.json 为应用内保存的词条，tags.json 为可选内置词典（可自行放入，注意其来源授权）。
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm">图片库路径（M2 使用）</label>
          <input
            value={form.library_path}
            onChange={(e) => setForm({ ...form, library_path: e.target.value })}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-[var(--muted)]">
            首选端口：{settings.port}（被占用时启动脚本自动顺延）
          </span>
          <Button
            onClick={() =>
              saveSettings({
                theme: { mode: form.mode as "light" | "dark", accent: form.accent, glass: form.glass },
                format_input: form.format_input,
                library_path: form.library_path,
                recycle_reject: form.recycle_reject,
                multi_character: form.multi_character,
                show_chinese: form.show_chinese,
                auto_note: form.auto_note,
              })
            }
          >
            <Save size={14} /> 保存设置
          </Button>
        </div>
      </div>

      {/* ---------- 本地服务 ---------- */}
      <div className="glass space-y-4 rounded-2xl p-5">
        <h2 className="border-b border-[var(--border)] pb-2 text-sm font-semibold">本地服务</h2>
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          前端页面由本机后端服务托管。点击关闭后服务立即停止，本页面将无法继续访问；再次使用请运行
          start_local.cmd。
        </p>
        <Button variant="danger" onClick={() => setShutdownOpen(true)}>
          <Power size={14} /> 关闭本地服务
        </Button>
        <ConfirmDialog
          open={shutdownOpen}
          title="关闭本地服务"
          message="确定关闭本机后端服务吗？关闭后页面将无法访问，需重新运行 start_local.cmd 才能恢复；若有批量生成正在运行也会中断。"
          danger
          onConfirm={() => void doShutdown()}
          onCancel={() => setShutdownOpen(false)}
        />
      </div>
    </div>
  );
}
