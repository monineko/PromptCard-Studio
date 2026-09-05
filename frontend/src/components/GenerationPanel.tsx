import {
  ChevronDown,
  ChevronRight,
  Dices,
  Download,
  Image as ImageIcon,
  Loader2,
  PencilLine,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import {
  NOISE_SCHEDULE_LABELS,
  optionLabel,
  QUALITY_PRESET_LABELS,
  SAMPLER_LABELS,
} from "../generationOptions";
import { cn, extractRoleUnits, splitWorkspaceRole } from "../lib";
import { useStore } from "../store";
import { useBatchStore } from "../store/batch";
import { useGenerateStore, type GeneratePromptDraft } from "../store/generate";
import { useNavStore } from "../store/navStore";
import type {
  GenerateMeta,
  GenerateParamsPayload,
  GenerateStatus,
  GenerateVibe,
  VibeFolder,
  VibeItem,
} from "../types";
import { Button, IconBtn } from "./UI";
import { VibeLibraryModal } from "./VibeLibraryModal";
import { ResolutionSetting } from "./ResolutionSetting";

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

function CharacterEditor({
  index,
  positive,
  negative,
  defaultOpen,
  onChange,
  onRemove,
}: {
  index: number;
  positive: string;
  negative: string;
  defaultOpen?: boolean;
  onChange: (patch: { positive?: string; negative?: string }) => void;
  onRemove: () => void;
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
        <IconBtn
          danger
          title={`删除角色 ${index + 1}`}
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
        >
          <Trash2 size={12} />
        </IconBtn>
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
          <textarea
            value={text}
            onChange={(event) => onChange({ [tab]: event.target.value })}
            placeholder={tab === "positive" ? "输入角色正向提示词" : "输入角色负面提示词"}
            className="scroll-thin h-28 w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-2 text-xs leading-relaxed text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          />
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
  onSaveToLibrary,
}: {
  vibe: GenerateVibe;
  index: number;
  compatible: boolean;
  onUpdate: (patch: Partial<GenerateVibe>) => void;
  onRemove: () => void;
  onSaveToLibrary?: (vibe: GenerateVibe) => void;
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
            {vibe.encoding ? "来自图片（暂存，未入库）" : compatible ? `Vibe ${index + 1}` : "当前模型无对应编码"}
          </div>
        </div>
        {vibe.encoding && onSaveToLibrary && (
          <IconBtn title="保存到 Vibe 库" onClick={() => onSaveToLibrary(vibe)}>
            <Download size={12} />
          </IconBtn>
        )}
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

export function GenerationPanel() {
  const navigate = useNavigate();
  const positive = useStore((s) => s.positive);
  const negative = useStore((s) => s.negative);
  const addToast = useStore((s) => s.addToast);
  const settings = useStore((s) => s.settings);
  const multiCharacter = settings?.multi_character ?? true;

  const params = useGenerateStore((s) => s.params);
  const setParam = useGenerateStore((s) => s.setParam);
  const syncWorkspacePrompts = useGenerateStore((s) => s.syncWorkspacePrompts);
  const storedPromptDraft = useGenerateStore((s) => s.promptDraft);
  const syncPromptDraft = useGenerateStore((s) => s.syncPromptDraft);
  const editPromptDraft = useGenerateStore((s) => s.editPromptDraft);
  const setPromptSync = useGenerateStore((s) => s.setPromptSync);
  const lastResolution = useGenerateStore((s) => s.lastResolution);
  const vibes = useGenerateStore((s) => s.vibes);
  const updateVibe = useGenerateStore((s) => s.updateVibe);
  const removeVibe = useGenerateStore((s) => s.removeVibe);
  const result = useGenerateStore((s) => s.result);
  const setResult = useGenerateStore((s) => s.setResult);
  const batchRun = useBatchStore((s) => s.run);
  const setLibraryTarget = useNavStore((s) => s.setLibraryTarget);

  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [status, setStatus] = useState<GenerateStatus | null>(null);
  const [vibeItems, setVibeItems] = useState<VibeItem[]>([]);
  const [vibeFolders, setVibeFolders] = useState<VibeFolder[]>([]);
  const [vibeModalOpen, setVibeModalOpen] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [baseTab, setBaseTab] = useState<"positive" | "negative">("positive");

  const posSplit = useMemo(() => splitWorkspaceRole(positive), [positive]);
  const negSplit = useMemo(() => splitWorkspaceRole(negative), [negative]);

  // 角色区 = 工作区「角色」分区逐卡片自动对齐：1 卡片 → 角色1；多卡片自动扩展
  const rolePositive = useMemo(() => extractRoleUnits(positive), [positive]);
  const roleNegative = useMemo(() => extractRoleUnits(negative), [negative]);
  const workspacePromptDraft = useMemo<GeneratePromptDraft>(
    () =>
      ({
        positive: posSplit.base,
        negative: negSplit.base,
        characters: rolePositive.map((rolePrompt, index) => ({
          positive: rolePrompt,
          negative: roleNegative[index] || "",
        })),
      }),
    [negSplit.base, posSplit.base, roleNegative, rolePositive]
  );
  const promptDraft = syncWorkspacePrompts ? workspacePromptDraft : storedPromptDraft;
  const characters = useMemo(
    () =>
      promptDraft.characters.map((character) => ({
        ...character,
        center: { x: 0.5, y: 0.5 },
      })),
    [promptDraft.characters]
  );

  useEffect(() => {
    syncPromptDraft(workspacePromptDraft);
  }, [syncPromptDraft, workspacePromptDraft]);

  const updatePromptDraft = (next: GeneratePromptDraft) => editPromptDraft(next);
  // 多角色关闭时：角色分区并入正面提示词，不再生成独立角色槽
  const mergedBase = useMemo(() => {
    if (multiCharacter || !promptDraft.characters.length) return promptDraft.positive;
    return [promptDraft.positive, ...promptDraft.characters.map((character) => character.positive)]
      .filter(Boolean)
      .join(", ");
  }, [multiCharacter, promptDraft.characters, promptDraft.positive]);

  const reloadVibes = useCallback(() => {
    Promise.all([api.vibes(), api.vibeFolders()])
      .then(([items, folders]) => {
        setVibeItems(items);
        setVibeFolders(folders);
      })
      .catch((e) => addToast(`读取 Vibe 库失败: ${(e as Error).message}`, "err"));
  }, [addToast]);

  const saveVibeToLibrary = useCallback(
    async (vibe: GenerateVibe) => {
      try {
        const r = await api.vibeImport({
          name: vibe.name,
          encoding: vibe.encoding ?? "",
          strength: vibe.strength,
          information_extracted: vibe.information_extracted,
          model: params.model,
        });
        addToast(`已保存到 Vibe 库：${r.name}`);
        void reloadVibes();
      } catch (e) {
        addToast(`保存到 Vibe 库失败：${(e as Error).message}`, "err");
      }
    },
    [addToast, params.model, reloadVibes]
  );

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
        if (!r.quality_presets.includes(next.quality_preset))
          next.quality_preset = r.quality_presets.includes("standard") ? "standard" : r.quality_presets[0];
      }
    }
    setParam(next);
  };

  const generate = async () => {
    if (!status?.configured) {
      addToast("请先在「设置」中配置 NovelAI token", "err");
      navigate("/settings");
      return;
    }
    if (!mergedBase.trim()) {
      addToast("正面提示词为空，请先在参数设置或工作区添加内容", "err");
      return;
    }
    if ((params.model === "nai-diffusion-5-full" || params.model === "nai-diffusion-5-curated") && vibes.length) {
      addToast("NAI 5 当前不支持 Vibe，请先移除 Vibe 后再生成", "err");
      return;
    }
    setGenerating(true);
    setResult(null);
    try {
      const payload = {
        ...params,
        characters: multiCharacter ? characters : [],
        vibes: vibes.map((v) => ({
          id: v.id,
          strength: v.strength,
          information_extracted: v.information_extracted,
        })),
      };
      const r = await api.text2image(mergedBase, promptDraft.negative, payload);
      setResult(r);
      addToast("生成完成，已保存到图库（未评分）");
      void refreshStatus();
    } catch (e) {
      addToast(`生成失败: ${(e as Error).message}`, "err");
    } finally {
      setGenerating(false);
    }
  };

  const goWorkspace = () => {
    document.getElementById("prompt-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const openInLibrary = () => {
    const d = new Date();
    const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate()
    ).padStart(2, "0")}`;
    setLibraryTarget({ category: "unrated", date: todayKey });
    navigate("/library");
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ---------- 左侧：参数设置面板 ---------- */}
      <div className="relative w-full shrink-0 lg:w-[360px]">
        <div className="scroll-thin flex flex-col gap-4 lg:max-h-[calc(100vh-230px)] lg:overflow-y-auto lg:pr-1">
        {/* 模型选择 */}
        <Field label="模型">
          <select
            className={inputCls}
            value={params.model}
            onChange={(e) => setParamSafe({ model: e.target.value })}
          >
            {meta?.models.map((m) => (
              <option key={m} value={m}>
                {m === "nai-diffusion-5-full"
                  ? "NAI Diffusion V5 Full"
                  : m === "nai-diffusion-5-curated"
                    ? "NAI Diffusion V5 Curated"
                    : m}
              </option>
            ))}
          </select>
        </Field>

        {/* 单张生成提示词 */}
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
            <Toggle
              label="同步工作区"
              checked={syncWorkspacePrompts}
              onChange={(enabled) => setPromptSync(enabled, workspacePromptDraft)}
            />
          </div>
          <textarea
            value={baseTab === "positive" ? promptDraft.positive : promptDraft.negative}
            onChange={(event) =>
              updatePromptDraft({
                ...promptDraft,
                [baseTab]: event.target.value,
              })
            }
            placeholder={baseTab === "positive" ? "输入基础正向提示词" : "输入负面提示词（留空则使用 UC 预设）"}
            className="scroll-thin mx-2.5 mb-2.5 h-36 w-[calc(100%-1.25rem)] resize-y rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-2 font-sans text-[11px] leading-relaxed text-[var(--text)] outline-none transition-colors placeholder:text-[var(--muted)] focus:border-[var(--accent)]"
          />
          <p className="px-2.5 pb-2 text-[10px] leading-relaxed text-[var(--muted)]">
            {syncWorkspacePrompts
              ? "正在跟随工作区；开始输入会自动关闭同步。"
              : "已独立编辑；重新开启同步会用工作区内容覆盖这里。"}
          </p>
        </div>

        {/* 角色提示词区域 */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40">
          <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-2">
            <span className="text-xs font-medium">
              角色提示词
              <span className="ml-1.5 text-[10px] font-normal text-[var(--muted)]">{characters.length} 个</span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                updatePromptDraft({
                  ...promptDraft,
                  characters: [...promptDraft.characters, { positive: "", negative: "" }],
                })
              }
            >
              <Plus size={13} /> 添加角色
            </Button>
          </div>
          {!multiCharacter && (
            <p className="px-2.5 pb-2 text-[10px] leading-relaxed text-[var(--muted)]">
              多角色已关闭：角色正向提示词会并入基础正向提示词，不会生成独立角色槽。
            </p>
          )}
          {characters.length === 0 ? (
            <p className="px-2.5 pb-2.5 text-[10px] leading-relaxed text-[var(--muted)]">
              未设置角色；可在这里添加，或开启同步后从工作区「角色」分区载入。
            </p>
          ) : (
            <div className="space-y-2 px-2.5 pb-2.5">
              {characters.map((c, i) => (
                <CharacterEditor
                  key={i}
                  index={i}
                  positive={c.positive}
                  negative={c.negative}
                  defaultOpen={i === 0}
                  onChange={(patch) => {
                    const nextCharacters = promptDraft.characters.map((character, index) =>
                      index === i ? { ...character, ...patch } : character
                    );
                    updatePromptDraft({ ...promptDraft, characters: nextCharacters });
                  }}
                  onRemove={() =>
                    updatePromptDraft({
                      ...promptDraft,
                      characters: promptDraft.characters.filter((_, index) => index !== i),
                    })
                  }
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
              <Sparkles size={13} /> 添加 Vibe
            </Button>
          </div>
          {vibes.length === 0 ? (
            <p className="text-[10px] leading-relaxed text-[var(--muted)]">
              未添加 Vibe；点击「添加 Vibe」从库中添加，每个可独立调节强度与信息提取度。
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
                  onSaveToLibrary={saveVibeToLibrary}
                />
              ))}
            </div>
          )}
        </div>

        {/* 更多参数 */}
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--muted)]">更多参数</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <span className="mb-1 block text-xs font-medium text-[var(--muted)]">分辨率</span>
              <ResolutionSetting
                params={params}
                resolutions={meta?.resolutions ?? []}
                lastResolution={lastResolution}
                onChange={setParamSafe}
              />
            </div>
            <Field label="采样器">
              <select
                className={inputCls}
                value={params.sampler}
                onChange={(e) => setParamSafe({ sampler: e.target.value })}
              >
                {rules?.samplers.map((s) => (
                  <option key={s} value={s}>
                    {optionLabel(SAMPLER_LABELS, s)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              label="噪声调度"
              hint={rules?.noise_schedules.length === 1 ? "当前模型由官网固定为 Karras" : undefined}
            >
              <select
                className={inputCls}
                value={params.noise_schedule}
                onChange={(e) => setParamSafe({ noise_schedule: e.target.value })}
                disabled={rules?.noise_schedules.length === 1}
              >
                {rules?.noise_schedules.map((n) => (
                  <option key={n} value={n}>
                    {optionLabel(NOISE_SCHEDULE_LABELS, n)}
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
            <Field label="质量词">
              <select
                className={inputCls}
                value={params.quality_preset}
                onChange={(e) => setParamSafe({ quality_preset: e.target.value })}
              >
                {rules?.quality_presets.map((preset) => (
                  <option key={preset} value={preset}>
                    {optionLabel(QUALITY_PRESET_LABELS, preset)}
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
            {rules?.features.variety && (
              <Toggle label="Variety+" checked={params.variety} onChange={(v) => setParamSafe({ variety: v })} />
            )}
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
        {batchRun && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-xl bg-[var(--panel)]/70 backdrop-blur-sm">
            <span className="rounded-lg bg-[var(--panel-solid)] px-3 py-1.5 text-xs font-medium shadow-lg">
              批量生成进行中，参数已锁定
            </span>
          </div>
        )}
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
          <Button size="sm" variant="ghost" onClick={openInLibrary} title="在图库-未评分中打开">
            <ImageIcon size={13} /> 在图库中打开
          </Button>
        </div>

        {/* 图片预览区 */}
        <div className="relative flex min-h-[420px] flex-1 items-center justify-center rounded-2xl border border-dashed border-[var(--border)] bg-[var(--input)]/25 p-4">
          {batchRun && (
            <span className="absolute left-3 top-3 z-10 rounded-lg bg-[var(--panel-solid)] px-2 py-1 text-[10px] font-medium text-[var(--accent)] shadow">
              批量 {batchRun.done}/{batchRun.total}
              {batchRun.failed > 0 ? `（失败 ${batchRun.failed}）` : ""}
            </span>
          )}
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
              <span className="text-[11px]">请确保您已配置NovelAI的token，否则生成功能不可用！</span>
            </div>
          )}
        </div>

        {/* 生成行：提示词 + 生成1张（各占一半宽度） */}
        <div className="flex gap-2">
          <Button
            size="md"
            className="flex-1 rounded-xl py-4 text-lg"
            onClick={goWorkspace}
            title="前往 Prompt 工作区修改提示词"
          >
            <PencilLine size={20} />
            提示词
          </Button>
          <Button
            size="md"
            className="flex-1 rounded-xl py-4 text-lg"
            onClick={() => void generate()}
            disabled={generating || !!batchRun || !status?.configured || !mergedBase.trim()}
          >
            <Wand2 size={20} />
            生成1张
          </Button>
        </div>
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
        folders={vibeFolders}
        onReload={reloadVibes}
      />
    </div>
  );
}
