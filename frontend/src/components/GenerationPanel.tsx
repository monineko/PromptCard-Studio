import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Dices,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, uid } from "../api";
import { cn, splitWorkspaceRole } from "../lib";
import { useStore } from "../store";
import type {
  GenerateCharacter,
  GenerateMeta,
  GenerateParamsPayload,
  GenerateStatus,
  Text2ImageResult,
} from "../types";
import { Button, IconBtn } from "./UI";

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

const CHAR_STORAGE_KEY = "npm_generate_characters";

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

function CharacterCard({
  character,
  index,
  onUpdate,
  onRemove,
  defaultOpen,
}: {
  character: GenerateCharacter;
  index: number;
  onUpdate: (patch: Partial<GenerateCharacter>) => void;
  onRemove: () => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const [tab, setTab] = useState<"positive" | "negative">("positive");
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40">
      <div
        className="flex cursor-pointer items-center gap-1.5 px-2.5 py-2"
        onClick={() => setOpen((v) => !v)}
        title={open ? "收起" : "展开"}
      >
        {open ? <ChevronDown size={14} className="shrink-0 text-[var(--muted)]" /> : <ChevronRight size={14} className="shrink-0 text-[var(--muted)]" />}
        <span className="text-xs font-medium">角色 {index + 1}</span>
        <span className="ml-auto truncate text-[10px] text-[var(--muted)]">
          正 {character.positive.length} 字 · 负 {character.negative.length} 字
        </span>
        <IconBtn
          danger
          title="删除该角色"
          className="h-6 w-6"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={12} />
        </IconBtn>
      </div>
      {open && (
        <div className="space-y-2 px-2.5 pb-2.5">
          <TabSwitch value={tab} onChange={setTab} options={[{ key: "positive", label: "正向" }, { key: "negative", label: "负面" }]} />
          <textarea
            value={tab === "positive" ? character.positive : character.negative}
            onChange={(e) => onUpdate({ [tab]: e.target.value } as Partial<GenerateCharacter>)}
            rows={4}
            placeholder={tab === "positive" ? "角色正面提示词，如 <角色:伊吹ibuki>" : "角色负面提示词（可留空）"}
            className="scroll-thin w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-2 text-xs leading-relaxed outline-none focus:border-[var(--accent)]"
          />
          <p className="text-[10px] text-[var(--muted)]">支持 &lt;分类:名称&gt; 引用，生成时自动展开</p>
        </div>
      )}
    </div>
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
  const [baseTab, setBaseTab] = useState<"positive" | "negative">("positive");

  const posSplit = useMemo(() => splitWorkspaceRole(positive), [positive]);
  const negSplit = useMemo(() => splitWorkspaceRole(negative), [negative]);

  const [characters, setCharacters] = useState<GenerateCharacter[]>(() => {
    try {
      const saved = localStorage.getItem(CHAR_STORAGE_KEY);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr) && arr.length)
          return arr.map((c: Partial<GenerateCharacter>, i: number) => ({
            id: uid(),
            name: `角色${i + 1}`,
            positive: c.positive || "",
            negative: c.negative || "",
            center: c.center || { x: 0.5, y: 0.5 },
          }));
      }
    } catch {
      /* ignore */
    }
    return [];
  });

  const charactersTouched = useRef(false);
  const autoCharId = useRef<string | null>(null);
  useEffect(() => {
    if (charactersTouched.current) return;
    const rolePos = posSplit.role.trim();
    const roleNeg = negSplit.role.trim();
    setCharacters((prev) => {
      // 已有用户创建/本地保存的角色 → 不干预
      if (prev.length > 0 && !prev.some((c) => c.id === autoCharId.current)) return prev;
      if (prev.length === 0) {
        if (!rolePos && !roleNeg) return prev; // 工作区尚未加载
        const id = uid();
        autoCharId.current = id;
        return [{ id, name: "角色1", positive: rolePos, negative: roleNeg, center: { x: 0.5, y: 0.5 } }];
      }
      // 自动承接的角色实时跟随工作区"角色"分区
      if (prev.length === 1 && prev[0].id === autoCharId.current) {
        return [{ ...prev[0], positive: rolePos, negative: roleNeg }];
      }
      return prev;
    });
  }, [posSplit.role, negSplit.role]);

  useEffect(() => {
    try {
      localStorage.setItem(
        CHAR_STORAGE_KEY,
        JSON.stringify(characters.map((c) => ({ positive: c.positive, negative: c.negative, center: c.center })))
      );
    } catch {
      /* ignore */
    }
  }, [characters]);

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

  const currentRes = meta?.resolutions.find((r) => r.width === params.width && r.height === params.height);
  const free = !!meta && !!currentRes?.free && params.steps <= meta.free.max_steps;

  const addCharacter = () => {
    charactersTouched.current = true;
    setCharacters((prev) => [
      ...prev,
      { id: uid(), name: `角色${prev.length + 1}`, positive: "", negative: "", center: { x: 0.5, y: 0.5 } },
    ]);
  };
  const updateCharacter = (id: string, patch: Partial<GenerateCharacter>) => {
    charactersTouched.current = true;
    setCharacters((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };
  const removeCharacter = (id: string) => {
    charactersTouched.current = true;
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  };

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
    setError("");
    setResult(null);
    try {
      const payload = {
        ...params,
        characters: characters.map((c) => ({ positive: c.positive, negative: c.negative, center: c.center })),
      };
      const r = await api.text2image(posSplit.base, negSplit.base, payload);
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
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ---------- 左侧：参数设置面板 ---------- */}
      <div className="scroll-thin flex w-full shrink-0 flex-col gap-4 lg:w-[360px] lg:max-h-[calc(100vh-230px)] lg:overflow-y-auto lg:pr-1">
        {/* 模型选择 */}
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

        {/* 角色提示词区域 */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2">
            <span className="text-xs font-medium">
              角色提示词
              <span className="ml-1.5 text-[10px] font-normal text-[var(--muted)]">{characters.length} 个</span>
            </span>
            <Button size="sm" variant="ghost" onClick={addCharacter}>
              <Plus size={13} /> 添加角色
            </Button>
          </div>
          {characters.length === 0 ? (
            <p className="px-2.5 pb-2.5 text-[10px] leading-relaxed text-[var(--muted)]">
              未设置角色；添加后，角色词会与基础提示词分离，生成时放入角色的 char_captions。
            </p>
          ) : (
            <div className="space-y-2 px-2.5 pb-2.5">
              {characters.map((c, i) => (
                <CharacterCard
                  key={c.id}
                  character={c}
                  index={i}
                  defaultOpen={i === 0}
                  onUpdate={(patch) => updateCharacter(c.id, patch)}
                  onRemove={() => removeCharacter(c.id)}
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
            onChange={(v) => setParam({ steps: v })}
            hint={`≤ ${meta?.free.max_steps ?? 28} 步免费`}
          />
          <SliderField
            label="Prompt Guidance 提示词引导"
            value={params.scale}
            min={0}
            max={10}
            step={0.1}
            onChange={(v) => setParam({ scale: v })}
          />
          <SliderField
            label="Prompt Guidance Rescale"
            value={params.cfg_rescale}
            min={0}
            max={1}
            step={0.02}
            onChange={(v) => setParam({ cfg_rescale: v })}
          />
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
            <Field label="分辨率">
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
            <Field label="采样器">
              <select className={inputCls} value={params.sampler} onChange={(e) => setParam({ sampler: e.target.value })}>
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
            <Field label="负面预设 UC">
              <select className={inputCls} value={params.uc_preset} onChange={(e) => setParam({ uc_preset: e.target.value })}>
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
                  onChange={(e) => setParam({ seed: Number(e.target.value) })}
                />
                <Button size="sm" variant="ghost" title="随机种子" onClick={() => setParam({ seed: -1 })}>
                  <Dices size={14} />
                </Button>
              </div>
            </Field>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Toggle label="质量词" checked={params.quality_toggle} onChange={(v) => setParam({ quality_toggle: v })} />
            <Toggle label="Variety+" checked={params.variety} onChange={(v) => setParam({ variety: v })} />
            {rules?.features.furry && (
              <Toggle label="Furry" checked={params.furry_mode} onChange={(v) => setParam({ furry_mode: v })} />
            )}
            {rules?.features.decrisp && (
              <Toggle label="Decrisp" checked={params.decrisp} onChange={(v) => setParam({ decrisp: v })} />
            )}
            {rules?.features.sm && (
              <>
                <Toggle label="SMEA" checked={params.sm} onChange={(v) => setParam({ sm: v })} />
                <Toggle label="DYN" checked={params.sm_dyn} disabled={!params.sm} onChange={(v) => setParam({ sm_dyn: v })} />
              </>
            )}
            {rules?.features.legacy_uc && (
              <Toggle label="Legacy UC" checked={params.legacy_uc} onChange={(v) => setParam({ legacy_uc: v })} />
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
        <Button size="md" className="w-full py-3 text-base" onClick={() => void generate()} disabled={generating || !status?.configured || !posSplit.base.trim()}>
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

        {error && (
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-2.5 text-xs leading-relaxed text-red-400">
            {error}
          </div>
        )}

        {result && (
          <div className="rounded-xl border border-green-500/25 bg-green-500/5 p-3 text-xs">
            <div className="mb-1 font-medium text-green-400">生成成功</div>
            <div className="truncate text-[var(--muted)]" title={result.name}>
              {result.name}
            </div>
            <div className="mt-0.5 text-[var(--muted)]">
              {result.width}×{result.height} · 种子 {result.seed} · 耗时 {(result.elapsed_ms / 1000).toFixed(1)}s
              {result.anlas !== null && result.anlas !== undefined && <span> · 剩余点数 {result.anlas}</span>}
            </div>
            <button onClick={() => navigate("/library")} className="mt-1.5 flex items-center gap-1 text-[var(--accent)] hover:underline">
              <ExternalLink size={11} /> 在图库（未评分）中查看
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
