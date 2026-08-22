import { CircleHelp, Compass, FileUp, FolderPlus, Pause, Play, RefreshCw, RotateCcw, Save, Square, WandSparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { Modal } from "../components/UI";
import { StyleExploreParamsPanel } from "../components/StyleExploreParamsPanel";
import { serializeSections } from "../lib";
import { useStore } from "../store";
import { useGenerateStore } from "../store/generate";
import { useStyleExploreDraft } from "../store/styleExploreDraft";
import type { Section, StyleExplorePool, StyleExplorePoolSummary, StyleExploreRun, StyleExploreRunSummary } from "../types";

const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";
const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45";
const ghostButtonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45";

function statusLabel(status: string) {
  return ({ draft: "草稿", running: "生成中", paused: "已暂停", generated: "已生成", reviewing: "筛选中", completed: "已完成", cancelled: "已结束" } as Record<string, string>)[status] ?? status;
}

function toExplorePrompt(sections: Section[]) {
  return serializeSections(sections.map((section) => ({
    ...section,
    blocks: section.blocks.filter((block) => block.type !== "card" || block.category !== "画师串"),
  })));
}

type HelpEntry = { title: string; description: ReactNode };

function ParameterHelp({ entry, onOpen }: { entry: HelpEntry; onOpen: (entry: HelpEntry) => void }) {
  return <span className="group relative inline-flex align-middle">
    <button type="button" className="ml-1 inline-flex rounded-full text-[var(--muted)] hover:text-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]" aria-label={`查看“${entry.title}”说明`} onClick={(event) => { event.preventDefault(); onOpen(entry); }}>
      <CircleHelp size={15} aria-hidden="true" />
    </button>
    <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-64 -translate-x-1/2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-xs font-normal leading-relaxed text-[var(--text)] shadow-xl group-hover:block group-focus-within:block">{entry.description}</span>
  </span>;
}

function ParameterControl({
  label, help, value, onChange, min, max, step, defaultValue, integer, onOpenHelp,
}: {
  label: string; help: HelpEntry; value: number; onChange: (value: number) => void; min: number; max: number; step: number; defaultValue: number; integer?: boolean; onOpenHelp: (entry: HelpEntry) => void;
}) {
  const safeValue = Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : defaultValue;
  const precision = step < 1 ? 1 : 0;
  const displayValue = integer ? String(Math.round(safeValue)) : safeValue.toFixed(precision);
  const apply = (raw: string) => {
    const next = Number(raw);
    if (Number.isFinite(next)) onChange(integer ? Math.round(next) : Math.round(next * 10) / 10);
  };
  return <div className="min-w-0 text-sm">
    <div className="mb-1 flex items-center justify-between gap-2"><label className="min-w-0">{label}<ParameterHelp entry={help} onOpen={onOpenHelp} /></label><button type="button" className="shrink-0 rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label={`恢复“${label}”默认值`} title="恢复默认值" onClick={() => onChange(defaultValue)}><RotateCcw size={14} /></button></div>
    <div className="flex items-center gap-2"><input className={inputClass} type="number" min={min} max={max} step={step} value={displayValue} onChange={(event) => apply(event.target.value)} /><span className="shrink-0 text-xs text-[var(--muted)]">{min}–{max}</span></div>
    <input className="mt-2 w-full accent-[var(--accent)]" type="range" min={min} max={max} step={step} value={safeValue} aria-label={label} onChange={(event) => apply(event.target.value)} />
  </div>;
}

function SplitBetaPreview({ lower, upper, mode, leftDispersion, rightDispersion }: { lower: number; upper: number; mode: number; leftDispersion: number; rightDispersion: number }) {
  const preview = useMemo(() => {
    const lo = Math.min(3, Math.max(-3, Number.isFinite(lower) ? lower : 0.1));
    const hi = Math.max(lo, Math.min(3, Number.isFinite(upper) ? upper : 2));
    const center = Math.min(hi, Math.max(lo, Number.isFinite(mode) ? mode : 0.8));
    const leftShape = 12 - 11 * Math.min(1, Math.max(0, leftDispersion));
    const rightShape = 12 - 11 * Math.min(1, Math.max(0, rightDispersion));
    const span = Math.max(hi - lo, 0.1);
    const bins = 36;
    const values = Array.from({ length: bins }, (_, index) => {
      const x = lo + ((index + 0.5) / bins) * span;
      let density = 0;
      if (x < center && center > lo) {
        const distance = (center - x) / (center - lo);
        density = (center - lo) / span * leftShape * (1 - distance) ** (leftShape - 1) / (center - lo);
      } else if (x > center && hi > center) {
        const distance = (x - center) / (hi - center);
        density = (hi - center) / span * rightShape * (1 - distance) ** (rightShape - 1) / (hi - center);
      } else {
        density = 1;
      }
      return Number.isFinite(density) ? density : 0;
    });
    const peak = Math.max(...values, 1);
    return { lo, hi, center, values: values.map((value) => value / peak) };
  }, [leftDispersion, lower, mode, rightDispersion, upper]);
  const chart = { width: 760, height: 300, left: 62, right: 22, top: 18, bottom: 48 };
  const plotWidth = chart.width - chart.left - chart.right;
  const plotHeight = chart.height - chart.top - chart.bottom;
  const xAt = (value: number) => chart.left + ((value - preview.lo) / Math.max(preview.hi - preview.lo, 0.1)) * plotWidth;
  const yAt = (value: number) => chart.top + (1 - value) * plotHeight;
  const line = preview.values.map((value, index) => `${xAt(preview.lo + ((index + 0.5) / preview.values.length) * (preview.hi - preview.lo))},${yAt(value)}`).join(" ");
  const modePosition = xAt(preview.center);
  return <section className="mt-5 border-t border-[var(--border)] pt-4" aria-labelledby="split-beta-preview-title">
    <div className="flex flex-wrap items-center gap-2"><h3 id="split-beta-preview-title" className="text-sm font-medium">Split-Beta 概率预览</h3><span className="text-xs text-[var(--muted)]">显示单个权重采样后、0.1 离散化前的相对概率密度</span></div>
    <div className="mt-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input)]/30 p-3">
      <svg viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="xMidYMid meet" className="h-64 w-full sm:h-72" role="img" aria-label={`权重 ${preview.lo.toFixed(1)} 到 ${preview.hi.toFixed(1)} 的 Split-Beta 概率分布，众数 ${preview.center.toFixed(1)}`}>
        <title>Split-Beta 权重概率分布</title><desc>柱形和曲线越高，代表该权重附近越容易被随机抽样。</desc>
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}><line x1={chart.left} y1={yAt(tick)} x2={chart.width - chart.right} y2={yAt(tick)} stroke="var(--border)" strokeWidth="1" /><text x={chart.left - 10} y={yAt(tick) + 4} textAnchor="end" fill="var(--muted)" fontSize="12">{tick.toFixed(2)}</text></g>)}
        <line x1={chart.left} y1={chart.top} x2={chart.left} y2={chart.height - chart.bottom} stroke="var(--text)" strokeWidth="1.2" /><line x1={chart.left} y1={chart.height - chart.bottom} x2={chart.width - chart.right} y2={chart.height - chart.bottom} stroke="var(--text)" strokeWidth="1.2" />
        {preview.values.map((value, index) => { const x = chart.left + (index / preview.values.length) * plotWidth; const width = plotWidth / preview.values.length - 3; return <rect key={index} x={x + 1.5} y={yAt(value)} width={Math.max(1, width)} height={chart.height - chart.bottom - yAt(value)} fill="var(--accent)" opacity="0.34" />; })}
        <polyline points={line} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <line x1={modePosition} y1={chart.top} x2={modePosition} y2={chart.height - chart.bottom} stroke="var(--text)" strokeWidth="1.4" strokeDasharray="6 4" opacity="0.8" />
        <text x={chart.left} y={chart.height - 20} fill="var(--muted)" fontSize="13">{preview.lo.toFixed(1)}</text><text x={modePosition} y={chart.height - 20} textAnchor="middle" fill="var(--text)" fontSize="13">众数 {preview.center.toFixed(1)}</text><text x={chart.width - chart.right} y={chart.height - 20} textAnchor="end" fill="var(--muted)" fontSize="13">{preview.hi.toFixed(1)}</text>
        <text x={chart.width / 2} y={chart.height - 4} textAnchor="middle" fill="var(--muted)" fontSize="13">权重</text><text x="16" y={chart.height / 2} textAnchor="middle" fill="var(--muted)" fontSize="13" transform={`rotate(-90 16 ${chart.height / 2})`}>相对概率密度</text>
      </svg>
    </div>
    <p className="mt-2 text-xs text-[var(--muted)]">左右离散程度分别改变众数两侧的扩散；软平衡属于一条 Artist String 内的组合级修正，因此不显示在这张单权重分布图中。</p>
  </section>;
}

