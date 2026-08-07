import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Dices,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { cn, extractRoleUnits, splitWorkspaceRole } from "../lib";
import { useStore } from "../store";
import { useGenerateStore } from "../store/generate";
import type {
  GenerateMeta,
  GenerateParamsPayload,
  GenerateResolution,
  GenerateStatus,
  GenerateVibe,
  VibeItem,
} from "../types";
import { Button, IconBtn } from "./UI";
import { VibeLibraryModal } from "./VibeLibraryModal";

const inputCls =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--accent)]";

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--muted)]">{label}</span>
      {children}
      {hint && <span className="mt-0.5 block text-[10px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
}

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
        "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs transition-all disabled:opacity-40",
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

function TabSwitch({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: "positive" | "negative") => void;
  options: { key: "positive" | "negative"; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--input)] p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded-md px-2.5 py-1 text-[11px] transition-all",
            value === o.key ? "text-white shadow" : "text-[var(--muted)] hover:text-[var(--text)]"
          )}
          style={value === o.key ? { background: "var(--accent)" } : undefined}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  const commit = (v: number) => {
    if (Number.isNaN(v)) return;
    onChange(Math.min(max, Math.max(min, v)));
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => commit(Number(e.target.value))}
          className="w-16 rounded-md border border-[var(--border)] bg-[var(--input)] px-1.5 py-0.5 text-right text-xs outline-none focus:border-[var(--accent)]"
        />
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[var(--accent)]"
      />
      {hint && <p className="mt-0.5 text-[10px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

function VibeSlider({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const commit = (v: number) => {
    if (Number.isNaN(v)) return;
    onChange(Math.min(1, Math.max(0.01, Math.round(v * 100) / 100)));
  };
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] text-[var(--muted)]">{label}</span>
      <input
        type="range"
        min={0.01}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-[var(--accent)]"
      />
      <input
        type="number"
        min={0.01}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => commit(Number(e.target.value))}
        className="w-12 rounded-md border border-[var(--border)] bg-[var(--input)] px-1 py-0.5 text-right text-[11px] outline-none focus:border-[var(--accent)]"
      />
    </div>
  );
}

