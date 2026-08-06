import {
  AlertTriangle,
  CheckCircle2,
  Dices,
  ExternalLink,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { cn, serializeSections } from "../lib";
import { useStore } from "../store";
import type {
  GenerateMeta,
  GenerateParamsPayload,
  GenerateStatus,
  Text2ImageResult,
} from "../types";
import { Button } from "./UI";

const DEFAULT_PARAMS: GenerateParamsPayload = {
  model: "nai-diffusion-4-5-full",
  width: 832,
  height: 1216,
  steps: 23,
  scale: 5,
  cfg_rescale: 0,
  sampler: "k_euler_ancestral",
  noise_schedule: "karras",
  seed: -1,
  uc_preset: "Heavy",
  quality_toggle: true,
  variety: true,
  sm: false,
  sm_dyn: false,
  decrisp: false,
  legacy_uc: false,
  furry_mode: false,
};

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--accent)]";

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-all disabled:opacity-40",
        checked
          ? "border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)]"
          : "border-[var(--border)] bg-[var(--input)] text-[var(--muted)] hover:text-[var(--text)]"
      )}
    >
      <span
        className={cn(
          "inline-block h-3 w-5 rounded-full border transition-colors",
          checked ? "border-transparent bg-[var(--accent)]" : "border-[var(--border)] bg-[var(--hover)]"
        )}
      >
        <span
          className={cn(
            "block h-2.5 w-2.5 rounded-full bg-white transition-transform",
            checked ? "translate-x-2" : "translate-x-0"
          )}
        />
      </span>
      {label}
    </button>
  );
}