export function StyleExplore() {
  const addToast = useStore((s) => s.addToast);
  const workspacePositive = useStore((s) => s.positive);
  const workspaceNegative = useStore((s) => s.negative);
  const workspaceParams = useGenerateStore((s) => s.params);
  const workspaceVibes = useGenerateStore((s) => s.vibes);
  const positive = useStyleExploreDraft((s) => s.positive);
  const negative = useStyleExploreDraft((s) => s.negative);
  const params = useStyleExploreDraft((s) => s.params);
  const vibes = useStyleExploreDraft((s) => s.vibes);
  const setPrompts = useStyleExploreDraft((s) => s.setPrompts);
  const importWorkspaceSnapshot = useStyleExploreDraft((s) => s.importWorkspaceSnapshot);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pools, setPools] = useState<StyleExplorePoolSummary[]>([]);
  const [runs, setRuns] = useState<StyleExploreRunSummary[]>([]);
  const [poolId, setPoolId] = useState("");
  const [pool, setPool] = useState<StyleExplorePool | null>(null);
  const [poolName, setPoolName] = useState("");
  const [poolText, setPoolText] = useState("");
  const [newPoolName, setNewPoolName] = useState("");
  const [newPoolText, setNewPoolText] = useState("");
  const [targetCount, setTargetCount] = useState(20);
  const [taskName, setTaskName] = useState("");
  const [artistCount, setArtistCount] = useState(2);
  const [lower, setLower] = useState(0.1);
  const [upper, setUpper] = useState(2);
  const [mode, setMode] = useState(0.8);
  const [leftDispersion, setLeftDispersion] = useState(0.4);
  const [rightDispersion, setRightDispersion] = useState(0.4);
  const [softBalance, setSoftBalance] = useState(false);
  const [softBalanceStrength, setSoftBalanceStrength] = useState(0.5);
  const [helpEntry, setHelpEntry] = useState<HelpEntry | null>(null);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [run, setRun] = useState<StyleExploreRun | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [nextPools, nextRuns] = await Promise.all([api.styleExplorePools(), api.styleExploreRuns()]);
    setPools(nextPools); setRuns(nextRuns); setPoolId((current) => current || nextPools[0]?.id || "");
  }, []);
  const loadPool = useCallback(async (id: string) => {
    if (!id) return setPool(null);
    const next = await api.styleExplorePool(id); setPool(next); setPoolName(next.name); setPoolText(next.content);
  }, []);
  const loadRun = useCallback(async (id: string) => {
    if (!id) return setRun(null);
    setRun(await api.styleExploreRun(id));
  }, []);

  useEffect(() => { void refresh().catch((e) => addToast(`读取画风探索数据失败：${(e as Error).message}`, "err")); }, [addToast, refresh]);
  useEffect(() => { void loadPool(poolId).catch((e) => addToast(`读取 ArtistPool 失败：${(e as Error).message}`, "err")); }, [addToast, loadPool, poolId]);
  useEffect(() => { void loadRun(selectedRunId).catch((e) => addToast(`读取任务失败：${(e as Error).message}`, "err")); }, [addToast, loadRun, selectedRunId]);
  useEffect(() => {
    if (run?.status !== "running") return;
    const timer = window.setInterval(() => void loadRun(run.id).catch(() => {}), 1800);
    return () => window.clearInterval(timer);
  }, [loadRun, run?.id, run?.status]);

  const workspaceHasArtistCard = useMemo(() => workspacePositive.some((section) => section.blocks.some((block) => block.type === "card" && block.category === "画师串")), [workspacePositive]);
  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true); try { await action(); } catch (e) { addToast((e as Error).message, "err"); } finally { setBusy(false); }
  };
  const importWorkspace = () => {
    importWorkspaceSnapshot(toExplorePrompt(workspacePositive), serializeSections(workspaceNegative), workspaceParams, workspaceVibes);
    addToast(workspaceHasArtistCard ? "已导入工作区提示词；画师串 Card 已从探索导入内容中移除" : "已导入工作区正面和负面提示词");
  };
  const createPool = () => void withBusy(async () => {
    const created = await api.styleExploreCreatePool(newPoolName, newPoolText);
    setNewPoolName(""); setNewPoolText(""); setPoolId(created.id); await refresh(); addToast(`已创建 ArtistPool：${created.input_count ?? created.count} 项输入，${created.count} 个有效 ID，${created.duplicate_count ?? 0} 项重复`);
  });
  const savePool = () => void withBusy(async () => {
    if (!pool) return;
    const updated = await api.styleExploreUpdatePool(pool.id, poolText, poolName);
    await refresh(); await loadPool(updated.id); addToast(`已保存 ArtistPool，共 ${updated.count} 个 ID；旧版本已备份`);
  });
  const importPoolFile = (file: File | undefined) => void withBusy(async () => {
    if (!file) return;
    const imported = await api.styleExploreImportPool(file); setPoolId(imported.id); await refresh(); addToast(`已导入并规范化 ArtistPool：${imported.input_count ?? imported.count} 项输入，${imported.count} 个有效 ID，${imported.duplicate_count ?? 0} 项重复`);
  });
  const createRun = () => void withBusy(async () => {
    if (!poolId) throw new Error("请先选择 ArtistPool");
    const created = await api.styleExploreCreateRun({
      name: taskName, pool_id: poolId, target_count: targetCount, positive, negative, params: { ...params, vibes }, phase: "basic",
      algorithm: { artist_count: artistCount, lower, upper, mode, left_dispersion: leftDispersion, right_dispersion: rightDispersion, soft_balance_strength: softBalance ? softBalanceStrength : 0 },
    });
    setTaskName(""); setSelectedRunId(created.id); setRun(created); await refresh(); addToast("已创建基础探索任务；确认参数后即可开始生成");
  });
  const controlRun = (action: "start" | "pause" | "resume" | "cancel") => void withBusy(async () => {
    if (!run) return;
    const next = action === "start" ? await api.styleExploreStartRun(run.id) : action === "pause" ? await api.styleExplorePauseRun(run.id) : action === "resume" ? await api.styleExploreResumeRun(run.id) : await api.styleExploreCancelRun(run.id);
    setRun(next); await refresh();
  });
  const setReview = (candidateId: string, label: "treasure" | "special" | "reject") => void withBusy(async () => {
    if (!run) return;
    await api.styleExploreUpdateCandidate(run.id, candidateId, { review: { label } });
    await loadRun(run.id);
  });

  return <><div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5">
    <header className="glass flex flex-wrap items-center gap-3 rounded-2xl p-5">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl text-white" style={{ background: "var(--accent)" }}><Compass size={22} /></span>
      <div><h1 className="text-xl font-semibold">画风探索</h1><p className="mt-1 text-sm text-[var(--muted)]">从 ArtistPool 生成可回溯的加权画师串；深度探索与家系图将在基础闭环稳定后接入。</p></div>
      <button className={`${ghostButtonClass} ml-auto`} onClick={() => void refresh()} disabled={busy}><RefreshCw size={15} />刷新</button>
    </header>
    <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="space-y-5">
        <section className="glass rounded-2xl p-4"><h2 className="mb-3 font-semibold">ArtistPool</h2>
          <select className={inputClass} value={poolId} onChange={(e) => setPoolId(e.target.value)}>{pools.length === 0 && <option value="">暂无 ArtistPool</option>}{pools.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.count} ID</option>)}</select>
          {pool && <><input className={`${inputClass} mt-3`} value={poolName} onChange={(e) => setPoolName(e.target.value)} /><textarea className={`${inputClass} mt-2 min-h-52 font-mono text-xs`} value={poolText} onChange={(e) => setPoolText(e.target.value)} /><p className="mt-1 text-xs text-[var(--muted)]">本次文本：{pool.input_count} 项输入，{pool.ids.length} 个有效 ID，{pool.duplicate_count} 项重复，{pool.skipped_count} 项跳过。保存时会规范为一行一个 ID，并保留备份。</p><button className={`${buttonClass} mt-3 w-full`} onClick={savePool} disabled={busy}><Save size={14} />保存 ArtistPool</button></>}
          <div className="mt-4 border-t border-[var(--border)] pt-4"><input className={inputClass} placeholder="新 ArtistPool 名称" value={newPoolName} onChange={(e) => setNewPoolName(e.target.value)} /><textarea className={`${inputClass} mt-2 min-h-20 text-xs`} placeholder="换行或逗号分隔的 ID" value={newPoolText} onChange={(e) => setNewPoolText(e.target.value)} /><button className={`${ghostButtonClass} mt-2 w-full`} onClick={createPool} disabled={busy}><FolderPlus size={14} />新建 ArtistPool</button><input ref={fileRef} className="hidden" type="file" accept=".txt,text/plain" onChange={(e) => { importPoolFile(e.target.files?.[0]); e.currentTarget.value = ""; }} /><button className={`${ghostButtonClass} mt-2 w-full`} onClick={() => fileRef.current?.click()} disabled={busy}><FileUp size={14} />导入 TXT</button></div>
        </section>
        <section className="glass rounded-2xl p-4"><h2 className="mb-3 font-semibold">探索任务</h2><select className={inputClass} value={selectedRunId} onChange={(e) => setSelectedRunId(e.target.value)}><option value="">新建任务 / 未选择</option>{runs.map((item) => <option key={item.id} value={item.id}>{item.name} · {statusLabel(item.status)} · {item.done_count}/{item.target_count}</option>)}</select>{run && <div className="mt-3 rounded-xl border border-[var(--border)] p-3 text-xs"><div className="font-medium">{run.name} · {statusLabel(run.status)} · {run.done_count}/{run.target_count}</div><div className="mt-1 break-all text-[var(--muted)]">任务 {run.id}</div>{run.status_reason && <div className="mt-1 text-amber-500">{run.status_reason}</div>}</div>}</section>
      </aside>
      <main className="space-y-5">
        <section className="glass rounded-2xl p-5"><div className="flex flex-wrap items-center gap-2"><div><h2 className="font-semibold">基础画风探索</h2><p className="mt-1 text-xs text-[var(--muted)]">提示词与生成参数可从工作区复制一次，也可在此独立编辑。Artist String 是本轮主要随机变量。</p></div><button className={`${ghostButtonClass} ml-auto`} onClick={importWorkspace}><WandSparkles size={14} />导入工作区提示词与参数</button></div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2"><label className="text-sm">任务名称<input className={`${inputClass} mt-1`} value={taskName} onChange={(e) => setTaskName(e.target.value)} placeholder="例如：厚涂水彩画风" /></label><div className="text-xs leading-relaxed text-[var(--muted)]">提示词与探索参数会自动保存在本机，切换页面或刷新后仍会保留。创建任务时会将当前内容固化为本轮生成快照。</div><label className="text-sm">正面提示词<textarea className={`${inputClass} mt-1 min-h-32`} value={positive} onChange={(e) => setPrompts(e.target.value, negative)} placeholder="可直接粘贴或导入工作区内容" /></label><label className="text-sm">负面提示词<textarea className={`${inputClass} mt-1 min-h-32`} value={negative} onChange={(e) => setPrompts(positive, e.target.value)} placeholder="可选" /></label></div>
          <div className="mt-5"><StyleExploreParamsPanel /></div>
          <div className="mt-4 grid gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
            <ParameterControl label="目标图片数" help={{ title: "目标图片数", description: "本次基础探索要生成的候选图片数。数值越大，覆盖的 Artist String 组合越多，也会增加生成耗时和消耗。" }} value={targetCount} onChange={setTargetCount} min={1} max={10000} step={1} defaultValue={20} integer onOpenHelp={setHelpEntry} />
            <ParameterControl label="每串 ID 数" help={{ title: "每串 ID 数", description: "每一条 Artist String 从 ArtistPool 中无放回选取的画师 ID 数量。数量越多，画风融合越明显；较少时更容易辨认单个画师的影响。" }} value={artistCount} onChange={setArtistCount} min={1} max={10} step={1} defaultValue={2} integer onOpenHelp={setHelpEntry} />
            <ParameterControl label="权重下界" help={{ title: "权重下界", description: "本轮随机权重不会低于这个值。它与上界共同限定可出现的权重范围，必须不大于众数。" }} value={lower} onChange={setLower} min={-3} max={3} step={0.1} defaultValue={0.1} onOpenHelp={setHelpEntry} />
            <ParameterControl label="权重上界" help={{ title: "权重上界", description: "本轮随机权重不会高于这个值。它与下界共同限定可出现的权重范围，必须不小于众数。" }} value={upper} onChange={setUpper} min={-3} max={3} step={0.1} defaultValue={2} onOpenHelp={setHelpEntry} />
            <ParameterControl label="众数" help={{ title: "众数", description: "Split-Beta 分布的中心。随机采样最倾向于靠近它，但不会保证每个画师 ID 都取该权重。众数必须落在上下界之间。" }} value={mode} onChange={setMode} min={Math.min(lower, upper)} max={Math.max(lower, upper)} step={0.1} defaultValue={0.8} onOpenHelp={setHelpEntry} />
            <ParameterControl label="左侧离散" help={{ title: "左侧离散", description: "控制低于众数一侧的扩散程度。0.0 会让权重高度靠近众数；1.0 会让该侧区间更接近均匀抽样。" }} value={leftDispersion} onChange={setLeftDispersion} min={0} max={1} step={0.1} defaultValue={0.4} onOpenHelp={setHelpEntry} />
            <ParameterControl label="右侧离散" help={{ title: "右侧离散", description: "控制高于众数一侧的扩散程度。0.0 会让权重高度靠近众数；1.0 会让该侧区间更接近均匀抽样。" }} value={rightDispersion} onChange={setRightDispersion} min={0} max={1} step={0.1} defaultValue={0.4} onOpenHelp={setHelpEntry} />
            <div className="min-w-0 min-h-[180px] text-sm"><div className="mb-1 flex items-center justify-between gap-2"><span>启用软平衡<ParameterHelp entry={{ title: "软平衡", description: "对同一条 Artist String 的所有权重做轻微的整体回拉，减少整串同时偏高或偏低的情况。它不会改变各 ID 的相对权重差；默认关闭。" }} onOpen={setHelpEntry} /></span><button type="button" className="shrink-0 rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label="恢复软平衡默认值" title="恢复默认值" onClick={() => { setSoftBalance(false); setSoftBalanceStrength(0.5); }}><RotateCcw size={14} /></button></div><label className="flex h-10 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--input)] px-3"><input type="checkbox" checked={softBalance} onChange={(event) => setSoftBalance(event.target.checked)} />启用</label><div className={softBalance ? "mt-2" : "pointer-events-none invisible mt-2"}><ParameterControl label="平衡强度" help={{ title: "平衡强度", description: "0.0 不产生修正；1.0 会把整串权重均值完全拉回众数。建议从较低的强度开始，保留随机组合差异。" }} value={softBalanceStrength} onChange={setSoftBalanceStrength} min={0} max={1} step={0.1} defaultValue={0.5} onOpenHelp={setHelpEntry} /></div></div>
          </div>
          <SplitBetaPreview lower={lower} upper={upper} mode={mode} leftDispersion={leftDispersion} rightDispersion={rightDispersion} />
          {!run ? <button className={`${buttonClass} mt-5`} onClick={createRun} disabled={busy}><WandSparkles size={15} />创建基础探索任务</button> : <div className="mt-5 flex flex-wrap gap-2">{(run.status === "draft" || run.status === "paused") && <button className={buttonClass} onClick={() => controlRun(run.status === "draft" ? "start" : "resume")} disabled={busy}><Play size={15} />{run.status === "draft" ? "开始生成" : "继续生成"}</button>}{run.status === "running" && <button className={ghostButtonClass} onClick={() => controlRun("pause")} disabled={busy}><Pause size={15} />暂停</button>}{!(["completed", "cancelled"] as string[]).includes(run.status) && <button className={ghostButtonClass} onClick={() => controlRun("cancel")} disabled={busy}><Square size={15} />结束任务</button>}</div>}
        </section>
        {run && <section className="glass rounded-2xl p-5"><h2 className="font-semibold">本任务候选</h2><p className="mt-1 text-xs text-[var(--muted)]">图片在当前任务专属图库中按 Treasure / Special / Reject 实际移动；Artist String 与生成快照始终保留。</p><div className="mt-4 grid max-h-[680px] gap-3 overflow-auto sm:grid-cols-2 xl:grid-cols-3">{run.candidates.map((candidate, index) => <div key={candidate.id} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">{candidate.generation.status === "done" && <img className="mb-2 aspect-[3/4] w-full rounded-lg object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt={`候选 ${index + 1}`} loading="lazy" />}<div className="flex justify-between gap-3 text-xs"><span>#{index + 1}</span><span className="text-[var(--muted)]">{candidate.generation.status}</span></div><code className="mt-1 block break-all text-xs text-[var(--accent)]">{candidate.artist_string}</code>{candidate.generation.status === "done" && <div className="mt-3 flex flex-wrap gap-1"><button className={ghostButtonClass} onClick={() => setReview(candidate.id, "treasure")} disabled={busy}>Treasure</button><button className={ghostButtonClass} onClick={() => setReview(candidate.id, "special")} disabled={busy}>Special</button><button className={ghostButtonClass} onClick={() => setReview(candidate.id, "reject")} disabled={busy}>Reject</button></div>}{candidate.review.label && <div className="mt-2 text-xs text-[var(--muted)]">已标记：{candidate.review.label}</div>}</div>)}{run.candidates.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)]">创建任务后，候选会在开始生成时按当前算法参数固化。</div>}</div></section>}
      </main>
    </div>
  </div><Modal open={helpEntry !== null} onClose={() => setHelpEntry(null)} title={helpEntry?.title ?? "参数说明"}>
    <div className="space-y-4 text-sm leading-7 text-[var(--muted)]">{helpEntry?.description}<p>输入框可精确填写，滑块会始终显示该参数允许的范围；右侧的回转箭头可单独恢复默认值。</p></div>
  </Modal></>;
}
