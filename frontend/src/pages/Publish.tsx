import {
  ArrowRight,
  Check,
  Download,
  FolderOpen,
  GripVertical,
  Images,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useStore } from "../store";
import type {
  PublishEngineParam,
  PublishEngineStatus,
  PublishNodes,
  PublishRunStatus,
  PublishStagedItem,
} from "../types";

const NODE_ORDER: { key: keyof PublishNodes; label: string; desc: string }[] = [
  { key: "upscale", label: "超分降噪", desc: "引擎输出会抹掉 PNG 元数据，图片文件名不变" },
  { key: "restore", label: "恢复原数据", desc: "超分前提取 PNG 元数据，超分后写回（需勾选超分）" },
  { key: "wipe", label: "数据抹除", desc: "清除 PNG 内部元数据与文件名里的信息（与恢复互斥）" },
  { key: "rename", label: "批量重命名", desc: "最后执行，按下方规则生成最终文件名" },
];

const PART_META: { key: string; label: string; desc: string }[] = [
  { key: "date", label: "日期", desc: "YYYYMMDD" },
  { key: "custom", label: "自定义段", desc: "例如角色名、moni" },
  { key: "random", label: "随机数字段", desc: "6 位随机数，避免重名" },
];

function localPreview(parts: string[], custom: string): string[] {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return ["482913", "482914", "482915"].map((r) => {
    const pieces: string[] = [];
    for (const p of parts) {
      if (p === "date") pieces.push(today);
      else if (p === "custom" && custom.trim()) pieces.push(custom.trim());
      else if (p === "random") pieces.push(r);
    }
    return pieces.join("_") || r;
  });
}

function paramValue(p: PublishEngineParam, params: Record<string, string | number | boolean>) {
  return params[p.key] ?? p.default ?? (p.type === "bool" ? false : "");
}