function CharacterPreview({
  index,
  positive,
  negative,
  defaultOpen,
}: {
  index: number;
  positive: string;
  negative: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [tab, setTab] = useState<"positive" | "negative">("positive");
  const text = tab === "positive" ? positive : negative;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40">
      <div
        className="flex cursor-pointer items-center gap-1.5 px-2.5 py-2"
        onClick={() => setOpen((v) => !v)}
        title={open ? "收起" : "展开"}
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-[var(--muted)]" />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-[var(--muted)]" />
        )}
        <span className="text-xs font-medium">角色 {index + 1}</span>
        <span className="ml-auto truncate text-[10px] text-[var(--muted)]">
          正 {positive.length} 字 · 负 {negative.length} 字
        </span>
      </div>
      {open && (
        <div className="space-y-2 px-2.5 pb-2.5">
          <TabSwitch
            value={tab}
            onChange={setTab}
            options={[
              { key: "positive", label: "正向" },
              { key: "negative", label: "负面" },
            ]}
          />
          <div className="scroll-thin max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-2 text-xs leading-relaxed text-[var(--text)]">
            {text.trim() || <span className="text-[var(--muted)]">（空）</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function VibeCard({
  vibe,
  index,
  compatible,
  onUpdate,
  onRemove,
}: {
  vibe: GenerateVibe;
  index: number;
  compatible: boolean;
  onUpdate: (patch: Partial<GenerateVibe>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        {vibe.thumbnail ? (
          <img
            src={vibe.thumbnail}
            alt={vibe.name}
            className="h-10 w-10 shrink-0 rounded-lg border border-[var(--border)] object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
          />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--hover)]">
            <Sparkles size={16} className="text-[var(--muted)]" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium" title={vibe.name}>
            {vibe.name}
          </div>
          <div className={cn("text-[10px]", compatible ? "text-[var(--muted)]" : "text-amber-400")}>
            {compatible ? `Vibe ${index + 1}` : "当前模型无对应编码"}
          </div>
        </div>
        <IconBtn danger title="移除该 Vibe" onClick={onRemove}>
          <Trash2 size={12} />
        </IconBtn>
      </div>
      <div className="space-y-1.5">
        <VibeSlider label="强度" value={vibe.strength} onChange={(v) => onUpdate({ strength: v })} />
        <VibeSlider
          label="信息提取度"
          value={vibe.information_extracted}
          onChange={(v) => onUpdate({ information_extracted: v })}
        />
      </div>
    </div>
  );
}

function ResolutionSelector({
  params,
  resolutions,
  onChange,
}: {
  params: GenerateParamsPayload;
  resolutions: GenerateResolution[];
  onChange: (patch: Partial<GenerateParamsPayload>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const current = resolutions.find((r) => r.width === params.width && r.height === params.height);
  const label = current?.label ?? "Custom";

  const groups = useMemo(() => {
    const order = ["NORMAL", "LARGE", "WALLPAPER", "SMALL"];
    const map = new Map<string, GenerateResolution[]>();
    for (const r of resolutions) {
      const arr = map.get(r.category) ?? [];
      arr.push(r);
      map.set(r.category, arr);
    }
    return order.map((c) => ({ category: c, items: map.get(c) ?? [] }));
  }, [resolutions]);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPos({ top: rect.bottom + 6, left: rect.left });
    setOpen(true);
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  const keep = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };
  const pick = (r: GenerateResolution) => {
    onChange({ width: r.width, height: r.height });
    setOpen(false);
  };

  return (
    <div ref={btnRef} className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
        title="悬停展开分辨率预设"
      >
        <span>{label}</span>
        <ChevronDown size={14} className="shrink-0 text-[var(--muted)]" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            className="fixed z-[120] grid grid-cols-5 gap-1 rounded-2xl border border-[var(--border)] bg-[var(--panel-solid)] p-2 shadow-2xl"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={keep}
            onMouseLeave={hide}
          >
            {groups.map((g) => (
              <div key={g.category} className="flex min-w-[96px] flex-col gap-0.5">
                <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                  {g.category}
                </div>
                {g.items.map((r) => (
                  <button
                    key={`${g.category}:${r.label}`}
                    type="button"
                    onClick={() => pick(r)}
                    className={cn(
                      "rounded-lg px-2 py-1.5 text-left transition-colors",
                      current?.width === r.width && current?.height === r.height
                        ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                        : "text-[var(--text)] hover:bg-[var(--hover)]"
                    )}
                  >
                    <span className="block text-xs leading-tight">{r.label}</span>
                    <span className="block text-[10px] leading-tight text-[var(--muted)]">
                      {r.width} × {r.height}
                    </span>
                  </button>
                ))}
              </div>
            ))}
            <div className="flex min-w-[96px] flex-col gap-0.5">
              <div className="px-2 pb-1 pt-0.5 text-[10px] font-semibold tracking-wider text-[var(--muted)]">
                CUSTOM
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-lg px-2 py-1.5 text-left text-xs transition-colors",
                  !current ? "bg-[var(--accent)]/15 text-[var(--accent)]" : "text-[var(--text)] hover:bg-[var(--hover)]"
                )}
              >
                Custom
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function clampDim(v: number, fallback: number): number {
  if (Number.isNaN(v) || v <= 0) return fallback;
  return Math.min(4096, Math.max(64, Math.round(v)));
}

export function GenerationPanel() {
  const navigate = useNavigate();
  const positive = useStore((s) => s.positive);
  const negative = useStore((s) => s.negative);
  const addToast = useStore((s) => s.addToast);

  const params = useGenerateStore((s) => s.params);
  const setParam = useGenerateStore((s) => s.setParam);
  const vibes = useGenerateStore((s) => s.vibes);
  const updateVibe = useGenerateStore((s) => s.updateVibe);
  const removeVibe = useGenerateStore((s) => s.removeVibe);
  const result = useGenerateStore((s) => s.result);
  const setResult = useGenerateStore((s) => s.setResult);

  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [status, setStatus] = useState<GenerateStatus | null>(null);
  const [vibeItems, setVibeItems] = useState<VibeItem[]>([]);
  const [vibeModalOpen, setVibeModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [baseTab, setBaseTab] = useState<"positive" | "negative">("positive");

  const posSplit = useMemo(() => splitWorkspaceRole(positive), [positive]);
  const negSplit = useMemo(() => splitWorkspaceRole(negative), [negative]);

  // 角色区 = 工作区「角色」分区逐卡片自动对齐：1 卡片 → 角色1；多卡片自动扩展
  const rolePositive = useMemo(() => extractRoleUnits(positive), [positive]);
  const roleNegative = useMemo(() => extractRoleUnits(negative), [negative]);
  const characters = useMemo(
    () =>
      rolePositive.map((pos, i) => ({
        positive: pos,
        negative: roleNegative[i] || "",
        center: { x: 0.5, y: 0.5 },
      })),
    [rolePositive, roleNegative]
  );

  const reloadVibes = useCallback(() => {
    api
      .vibes()
      .then(setVibeItems)
      .catch((e) => addToast(`读取 Vibe 库失败: ${(e as Error).message}`, "err"));
  }, [addToast]);

  useEffect(() => {
    api
      .generateMeta()
      .then(setMeta)
      .catch((e) => addToast(`读取参数表失败: ${(e as Error).message}`, "err"));
    reloadVibes();
  }, [addToast, reloadVibes]);

  const vibeModels = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const it of vibeItems) map.set(it.id, it.models);
    return map;
  }, [vibeItems]);

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

  const setParamSafe = (patch: Partial<GenerateParamsPayload>) => {
    const next = { ...params, ...patch };
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
    setParam(next);
  };

  const currentRes = meta?.resolutions.find((r) => r.width === params.width && r.height === params.height);
  const free = !!meta && !!currentRes?.free && params.steps <= meta.free.max_steps;

  const generate = async () => {
    if (!status?.configured) {
      addToast("请先在「设置」中配置 NovelAI token", "err");
      navigate("/settings");
      return;
    }
    if (!posSplit.base.trim()) {
      addToast("基础正面提示词为空，请先在工作区添加内容", "err");
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const payload = {
        ...params,
        characters,
        vibes: vibes.map((v) => ({
          id: v.id,
          strength: v.strength,
          information_extracted: v.information_extracted,
        })),
      };
      const r = await api.text2image(posSplit.base, negSplit.base, payload);
      setResult(r);
      addToast("生成完成，已保存到图库（未评分）");
      void refreshStatus();
    } catch (e) {
      addToast(`生成失败: ${(e as Error).message}`, "err");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ---------- 左侧：参数设置面板 ---------- */}
      <div className="scroll-thin flex w-full shrink-0 flex-col gap-4 lg:w-[360px] lg:max-h-[calc(100vh-230px)] lg:overflow-y-auto lg:pr-1">
        {/* 模型选择 */}
        <Field label="模型">
          <select
            className={inputCls}
            value={params.model}
            onChange={(e) => setParamSafe({ model: e.target.value })}
          >
            {meta?.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        {/* 基础提示词预览 */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-1.5 pt-2">
            <TabSwitch
              value={baseTab}
              onChange={setBaseTab}
              options={[
                { key: "positive", label: "正向提示词" },
                { key: "negative", label: "负面提示词" },
              ]}
            />
            <span className="text-[10px] text-[var(--muted)]">来自工作区（角色分区已移出）</span>
          </div>
          <pre className="scroll-thin h-36 overflow-y-auto whitespace-pre-wrap px-3 pb-2.5 pt-1 font-sans text-[11px] leading-relaxed text-[var(--text)]">
            {(baseTab === "positive" ? posSplit.base : negSplit.base).trim() || (
              <span className="text-[var(--muted)]">
                {baseTab === "positive" ? "（基础正面提示词为空）" : "（负面提示词为空，将使用 UC 预设）"}
              </span>
            )}
          </pre>
        </div>

        {/* 角色提示词区域（只读预览，自动对齐工作区卡片） */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <span className="text-xs font-medium">
              角色提示词
              <span className="ml-1.5 text-[10px] font-normal text-[var(--muted)]">{characters.length} 个</span>
            </span>
          </div>
          {characters.length === 0 ? (
            <p className="px-2.5 pb-2.5 text-[10px] leading-relaxed text-[var(--muted)]">
              未设置角色；在工作区「角色」分区添加卡片后，会自动按卡片数生成角色 1、角色 2…
            </p>
          ) : (
            <div className="space-y-2 px-2.5 pb-2.5">
              {characters.map((c, i) => (
                <CharacterPreview
                  key={i}
                  index={i}
                  positive={c.positive}
                  negative={c.negative}
                  defaultOpen={i === 0}
                />
              ))}
            </div>
          )}
        </div>

        {/* AI 参数设置 */}
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">
          <div className="text-xs font-medium text-[var(--muted)]">AI 参数</div>
          <SliderField
            label="Steps 采样步数"
            value={params.steps}
            min={1}
            max={50}
            step={1}
            onChange={(v) => setParamSafe({ steps: v })}
            hint={`≤ ${meta?.free.max_steps ?? 28} 步免费`}
          />
          <SliderField
            label="Prompt Guidance 提示词引导"
            value={params.scale}
            min={0}
            max={10}
            step={0.1}
            onChange={(v) => setParamSafe({ scale: v })}
          />
          <SliderField
            label="Prompt Guidance Rescale"
            value={params.cfg_rescale}
            min={0}
            max={1}
            step={0.02}
            onChange={(v) => setParamSafe({ cfg_rescale: v })}
          />
        </div>

        {/* Vibe 参考 */}
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-[var(--muted)]">
              Vibe 参考
              <span className="ml-1.5 font-normal text-[var(--muted)]">{vibes.length} 个</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setVibeModalOpen(true)} title="打开 Vibe 库">
              <Sparkles size={13} /> 导入 Vibe
            </Button>
          </div>
          {vibes.length === 0 ? (
            <p className="text-[10px] leading-relaxed text-[var(--muted)]">
              未添加 Vibe；点击「导入 Vibe」从库中添加，每个可独立调节强度与信息提取度。
            </p>
          ) : (
            <div className="space-y-2">
              {vibes.map((v, i) => (
                <VibeCard
                  key={v.id}
                  vibe={v}
                  index={i}
                  compatible={(vibeModels.get(v.id) ?? [params.model]).includes(params.model)}
                  onUpdate={(patch) => updateVibe(v.id, patch)}
                  onRemove={() => removeVibe(v.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* 更多参数 */}
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--muted)]">更多参数</span>
            {free ? (
              <span className="flex items-center gap-1 rounded-md bg-green-500/10 px-1.5 py-0.5 text-[10px] text-green-400">
                <CheckCircle2 size={11} /> 免费档
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">
                <AlertTriangle size={11} /> 消耗点数
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">分辨率</span>
              <ResolutionSelector params={params} resolutions={meta?.resolutions ?? []} onChange={setParamSafe} />
              <div className="mt-1.5 flex items-center justify-center gap-1">
                <input
                  type="number"
                  min={64}
                  max={4096}
                  value={params.width}
                  onBlur={(e) => {
                    const v = clampDim(Number(e.target.value), 832);
                    if (v !== params.width) setParamSafe({ width: v });
                  }}
                  onChange={(e) => setParamSafe({ width: Number(e.target.value) || 0 })}
                  className="w-20 rounded-md border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-center text-xs outline-none focus:border-[var(--accent)]"
                  title="自定义宽度（64 的倍数，自动保存）"
                />
                <span className="text-xs text-[var(--muted)]">×</span>
                <input
                  type="number"
                  min={64}
                  max={4096}
                  value={params.height}
                  onBlur={(e) => {
                    const v = clampDim(Number(e.target.value), 1216);
                    if (v !== params.height) setParamSafe({ height: v });
                  }}
                  onChange={(e) => setParamSafe({ height: Number(e.target.value) || 0 })}
                  className="w-20 rounded-md border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-center text-xs outline-none focus:border-[var(--accent)]"
                  title="自定义高度（64 的倍数，自动保存）"
                />
              </div>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">直接修改数字即切换到 Custom</p>
            </div>
            <Field label="采样器">
              <select
                className={inputCls}
                value={params.sampler}
                onChange={(e) => setParamSafe({ sampler: e.target.value })}
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
                onChange={(e) => setParamSafe({ noise_schedule: e.target.value })}
              >
                {rules?.noise_schedules.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="负面预设 UC">
              <select
                className={inputCls}
                value={params.uc_preset}
                onChange={(e) => setParamSafe({ uc_preset: e.target.value })}
              >
                {rules?.uc_presets.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="种子" hint={params.seed === -1 ? "随机" : "固定种子"}>
              <div className="flex gap-1">
                <input
                  type="number"
                  className={inputCls}
                  value={params.seed}
                  onChange={(e) => setParamSafe({ seed: Number(e.target.value) })}
                />
                <Button size="sm" variant="ghost" title="随机种子" onClick={() => setParamSafe({ seed: -1 })}>
                  <Dices size={14} />
                </Button>
              </div>
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Toggle label="质量词" checked={params.quality_toggle} onChange={(v) => setParamSafe({ quality_toggle: v })} />
            <Toggle label="Variety+" checked={params.variety} onChange={(v) => setParamSafe({ variety: v })} />
            {rules?.features.furry && (
              <Toggle label="Furry" checked={params.furry_mode} onChange={(v) => setParamSafe({ furry_mode: v })} />
            )}
            {rules?.features.decrisp && (
              <Toggle label="Decrisp" checked={params.decrisp} onChange={(v) => setParamSafe({ decrisp: v })} />
            )}
            {rules?.features.sm && (
              <>
                <Toggle label="SMEA" checked={params.sm} onChange={(v) => setParamSafe({ sm: v })} />
                <Toggle
                  label="DYN"
                  checked={params.sm_dyn}
                  disabled={!params.sm}
                  onChange={(v) => setParamSafe({ sm_dyn: v })}
                />
              </>
            )}
            {rules?.features.legacy_uc && (
              <Toggle label="Legacy UC" checked={params.legacy_uc} onChange={(v) => setParamSafe({ legacy_uc: v })} />
            )}
          </div>
        </div>
      </div>

      {/* ---------- 右侧：图片预览与生成区 ---------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
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

        {/* 图片预览区 */}
        <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--input)]/25 p-4">
          {generating ? (
            <div className="flex flex-col items-center gap-2 text-[var(--muted)]">
              <Loader2 size={28} className="animate-spin" />
              <span className="text-sm">正在生成…（约 10~60 秒）</span>
            </div>
          ) : result ? (
            <img
              src={api.libraryImageUrl(result.path)}
              alt="生成结果"
              className="max-h-[560px] max-w-full rounded-xl object-contain shadow-2xl"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-[var(--muted)]">
              <ImageIcon size={32} className="opacity-50" />
              <span className="text-sm">生成结果将显示在这里</span>
              <span className="text-[11px]">横图 / 竖图 / 方图自动适配居中</span>
            </div>
          )}
        </div>

        {/* 生成按钮 */}
        <Button
          size="md"
          className="w-full py-3 text-base"
          onClick={() => void generate()}
          disabled={generating || !status?.configured || !posSplit.base.trim()}
        >
          <Wand2 size={17} />
          生成图片
          <span className={cn("text-xs", free ? "opacity-80" : "text-amber-300")}>
            {generating ? "生成中…" : free ? "· 免费" : "· 消耗点数"}
          </span>
        </Button>
        {!status?.configured && (
          <p className="text-center text-[11px] text-[var(--muted)]">
            尚未配置 Token，点击上方"配置 Token"前往设置
          </p>
        )}
      </div>

      <VibeLibraryModal
        open={vibeModalOpen}
        onClose={() => setVibeModalOpen(false)}
        items={vibeItems}
        onReload={reloadVibes}
      />
    </div>
  );
}