export function GenerationPanel() {
  const navigate = useNavigate();
  const positive = useStore((s) => s.positive);
  const negative = useStore((s) => s.negative);
  const addToast = useStore((s) => s.addToast);

  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [status, setStatus] = useState<GenerateStatus | null>(null);
  const [params, setParams] = useState<GenerateParamsPayload>(DEFAULT_PARAMS);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<Text2ImageResult | null>(null);
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api
      .generateMeta()
      .then(setMeta)
      .catch((e) => addToast(`读取参数表失败: ${(e as Error).message}`, "err"));
  }, [addToast]);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    try {
      setStatus(await api.generateStatus());
    } catch (e) {
      addToast(`读取连接状态失败: ${(e as Error).message}`, "err");
    } finally {
      setChecking(false);
    }
  }, [addToast]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const rules = meta ? meta.model_rules[params.model] : null;

  const setParam = (patch: Partial<GenerateParamsPayload>) => {
    setParams((prev) => {
      const next = { ...prev, ...patch };
      if (patch.model && meta) {
        const r = meta.model_rules[patch.model];
        if (r) {
          if (!r.samplers.includes(next.sampler))
            next.sampler = r.samplers.includes("k_euler_ancestral") ? "k_euler_ancestral" : r.samplers[0];
          if (!r.noise_schedules.includes(next.noise_schedule))
            next.noise_schedule = r.noise_schedules.includes("karras") ? "karras" : r.noise_schedules[0];
          if (!r.uc_presets.includes(next.uc_preset))
            next.uc_preset = r.uc_presets.includes("Heavy") ? "Heavy" : r.uc_presets[0];
        }
      }
      return next;
    });
  };

  const posText = useMemo(() => serializeSections(positive), [positive]);
  const negText = useMemo(() => serializeSections(negative), [negative]);

  const currentRes = meta?.resolutions.find((r) => r.width === params.width && r.height === params.height);
  const free = !!meta && !!currentRes?.free && params.steps <= meta.free.max_steps;

  const generate = async () => {
    if (!status?.configured) {
      addToast("请先在「设置」中配置 NovelAI token", "err");
      navigate("/settings");
      return;
    }
    if (!posText.trim()) {
      addToast("正面提示词为空，请先在工作区添加内容", "err");
      return;
    }
    setGenerating(true);
    setError("");
    setResult(null);
    try {
      const r = await api.text2image(posText, negText, params);
      setResult(r);
      addToast("生成完成，已保存到图库（未评分）");
      void refreshStatus();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg);
      addToast(`生成失败: ${msg}`, "err");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-xl text-white"
            style={{ background: "var(--accent)" }}
          >
            <Wand2 size={16} />
          </span>
          <div>
            <h2 className="text-sm font-semibold">生成与参数</h2>
            <p className="text-[11px] text-[var(--muted)]">提示词来自上方工作区，生成时自动展开卡片引用</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)]/50 px-2.5 py-1 text-xs">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                checking ? "animate-pulse bg-amber-400" : status?.configured ? "bg-green-400" : "bg-red-400"
              )}
            />
            {status?.configured ? `已连接 · 剩余点数 ${status.anlas ?? "—"}` : "未配置 Token"}
          </span>
          <Button size="sm" variant="ghost" onClick={() => void refreshStatus()} disabled={checking} title="刷新状态与点数">
            <RefreshCw size={13} className={checking ? "animate-spin" : ""} />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate("/settings")}>
            <Settings2 size={13} /> 配置 Token
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
        {/* ---------- 参数区 ---------- */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--input)]/40 p-4 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-[var(--muted)]">
            <Sparkles size={13} /> 生成参数
            {free ? (
              <span className="ml-auto flex items-center gap-1 rounded-md bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
                <CheckCircle2 size={11} /> 免费档
              </span>
            ) : (
              <span className="ml-auto flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                <AlertTriangle size={11} /> 此配置消耗点数
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Field label="模型">
              <select
                className={inputCls}
                value={params.model}
                onChange={(e) => setParam({ model: e.target.value })}
              >
                {meta?.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="分辨率" hint={currentRes?.free ? "免费档" : "非免费档"}>
              <select
                className={inputCls}
                value={`${params.width}x${params.height}`}
                onChange={(e) => {
                  const r = meta?.resolutions.find((x) => x.label === e.target.value);
                  if (r) setParam({ width: r.width, height: r.height });
                }}
              >
                {meta?.resolutions.map((r) => (
                  <option key={r.label} value={r.label}>
                    {r.label} · {r.free ? "免费" : "点数"}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="采样步数" hint={`上限 ${meta?.free.max_steps ?? 28} 步免费`}>
              <input
                type="number"
                min={1}
                max={50}
                className={inputCls}
                value={params.steps}
                onChange={(e) => setParam({ steps: Number(e.target.value) })}
              />
            </Field>

            <Field label="采样器">
              <select
                className={inputCls}
                value={params.sampler}
                onChange={(e) => setParam({ sampler: e.target.value })}
              >
                {rules?.samplers.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="调度器">
              <select
                className={inputCls}
                value={params.noise_schedule}
                onChange={(e) => setParam({ noise_schedule: e.target.value })}
              >
                {rules?.noise_schedules.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="种子" hint={params.seed === -1 ? "当前为随机" : "固定种子可复现"}>
              <div className="flex gap-1">
                <input
                  type="number"
                  className={inputCls}
                  value={params.seed}
                  onChange={(e) => setParam({ seed: Number(e.target.value) })}
                />
                <Button size="sm" variant="ghost" title="随机种子" onClick={() => setParam({ seed: -1 })}>
                  <Dices size={14} />
                </Button>
              </div>
            </Field>

            <Field label="提示词指导系数 scale">
              <input
                type="number"
                min={0}
                max={10}
                step={0.1}
                className={inputCls}
                value={params.scale}
                onChange={(e) => setParam({ scale: Number(e.target.value) })}
              />
            </Field>

            <Field label="重采样系数 cfg_rescale">
              <input
                type="number"
                min={0}
                max={1}
                step={0.02}
                className={inputCls}
                value={params.cfg_rescale}
                onChange={(e) => setParam({ cfg_rescale: Number(e.target.value) })}
              />
            </Field>

            <Field label="负面预设 UC">
              <select
                className={inputCls}
                value={params.uc_preset}
                onChange={(e) => setParam({ uc_preset: e.target.value })}
              >
                {rules?.uc_presets.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Toggle
              label="添加质量词"
              checked={params.quality_toggle}
              onChange={(v) => setParam({ quality_toggle: v })}
            />
            <Toggle label="Variety+" checked={params.variety} onChange={(v) => setParam({ variety: v })} />
            {rules?.features.furry && (
              <Toggle label="Furry 模式" checked={params.furry_mode} onChange={(v) => setParam({ furry_mode: v })} />
            )}
            {rules?.features.decrisp && (
              <Toggle label="Decrisp" checked={params.decrisp} onChange={(v) => setParam({ decrisp: v })} />
            )}
            {rules?.features.sm && (
              <>
                <Toggle label="SMEA" checked={params.sm} onChange={(v) => setParam({ sm: v })} />
                <Toggle
                  label="DYN"
                  checked={params.sm_dyn}
                  disabled={!params.sm}
                  onChange={(v) => setParam({ sm_dyn: v })}
                />
              </>
            )}
            {rules?.features.legacy_uc && (
              <Toggle
                label="Legacy UC"
                checked={params.legacy_uc}
                onChange={(v) => setParam({ legacy_uc: v })}
              />
            )}
          </div>
        </div>

        {/* ---------- 生成区 ---------- */}
        <div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--input)]/40 p-4 lg:col-span-2">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-[var(--muted)]">
              <span>将发送的提示词（已从工作区序列化）</span>
              <span className="text-[10px]">正面 {posText.split("\n").filter(Boolean).length} 段</span>
            </div>
            <div className="scroll-thin max-h-28 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--input)]/60 p-2 text-[11px] leading-relaxed text-[var(--text)]">
              {posText.trim() ? (
                <pre className="whitespace-pre-wrap font-sans">{posText}</pre>
              ) : (
                <span className="text-[var(--muted)]">（正面提示词为空）</span>
              )}
            </div>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between text-xs font-medium text-[var(--muted)]">
              <span>负面提示词</span>
              <span className="text-[10px]">含 UC 预设词（服务端合并）</span>
            </div>
            <div className="scroll-thin max-h-24 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--input)]/60 p-2 text-[11px] leading-relaxed text-[var(--text)]">
              {negText.trim() ? (
                <pre className="whitespace-pre-wrap font-sans">{negText}</pre>
              ) : (
                <span className="text-[var(--muted)]">（负面提示词为空，将使用 UC 预设）</span>
              )}
            </div>
          </div>

          <Button
            size="md"
            className="w-full py-2.5 text-sm"
            onClick={() => void generate()}
            disabled={generating || !status?.configured || !posText.trim()}
          >
            {generating ? (
              <>
                <Loader2 size={16} className="animate-spin" /> 正在生成…（约 10~60 秒）
              </>
            ) : (
              <>
                <Wand2 size={16} /> 生成 1 张
              </>
            )}
          </Button>
          {!status?.configured && (
            <p className="text-center text-[11px] text-[var(--muted)]">
              尚未配置 Token，点击上方"配置 Token"前往设置
            </p>
          )}

          {error && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-xs leading-relaxed text-red-400">
              {error}
            </div>
          )}

          {result && (
            <div className="flex items-center gap-3 rounded-xl border border-green-500/25 bg-green-500/5 p-3">
              <img
                src={api.libraryImageUrl(result.path)}
                alt="生成结果"
                className="h-20 w-14 shrink-0 rounded-lg border border-[var(--border)] object-cover"
              />
              <div className="min-w-0 flex-1 text-xs">
                <div className="mb-1 font-medium text-green-400">生成成功</div>
                <div className="truncate text-[var(--muted)]" title={result.name}>
                  {result.name}
                </div>
                <div className="mt-0.5 text-[var(--muted)]">
                  {result.width}×{result.height} · 种子 {result.seed} · 耗时 {(result.elapsed_ms / 1000).toFixed(1)}s
                  {result.anlas !== null && result.anlas !== undefined && (
                    <span> · 剩余点数 {result.anlas}</span>
                  )}
                </div>
                <button
                  onClick={() => navigate("/library")}
                  className="mt-1.5 flex items-center gap-1 text-[var(--accent)] hover:underline"
                >
                  <ExternalLink size={11} /> 在图库（未评分）中查看
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