export function Publish() {
  const navigate = useNavigate();
  const addToast = useStore((s) => s.addToast);
  const [staged, setStaged] = useState<PublishStagedItem[]>([]);
  const [stagingLoading, setStagingLoading] = useState(true);
  const [engine, setEngine] = useState<PublishEngineStatus | null>(null);
  const [engineError, setEngineError] = useState("");
  const [nodes, setNodes] = useState<PublishNodes>({
    upscale: false,
    restore: false,
    wipe: false,
    rename: false,
  });
  const [params, setParams] = useState<Record<string, string | number | boolean>>({});
  const [parts, setParts] = useState<string[]>(["date", "random"]);
  const [custom, setCustom] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [savingPath, setSavingPath] = useState(false);
  const [savingParams, setSavingParams] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<PublishRunStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const wasInstallingRef = useRef(false);

  const refreshStaging = useCallback(async () => {
    try {
      const res = await api.publishStaging();
      setStaged(res.items);
    } catch (e) {
      addToast(`暂存区加载失败: ${(e as Error).message}`, "err");
    } finally {
      setStagingLoading(false);
    }
  }, [addToast]);

  const refreshEngine = useCallback(async () => {
    try {
      const s = await api.publishEngine();
      setEngine(s);
      setEngineError("");
      setParams((prev) => {
        const next: Record<string, string | number | boolean> = {};
        for (const p of s.manifest.params) {
          next[p.key] = prev[p.key] ?? s.params[p.key] ?? p.default ?? (p.type === "bool" ? false : "");
        }
        return next;
      });
    } catch (e) {
      setEngineError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshStaging();
    void refreshEngine();
  }, [refreshStaging, refreshEngine]);

  // 引擎下载中：轮询进度
  useEffect(() => {
    if (!engine?.installing) return;
    const timer = window.setInterval(() => void refreshEngine(), 1000);
    return () => window.clearInterval(timer);
  }, [engine?.installing, refreshEngine]);

  // 安装完成/失败提示
  useEffect(() => {
    if (engine?.installing) wasInstallingRef.current = true;
    if (wasInstallingRef.current && engine && !engine.installing) {
      wasInstallingRef.current = false;
      if (engine.installed) addToast("超分引擎安装完成");
      else addToast(engine.message || "超分引擎安装失败", "err");
    }
  }, [engine, addToast]);

  // 任务运行中：轮询状态
  useEffect(() => {
    if (!runId || run?.status !== "running") return;
    const timer = window.setInterval(() => {
      void api
        .publishRunStatus(runId)
        .then(setRun)
        .catch((e) => addToast(`获取任务状态失败: ${(e as Error).message}`, "err"));
    }, 800);
    return () => window.clearInterval(timer);
  }, [runId, run?.status, addToast]);

  const running = run?.status === "running";
  const previews = useMemo(() => localPreview(parts, custom), [parts, custom]);
  const activeEngineInfo = engine?.engines.find((e) => e.id === engine.engine);

  const toggleNode = (key: keyof PublishNodes) => {
    setNodes((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      if (key === "upscale" && !next.upscale) next.restore = false;
      if (key === "wipe" && next.wipe) next.restore = false;
      return next;
    });
  };

  const togglePart = (key: string) => {
    setParts((prev) => (prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]));
  };

  const reorderPart = (from: number, to: number) => {
    if (from === to) return;
    setParts((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const removeStaged = async (item: PublishStagedItem) => {
    try {
      await api.publishStagedDelete(item.name);
      addToast(`已从暂存区移除 ${item.name}`);
      await refreshStaging();
    } catch (e) {
      addToast(`移除失败: ${(e as Error).message}`, "err");
    }
  };

  const clearStaging = async () => {
    if (!staged.length) return;
    if (!window.confirm(`确定清空发布暂存区的 ${staged.length} 张图片吗？（图库原图不受影响）`)) return;
    try {
      const res = await api.publishStagingClear();
      addToast(`已清空 ${res.removed} 张暂存图片`);
      await refreshStaging();
    } catch (e) {
      addToast(`清空失败: ${(e as Error).message}`, "err");
    }
  };

  const installEngine = async () => {
    try {
      await api.publishEngineInstall();
      await refreshEngine();
      addToast("正在下载超分引擎…");
    } catch (e) {
      addToast(`启动下载失败: ${(e as Error).message}`, "err");
    }
  };

  const saveLocalPath = async () => {
    if (!customPath.trim()) return;
    setSavingPath(true);
    try {
      const res = await api.publishEngineLocalPath(customPath.trim());
      addToast(`已使用本地引擎（${res.custom_path}）`);
      setCustomPath("");
      await refreshEngine();
    } catch (e) {
      addToast(`设置失败: ${(e as Error).message}`, "err");
    } finally {
      setSavingPath(false);
    }
  };

  const saveParams = async () => {
    if (!engine) return;
    setSavingParams(true);
    try {
      await api.publishEngineParams(engine.engine, params);
      addToast("引擎参数已保存为默认");
    } catch (e) {
      addToast(`保存失败: ${(e as Error).message}`, "err");
    } finally {
      setSavingParams(false);
    }
  };

  const canStart =
    !running &&
    !starting &&
    staged.length > 0 &&
    (nodes.upscale || nodes.wipe || nodes.rename) &&
    (!nodes.upscale || engine?.installed);

  const startRun = async () => {
    if (!canStart) return;
    setStarting(true);
    try {
      const res = await api.publishRun({
        staged: staged.map((i) => i.name),
        nodes,
        rename: { parts, custom: custom.trim() },
        engine_params: params,
      });
      setRunId(res.id);
      const st = await api.publishRunStatus(res.id);
      setRun(st);
    } catch (e) {
      addToast(`发布处理启动失败: ${(e as Error).message}`, "err");
    } finally {
      setStarting(false);
    }
  };

  const openOutput = async () => {
    if (!runId) return;
    try {
      await api.publishRunOpen(runId);
    } catch (e) {
      addToast(`打开文件夹失败: ${(e as Error).message}`, "err");
    }
  };

  const dismissResult = async () => {
    if (!runId) return;
    if (runId && !running) {
      void api.publishRunDelete(runId).catch(() => {});
    }
    setRunId(null);
    setRun(null);
  };

  const doneFiles = run?.files.filter((f) => f.status === "done") ?? [];
  const failedFiles = run?.files.filter((f) => f.status === "failed") ?? [];

  return (
    <div className="mx-auto w-full max-w-3xl animate-fade-in-up px-4 py-6 pb-16">
      {/* 头部 */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-wide">
            <Sparkles size={19} style={{ color: "var(--accent)" }} />
            发布处理
          </h1>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            暂存区与图库互不影响；处理结果输出到项目 outputs 文件夹
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate("/library")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
            style={{ background: "var(--accent)" }}
          >
            <Plus size={14} /> 添加图片
          </button>
          <button
            onClick={clearStaging}
            disabled={!staged.length}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--hover)] px-3 py-1.5 text-xs disabled:opacity-40"
          >
            <Trash2 size={13} /> 清空暂存区
          </button>
          <button
            onClick={() => void refreshStaging()}
            className="flex items-center gap-1.5 rounded-lg bg-[var(--hover)] px-3 py-1.5 text-xs"
            title="刷新暂存区"
          >
            <RefreshCw size={13} /> 刷新
          </button>
        </div>
      </div>

      {/* 暂存区预览 */}
      <div className="mb-4 rounded-xl border border-[var(--border)] p-3">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Images size={15} style={{ color: "var(--accent)" }} />
          发布暂存区
          <span className="rounded-full bg-[var(--accent)] px-2 py-0.5 text-[11px] font-semibold text-white">
            {staged.length} 张
          </span>
          {stagingLoading && <Loader2 size={13} className="animate-spin text-[var(--muted)]" />}
        </div>
        {!stagingLoading && !staged.length && (
          <div className="rounded-lg bg-[var(--hover)] px-4 py-8 text-center text-sm text-[var(--muted)]">
            暂存区还没有图片。
            <button
              onClick={() => navigate("/library")}
              className="ml-1.5 font-semibold text-[var(--accent)] hover:underline"
            >
              去图库勾选图片
            </button>
          </div>
        )}
        {staged.length > 0 && (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
            {staged.map((item) => (
              <div
                key={item.name}
                className="group relative aspect-square overflow-hidden rounded-lg border border-[var(--border)] bg-black/30"
              >
                <img
                  src={api.publishStagingFileUrl(item.name)}
                  alt={item.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                <div className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
                  {item.name}
                </div>
                <button
                  onClick={() => void removeStaged(item)}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-red-500 group-hover:opacity-100"
                  title="从暂存区移除（图库原图不动）"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 节点工作流 */}
      <div className="mb-4 rounded-xl border border-[var(--border)] p-3">
        <div className="mb-2 text-sm font-semibold">处理节点（可勾选，顺序固定）</div>
        <div className="space-y-2">
          {NODE_ORDER.map((node, i) => {
            const disabledRestore = node.key === "restore" && (!nodes.upscale || nodes.wipe);
            const checked = nodes[node.key];
            return (
              <div key={node.key}>
                <button
                  onClick={() => toggleNode(node.key)}
                  disabled={disabledRestore}
                  className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-45 ${
                    checked
                      ? "border-[var(--accent)]/50 bg-[var(--accent)]/10"
                      : "border-[var(--border)] bg-[var(--hover)]/50 hover:bg-[var(--hover)]"
                  }`}
                  title={disabledRestore ? "恢复原数据需要勾选超分降噪，且不能与数据抹除同时使用" : undefined}
                >
                  <span
                    className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border ${
                      checked ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--muted)]/50"
                    }`}
                  >
                    {checked && <Check size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{node.label}</span>
                    <span className="block text-[11px] leading-relaxed text-[var(--muted)]">{node.desc}</span>
                  </span>
                </button>
                {i < NODE_ORDER.length - 1 && (
                  <div className="flex justify-center py-0.5 text-[var(--muted)]">
                    <ArrowRight size={13} className="rotate-90" />
                  </div>
                )}
              </div>
            );
          })}
              <p className="text-[11px] leading-relaxed text-[var(--muted)]">
                超分会抹掉 PNG 元数据但文件名不变；想隐藏文件名里的提示词就勾选抹除或重命名。
              </p>
            </div>
      </div>

      {/* 超分引擎 */}
      {nodes.upscale && (
        <div className="mb-4 space-y-2 rounded-xl border border-[var(--border)] p-3">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Download size={14} style={{ color: "var(--accent)" }} />
            超分引擎
            <span className="rounded-full bg-[var(--hover)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]">
              {engine?.engine_name ?? "…"}
            </span>
            {engine?.installed && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
                已就绪
              </span>
            )}
          </div>
          {engineError && <p className="text-xs text-red-400">{engineError}</p>}
          {engine?.message && !engine.installing && !engine.installed && (
            <p className="text-xs text-red-400">{engine.message}</p>
          )}
          {!engine?.installed && !engine?.installing && (
            <div className="flex items-center gap-2">
              {activeEngineInfo?.downloadable ? (
                <button
                  onClick={installEngine}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
                >
                  <Download size={13} /> 下载并安装引擎（约 12MB）
                </button>
              ) : (
                <span className="text-[11px] text-[var(--muted)]">请在下方指定本地引擎路径</span>
              )}
              <span className="text-[11px] text-[var(--muted)]">仅首次使用超分时下载，不用则无需安装</span>
            </div>
          )}
          {engine?.installing && (
            <div>
              <div className="mb-1 flex items-center gap-2 text-xs text-[var(--muted)]">
                <Loader2 size={13} className="animate-spin" />
                {engine.message || "正在下载引擎…"}
                <span>{Math.round(engine.progress * 100)}%</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.max(3, engine.progress * 100)}%`, background: "var(--accent)" }}
                />
              </div>
            </div>
          )}
          {engine?.installed && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <span className="min-w-0 flex-1 truncate" title={engine.binary ?? undefined}>
                {engine.custom_path ? `本地路径：${engine.custom_path}` : engine.binary}
              </span>
              {engine.custom_path && (
                <button
                  onClick={async () => {
                    try {
                      await api.publishEngineLocalPath("");
                      addToast("已清除本地引擎路径，可改用内置引擎");
                      await refreshEngine();
                    } catch (e) {
                      addToast(`清除失败: ${(e as Error).message}`, "err");
                    }
                  }}
                  className="shrink-0 rounded bg-[var(--hover)] px-2 py-0.5 text-[11px] text-[var(--accent)] hover:underline"
                  title="清除后回到内置引擎（Real-ESRGAN），可重新下载"
                >
                  清除本地路径
                </button>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="或指定本地引擎程序路径（如 waifu2x-caffe.exe）"
              className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]/60 px-3 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
            />
            <button
              onClick={saveLocalPath}
              disabled={savingPath || !customPath.trim()}
              className="rounded-lg bg-[var(--hover)] px-3 py-1.5 text-xs disabled:opacity-40"
            >
              {savingPath ? <Loader2 size={13} className="animate-spin" /> : "使用本地路径"}
            </button>
          </div>

          {/* 引擎参数面板（随引擎清单渲染） */}
          {engine && engine.manifest.params.length > 0 && (
            <div className="space-y-2 border-t border-[var(--border)] pt-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[var(--muted)]">引擎参数（{engine.engine_name}）</span>
                <button
                  onClick={saveParams}
                  disabled={savingParams}
                  className="flex items-center gap-1 text-[11px] text-[var(--accent)] hover:underline disabled:opacity-40"
                >
                  {savingParams ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  保存为默认
                </button>
              </div>
              {engine.manifest.params.map((p) => (
                <div key={p.key} className="flex items-center gap-2">
                  <label className="w-36 shrink-0 text-xs text-[var(--muted)]" title={p.hint}>
                    {p.label}
                  </label>
                  {p.type === "select" && (
                    <select
                      value={String(paramValue(p, params))}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const opt = p.options?.find((o) => String(o.value) === raw);
                        setParams((prev) => ({ ...prev, [p.key]: opt ? opt.value : raw }));
                      }}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]/60 px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
                    >
                      {p.options?.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {p.type === "number" && (
                    <input
                      type="number"
                      value={Number(paramValue(p, params))}
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      onChange={(e) => setParams((prev) => ({ ...prev, [p.key]: Number(e.target.value) }))}
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]/60 px-2 py-1.5 text-xs outline-none focus:border-[var(--accent)]"
                    />
                  )}
                  {p.type === "bool" && (
                    <button
                      onClick={() => setParams((prev) => ({ ...prev, [p.key]: !paramValue(p, prev) }))}
                      className={`relative h-5 w-9 rounded-full transition-colors ${
                        paramValue(p, params) ? "bg-[var(--accent)]" : "bg-[var(--hover)]"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                          paramValue(p, params) ? "left-4.5" : "left-0.5"
                        }`}
                      />
                    </button>
                  )}
                </div>
              ))}
              {engine.manifest.params.some((p) => p.hint) && (
                <p className="text-[11px] text-[var(--muted)]">
                  {engine.manifest.params.filter((p) => p.hint).map((p) => p.hint).join("；")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* 批量重命名 */}
      {nodes.rename && (
        <div className="mb-4 space-y-2 rounded-xl border border-[var(--border)] p-3">
          <div className="text-sm font-semibold">重命名规则</div>
          <div className="space-y-1.5">
            {[...PART_META]
              .sort((a, b) => {
                const ai = parts.indexOf(a.key);
                const bi = parts.indexOf(b.key);
                if (ai >= 0 && bi >= 0) return ai - bi;
                if (ai >= 0) return -1;
                if (bi >= 0) return 1;
                return a.label.localeCompare(b.label);
              })
              .map((meta) => {
                const enabled = parts.includes(meta.key);
                const idx = parts.indexOf(meta.key);
                return (
                  <div
                    key={meta.key}
                    draggable={enabled}
                    onDragStart={(e) => {
                      setDragIdx(idx);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragIdx !== null && dragIdx >= 0) reorderPart(dragIdx, idx);
                      setDragIdx(null);
                    }}
                    onDragEnd={() => setDragIdx(null)}
                    className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                      enabled ? "cursor-grab bg-[var(--hover)] active:cursor-grabbing" : "opacity-45"
                    }`}
                  >
                    {enabled ? (
                      <GripVertical size={14} className="shrink-0 text-[var(--muted)]" />
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <button
                      onClick={() => togglePart(meta.key)}
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        enabled ? "border-[var(--accent)] bg-[var(--accent)] text-white" : "border-[var(--muted)]/50"
                      }`}
                      title={enabled ? "点击移除该段" : "点击加入命名"}
                    >
                      {enabled && <Check size={11} />}
                    </button>
                    <span className="w-16 shrink-0 text-xs font-medium">{meta.label}</span>
                    {meta.key === "custom" ? (
                      <input
                        value={custom}
                        disabled={!enabled}
                        onChange={(e) => setCustom(e.target.value)}
                        placeholder="留空则该段不出现"
                        className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--panel)]/60 px-2 py-1 text-xs outline-none focus:border-[var(--accent)] disabled:opacity-50"
                      />
                    ) : (
                      <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">{meta.desc}</span>
                    )}
                    {enabled && <span className="shrink-0 text-[10px] text-[var(--muted)]">拖动换位</span>}
                  </div>
                );
              })}
          </div>
          <div className="rounded-lg bg-[var(--hover)]/60 px-3 py-2">
            <div className="mb-1 text-[11px] font-semibold text-[var(--muted)]">命名预览</div>
            <div className="space-y-0.5 font-mono text-xs">
              {previews.map((name, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-[10px] text-[var(--muted)]">例{i + 1}</span>
                  <span className="truncate">{name}.png</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 运行 */}
      <div className="rounded-xl border border-[var(--border)] p-3">
        {!run && (
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--muted)]">
              {staged.length
                ? `将对暂存区 ${staged.length} 张图片执行处理，输出到 outputs 文件夹`
                : "暂存区为空，先去图库添加图片"}
            </span>
            {failedFiles.length > 0 && <span className="text-[11px] text-red-400">失败 {failedFiles.length} 张</span>}
            <button
              onClick={startRun}
              disabled={!canStart}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-85 disabled:opacity-40"
            >
              {starting ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              开始处理
            </button>
          </div>
        )}

        {run && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {running ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              处理进度
              <span className="text-xs font-normal text-[var(--muted)]">
                {run.done + run.failed}/{run.total}
              </span>
            </div>
            {running && (
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--hover)]">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(2, ((run.done + run.failed) / run.total) * 100)}%`,
                    background: "var(--accent)",
                  }}
                />
              </div>
            )}
            <div className="max-h-52 space-y-1 overflow-y-auto">
              {run.files.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                      f.status === "done"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : f.status === "failed"
                          ? "bg-red-500/15 text-red-400"
                          : f.status === "running"
                            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                            : "bg-[var(--hover)] text-[var(--muted)]"
                    }`}
                  >
                    {f.status === "done" ? "完成" : f.status === "failed" ? "失败" : f.status === "running" ? "处理中" : "等待"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--muted)]">{f.staged}</span>
                  <ArrowRight size={12} className="shrink-0 text-[var(--muted)]" />
                  <span className="min-w-0 flex-1 truncate">{f.output ?? (f.message || "—")}</span>
                </div>
              ))}
            </div>
            {run.status !== "running" && (
              <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-2">
                <button
                  onClick={openOutput}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-85"
                >
                  <FolderOpen size={13} /> 打开输出文件
                </button>
                <button
                  onClick={dismissResult}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--hover)] px-3 py-1.5 text-xs"
                >
                  收起结果
                </button>
                <span className="text-[11px] text-[var(--muted)]">{run.message}</span>
              </div>
            )}
            {doneFiles.length > 0 && (
              <div className="grid grid-cols-6 gap-1.5 border-t border-[var(--border)] pt-2">
                {doneFiles.map((f, i) => (
                  <img
                    key={i}
                    src={api.publishRunFileUrl(run.id, f.output ?? "")}
                    alt={f.output ?? ""}
                    title={f.output ?? ""}
                    className="aspect-square w-full rounded-md border border-[var(--border)] bg-black/30 object-cover"
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
