import { Dices, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { cn } from "../lib";
import { useStore } from "../store";
import { useStyleExploreDraft } from "../store/styleExploreDraft";
import type { GenerateMeta, GenerateParamsPayload, GenerateVibe, VibeFolder, VibeItem } from "../types";
import { Button, IconBtn } from "./UI";
import { VibeLibraryModal } from "./VibeLibraryModal";

const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]";

function Range({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="block"><span className="mb-1 flex items-center justify-between text-xs font-medium text-[var(--muted)]"><span>{label}</span><input className="w-16 rounded border border-[var(--border)] bg-[var(--input)] px-1 py-0.5 text-right text-xs text-[var(--text)] outline-none focus:border-[var(--accent)]" type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Math.max(min, Math.min(max, Number(event.target.value) || min)))} /></span><input className="w-full accent-[var(--accent)]" type="range" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <button type="button" disabled={disabled} onClick={() => onChange(!checked)} className={cn("rounded-lg border px-2 py-1.5 text-xs disabled:opacity-40", checked ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--input)] text-[var(--muted)]")}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: checked ? "var(--accent)" : "var(--muted)" }} />{label}</button>;
}

export function StyleExploreParamsPanel() {
  const addToast = useStore((state) => state.addToast);
  const params = useStyleExploreDraft((state) => state.params);
  const vibes = useStyleExploreDraft((state) => state.vibes);
  const setParams = useStyleExploreDraft((state) => state.setParams);
  const setVibes = useStyleExploreDraft((state) => state.setVibes);
  const updateVibe = useStyleExploreDraft((state) => state.updateVibe);
  const removeVibe = useStyleExploreDraft((state) => state.removeVibe);
  const [meta, setMeta] = useState<GenerateMeta | null>(null);
  const [items, setItems] = useState<VibeItem[]>([]);
  const [folders, setFolders] = useState<VibeFolder[]>([]);
  const [vibeOpen, setVibeOpen] = useState(false);
  const reloadVibes = useCallback(() => { void Promise.all([api.vibes(), api.vibeFolders()]).then(([nextItems, nextFolders]) => { setItems(nextItems); setFolders(nextFolders); }).catch((error) => addToast(`读取 Vibe 库失败：${(error as Error).message}`, "err")); }, [addToast]);
  useEffect(() => { void api.generateMeta().then(setMeta).catch((error) => addToast(`读取参数表失败：${(error as Error).message}`, "err")); reloadVibes(); }, [addToast, reloadVibes]);
  const rules = meta?.model_rules[params.model];
  const setSafe = (patch: Partial<GenerateParamsPayload>) => {
    const next = { ...params, ...patch };
    if (patch.model && meta) {
      const nextRules = meta.model_rules[patch.model];
      if (nextRules) {
        if (!nextRules.samplers.includes(next.sampler)) next.sampler = nextRules.samplers[0];
        if (!nextRules.noise_schedules.includes(next.noise_schedule)) next.noise_schedule = nextRules.noise_schedules[0];
        if (!nextRules.uc_presets.includes(next.uc_preset)) next.uc_preset = nextRules.uc_presets[0];
      }
    }
    setParams(next);
  };
  const vibeModels = useMemo(() => new Map(items.map((item) => [item.id, item.models])), [items]);
  return <section className="rounded-2xl border border-[var(--border)] bg-[var(--input)]/20 p-5"><div className="flex flex-wrap items-center gap-2"><div><h2 className="font-semibold">探索生成参数</h2><p className="mt-1 text-xs text-[var(--muted)]">此处是探索任务的独立参数副本；导入工作区时复制一次，之后不会影响首页。</p></div><span className="ml-auto inline-flex items-center gap-1 text-xs text-[var(--muted)]"><Settings2 size={14} />自动保存</span></div>
    <div className="mt-4 grid gap-4 xl:grid-cols-2">
      <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--input)]/30 p-3"><label className="block text-xs font-medium text-[var(--muted)]">模型<select className={`${inputClass} mt-1`} value={params.model} onChange={(event) => setSafe({ model: event.target.value })}>{meta?.models.map((model) => <option key={model} value={model}>{model === "nai-diffusion-5-full" ? "NAI Diffusion V5 Full" : model === "nai-diffusion-5-curated" ? "NAI Diffusion V5 Curated" : model}</option>)}</select></label><div className="grid gap-3 sm:grid-cols-3"><Range label="Steps" value={params.steps} min={1} max={50} step={1} onChange={(value) => setSafe({ steps: value })} /><Range label="Prompt Guidance" value={params.scale} min={0} max={10} step={0.1} onChange={(value) => setSafe({ scale: value })} /><Range label="Guidance Rescale" value={params.cfg_rescale} min={0} max={1} step={0.02} onChange={(value) => setSafe({ cfg_rescale: value })} /></div></div>
      <div className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--input)]/30 p-3 sm:grid-cols-2"><label className="text-xs font-medium text-[var(--muted)]">宽度<input className={`${inputClass} mt-1`} type="number" min={64} max={4096} value={params.width} onChange={(event) => setSafe({ width: Math.max(64, Math.min(4096, Number(event.target.value) || 64)) })} /></label><label className="text-xs font-medium text-[var(--muted)]">高度<input className={`${inputClass} mt-1`} type="number" min={64} max={4096} value={params.height} onChange={(event) => setSafe({ height: Math.max(64, Math.min(4096, Number(event.target.value) || 64)) })} /></label><label className="text-xs font-medium text-[var(--muted)]">采样器<select className={`${inputClass} mt-1`} value={params.sampler} onChange={(event) => setSafe({ sampler: event.target.value })}>{rules?.samplers.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-medium text-[var(--muted)]">调度器<select className={`${inputClass} mt-1`} value={params.noise_schedule} onChange={(event) => setSafe({ noise_schedule: event.target.value })}>{rules?.noise_schedules.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-medium text-[var(--muted)]">UC 预设<select className={`${inputClass} mt-1`} value={params.uc_preset} onChange={(event) => setSafe({ uc_preset: event.target.value })}>{rules?.uc_presets.map((item) => <option key={item}>{item}</option>)}</select></label><label className="text-xs font-medium text-[var(--muted)]">种子<div className="mt-1 flex gap-1"><input className={inputClass} type="number" value={params.seed} onChange={(event) => setSafe({ seed: Number(event.target.value) })} /><IconBtn title="随机种子" onClick={() => setSafe({ seed: -1 })}><Dices size={14} /></IconBtn></div></label></div>
    </div>
    <div className="mt-4 flex flex-wrap gap-1.5"><Toggle label="质量词" checked={params.quality_toggle} onChange={(value) => setSafe({ quality_toggle: value })} /><Toggle label="Variety+" checked={params.variety} onChange={(value) => setSafe({ variety: value })} />{rules?.features.furry && <Toggle label="Furry" checked={params.furry_mode} onChange={(value) => setSafe({ furry_mode: value })} />}{rules?.features.decrisp && <Toggle label="Decrisp" checked={params.decrisp} onChange={(value) => setSafe({ decrisp: value })} />}{rules?.features.sm && <><Toggle label="SMEA" checked={params.sm} onChange={(value) => setSafe({ sm: value })} /><Toggle label="DYN" checked={params.sm_dyn} disabled={!params.sm} onChange={(value) => setSafe({ sm_dyn: value })} /></>}{rules?.features.legacy_uc && <Toggle label="Legacy UC" checked={params.legacy_uc} onChange={(value) => setSafe({ legacy_uc: value })} />}</div>
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--input)]/30 p-3"><div className="flex items-center justify-between gap-2"><span className="text-xs font-medium text-[var(--muted)]">Vibe 参考 · {vibes.length} 个</span><Button size="sm" variant="ghost" onClick={() => setVibeOpen(true)}><Sparkles size={13} />添加 Vibe</Button></div>{vibes.length > 0 && <div className="mt-3 grid gap-2 sm:grid-cols-2">{vibes.map((vibe) => <div key={vibe.id} className="rounded-lg border border-[var(--border)] p-2"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-xs">{vibe.name}</span><span className="text-[10px] text-[var(--muted)]">{(vibeModels.get(vibe.id) ?? [params.model]).includes(params.model) ? "可用" : "当前模型不支持"}</span><IconBtn danger title="移除 Vibe" onClick={() => removeVibe(vibe.id)}><Trash2 size={13} /></IconBtn></div><div className="mt-2 grid grid-cols-2 gap-2"><Range label="强度" value={vibe.strength} min={0.01} max={1} step={0.01} onChange={(value) => updateVibe(vibe.id, { strength: value })} /><Range label="信息提取度" value={vibe.information_extracted} min={0.01} max={1} step={0.01} onChange={(value) => updateVibe(vibe.id, { information_extracted: value })} /></div></div>)}</div>}</div>
    <VibeLibraryModal open={vibeOpen} onClose={() => setVibeOpen(false)} items={items} folders={folders} onReload={reloadVibes} params={params} vibes={vibes} onSetVibes={setVibes} />
  </section>;
}
