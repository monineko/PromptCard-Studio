import { ArrowDown, ArrowRight, ArrowUp, Check, CircleHelp, GitBranch, Heart, Pause, Play, Plus, Repeat2, Sparkles, Trash2, X, ZoomIn } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import type { StyleExploreCandidate, StyleExploreDeepFamily, StyleExploreDeepParent, StyleExploreDeepParentSet, StyleExploreDeepState, StyleExploreRound, StyleExploreRun } from "../../types";
import { AlbumStackCard } from "../gallery/AlbumStackCard";
import { ReviewMode, type ReviewChoice } from "../gallery/ReviewMode";
import { ConfirmDialog, Modal } from "../UI";

const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45";
const primaryButtonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45";
const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

const DEEP_REVIEW_CHOICES: ReviewChoice[] = [
  { tag: "treasure", label: "Treasure", key: "ArrowLeft", icon: Sparkles, color: "#f59e0b" },
  { tag: "special", label: "Special", key: "ArrowDown", icon: Heart, color: "#ec4899" },
  { tag: "reject", label: "Reject", key: "ArrowRight", icon: X, color: "#f87171" },
];

const HELP: Record<string, { title: string; text: string }> = {
  parents: { title: "家族第一代父本", text: "每次建立普通父本集都会创建一个独立家族。父本是 Artist String，Treasure 图片只是代表图；该家族后续审美分支只会与本家族第一代父本回交，不会接触其他家族。" },
  suggestion: { title: "建议出图数", text: "系统按父本数给出建议，所有数值均可覆盖。同一代可以使用“新增一轮”再次生成，新增图片与原轮次是同辈关系。" },
  lineage: { title: "家族与代际探索链", text: "每个普通父本集开启一个独立家族，家族横向排列。家族内第一代显示为父本横幅，下一代可有多个同辈图片堆；悬停图片堆会高亮它与来源轮次、家族第一代父本之间的关系。" },
  algorithm: { title: "深度候选如何产生", text: "每个父本至少保留一次局部变异，其余候选由父本交叉、ID 增删替换、权重扰动与少量随机注入组成。审美分支使用本家族第一代父本与当前选中子代回交。" },
};

type Connector = { familyId: string; root: { x: number; y: number }; current: { x: number; y: number }; source?: { x: number; y: number } };
type ConfirmState = { title: string; message: string; onConfirm: () => void } | null;

function deepState(run: StyleExploreRun): StyleExploreDeepState {
  return run.deep ?? { active_parent_set_id: null, active_family_id: null, families: [], parent_sets: [] };
}

function candidateForParent(run: StyleExploreRun, parent: StyleExploreDeepParent): StyleExploreCandidate | undefined {
  const id = parent.representative_candidate_id ?? parent.candidate_id;
  return id ? run.candidates.find((candidate) => candidate.id === id) : undefined;
}

function suggestedTargetCount(parentCount: number) {
  return Math.max(10, Math.round((parentCount * 4) / 5) * 5);
}

function suggestedNextParentCount(targetCount: number) {
  return Math.max(3, Math.min(10, Math.ceil(Math.sqrt(Math.max(targetCount, 1)))));
}

function buildPairs(parents: StyleExploreDeepParent[]) {
  const pairs: { left: StyleExploreDeepParent; right: StyleExploreDeepParent }[] = [];
  for (let left = 0; left < parents.length; left += 1) {
    for (let right = left + 1; right < parents.length; right += 1) pairs.push({ left: parents[left], right: parents[right] });
  }
  return pairs.slice(0, 12);
}

function Guide({ step, children }: { step: number; children: ReactNode }) {
  return <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/10 px-3 py-2 text-xs leading-relaxed text-[var(--muted)]"><span className="mr-1 font-semibold text-[var(--accent)]">第 {step} 步</span>{children}</div>;
}

function familyWidth(rounds: StyleExploreRound[]) {
  const counts = new Map<number, number>();
  rounds.forEach((round) => counts.set(round.generation ?? 2, (counts.get(round.generation ?? 2) ?? 0) + 1));
  return Math.max(920, Math.max(3, ...counts.values()) * 360 + 48);
}

export function StyleExploreDeepExplorer({ run, positive, negative, params, algorithm, onRunChange, onPreviewCandidate, notify }: {
  run: StyleExploreRun;
  positive: string;
  negative: string;
  params: Record<string, unknown>;
  algorithm: Record<string, unknown>;
  onRunChange: (run: StyleExploreRun) => void;
  onPreviewCandidate: (candidateId: string) => void;
  notify: (message: string, kind?: "ok" | "err") => void;
}) {
  const deep = deepState(run);
  const parentSets = deep.parent_sets;
  const rounds = (run.rounds ?? []).filter((round) => round.phase === "deep");
  const families: StyleExploreDeepFamily[] = deep.families?.length ? deep.families : [];
  const treasures = useMemo(() => run.candidates.filter((candidate) => candidate.review.label === "treasure" && candidate.generation.status === "done"), [run.candidates]);
  const [selectedTreasureIds, setSelectedTreasureIds] = useState<Set<string>>(new Set());
  const [customText, setCustomText] = useState("");
  const [choosingParents, setChoosingParents] = useState(false);
  const [selectedFamilyId, setSelectedFamilyId] = useState<string | null>(deep.active_family_id ?? families.at(-1)?.id ?? null);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [selectedParentSetId, setSelectedParentSetId] = useState<string | null>(null);
  const [pairwiseOpen, setPairwiseOpen] = useState(false);
  const [pairIndex, setPairIndex] = useState(0);
  const [reviewingRoundId, setReviewingRoundId] = useState<string | null>(null);
  const [branchSourceRoundId, setBranchSourceRoundId] = useState<string | null>(null);
  const [branchName, setBranchName] = useState("");
  const [branchCandidateIds, setBranchCandidateIds] = useState<Set<string>>(new Set());
  const [repeatParentSetId, setRepeatParentSetId] = useState<string | null>(null);
  const [targetCount, setTargetCount] = useState(10);
  const [helpKey, setHelpKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hoveredRoundId, setHoveredRoundId] = useState<string | null>(null);
  const [connector, setConnector] = useState<Connector | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState>(null);
  const familyRefs = useRef(new Map<string, HTMLDivElement>());
  const rootRefs = useRef(new Map<string, HTMLDivElement>());
  const roundRefs = useRef(new Map<string, HTMLDivElement>());

  const familyById = (familyId?: string | null) => families.find((family) => family.id === familyId) ?? null;
  const selectedFamily = familyById(selectedFamilyId) ?? familyById(deep.active_family_id) ?? families.at(-1) ?? null;
  const familyActiveParentSet = selectedFamily ? parentSets.find((item) => item.id === selectedFamily.active_parent_set_id) ?? null : null;
  const selectedRound = rounds.find((round) => round.id === selectedRoundId) ?? null;
  const explicitParentSet = parentSets.find((item) => item.id === selectedParentSetId && (!selectedFamily || item.family_id === selectedFamily.id));
  const selectedParentSet = explicitParentSet ?? (selectedRound ? parentSets.find((item) => item.id === selectedRound.parent_set_id) : null) ?? familyActiveParentSet;
  const pairingParentSet = selectedParentSet && selectedFamily && selectedParentSet.family_id === selectedFamily.id ? selectedParentSet : familyActiveParentSet;
  const selectedRoundCandidates = useMemo(() => run.candidates.filter((candidate) => candidate.round_id === selectedRound?.id || selectedRound?.candidate_ids?.includes(candidate.id)), [run.candidates, selectedRound]);
  const unreviewedRoundCandidates = selectedRoundCandidates.filter((candidate) => candidate.generation.status === "done" && !candidate.review.label);
  const roundDoneCount = selectedRoundCandidates.filter((candidate) => candidate.generation.status === "done").length;
  const roundFailedCount = selectedRoundCandidates.filter((candidate) => candidate.generation.status === "failed").length;
  const roundProgress = selectedRoundCandidates.length ? Math.round((roundDoneCount / selectedRoundCandidates.length) * 100) : 0;
  const taskPendingCount = run.candidates.filter((candidate) => ["pending", "generating"].includes(candidate.generation.status)).length;
  const taskDoneCount = run.candidates.filter((candidate) => candidate.generation.status === "done").length;
  const taskProgress = run.candidates.length ? Math.round((taskDoneCount / run.candidates.length) * 100) : 0;
  const pairCandidates = pairingParentSet ? buildPairs(pairingParentSet.parents) : [];
  const currentPair = pairCandidates[pairIndex] ?? null;
  const branchSourceRound = rounds.find((round) => round.id === branchSourceRoundId) ?? null;
  const branchCandidates = branchSourceRound ? run.candidates.filter((candidate) => candidate.round_id === branchSourceRound.id && candidate.generation.status === "done" && candidate.generation.path && !candidate.generation.deleted_at) : [];

  useEffect(() => {
    if (!families.length) {
      setSelectedFamilyId(null);
      return;
    }
    if (!families.some((family) => family.id === selectedFamilyId)) setSelectedFamilyId(deep.active_family_id ?? families.at(-1)?.id ?? null);
  }, [deep.active_family_id, families, run.id, selectedFamilyId]);

  useEffect(() => {
    const next = selectedParentSet?.suggested_target_count ?? suggestedTargetCount(selectedParentSet?.parents.length ?? 0);
    setTargetCount(next);
  }, [selectedParentSet?.id]);

  useEffect(() => {
    if (families.length || choosingParents || selectedTreasureIds.size || treasures.length === 0) return;
    setSelectedTreasureIds(new Set(treasures.map((candidate) => candidate.id)));
  }, [choosingParents, families.length, selectedTreasureIds.size, treasures]);

  useEffect(() => {
    if (!hoveredRoundId) {
      setConnector(null);
      return;
    }
    const round = rounds.find((item) => item.id === hoveredRoundId);
    const parentSet = parentSets.find((item) => item.id === round?.parent_set_id);
    const family = familyById(parentSet?.family_id ?? round?.family_id);
    const canvas = family ? familyRefs.current.get(family.id) : null;
    const root = family ? rootRefs.current.get(family.id) : null;
    const current = roundRefs.current.get(hoveredRoundId);
    if (!round || !parentSet || !family || !canvas || !root || !current) {
      setConnector(null);
      return;
    }
    const canvasRect = canvas.getBoundingClientRect();
    const point = (rect: DOMRect, edge: "top" | "bottom") => ({ x: rect.left - canvasRect.left + rect.width / 2, y: (edge === "top" ? rect.top : rect.bottom) - canvasRect.top });
    const sourceElement = parentSet.branch?.source_round_id ? roundRefs.current.get(parentSet.branch.source_round_id) : null;
    setConnector({ familyId: family.id, root: point(root.getBoundingClientRect(), "bottom"), current: point(current.getBoundingClientRect(), "top"), source: sourceElement ? point(sourceElement.getBoundingClientRect(), "bottom") : undefined });
  }, [hoveredRoundId, run]);

  const act = async (work: () => Promise<StyleExploreRun | void>) => {
    setBusy(true);
    try {
      const next = await work();
      if (next) onRunChange(next);
    } catch (error) {
      notify((error as Error).message, "err");
    } finally {
      setBusy(false);
    }
  };

  const toggleTreasure = (id: string) => setSelectedTreasureIds((previous) => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const toggleAllTreasures = () => setSelectedTreasureIds((previous) => (
    treasures.length > 0 && treasures.every((candidate) => previous.has(candidate.id))
      ? new Set()
      : new Set(treasures.map((candidate) => candidate.id))
  ));

  const confirmParents = () => void act(async () => {
    const custom_artist_strings = customText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!selectedTreasureIds.size && !custom_artist_strings.length) throw new Error("请至少选择一张 Treasure 或输入一条 Artist String");
    const next = await api.styleExploreSetDeepParents(run.id, { candidate_ids: [...selectedTreasureIds], custom_artist_strings });
    const family = next.deep?.families?.find((item) => item.id === next.deep?.active_family_id) ?? next.deep?.families?.at(-1);
    setCustomText("");
    setSelectedTreasureIds(new Set());
    setChoosingParents(false);
    setSelectedRoundId(null);
    setSelectedFamilyId(family?.id ?? null);
    setSelectedParentSetId(family?.active_parent_set_id ?? next.deep?.active_parent_set_id ?? null);
    notify(`已创建家族 ${family?.number ?? ""}；该父本集固定为第一代`);
    return next;
  });

  const recordPreference = (result: "left" | "right" | "skip" | "neither") => {
    if (!pairingParentSet || !currentPair) return;
    void act(async () => {
      const next = await api.styleExploreRecordDeepPreference(run.id, pairingParentSet.id, { left_parent_id: currentPair.left.id, right_parent_id: currentPair.right.id, result });
      if (pairIndex + 1 >= pairCandidates.length) {
        setPairwiseOpen(false);
        notify("当前父本集的偏好排序已保存");
      } else setPairIndex((value) => value + 1);
      return next;
    });
  };

  const appendRoundFor = (parentSet: StyleExploreDeepParentSet, count: number, repeated: boolean) => void act(async () => {
    if (!Number.isInteger(count) || count <= parentSet.parents.length) throw new Error(`出图数必须大于父本数（${parentSet.parents.length}）`);
    const next = await api.styleExploreAppendDeepRound(run.id, { parent_set_id: parentSet.id, target_count: count, positive, negative, params, algorithm });
    const latestRound = [...(next.rounds ?? [])].reverse().find((round) => round.phase === "deep" && round.parent_set_id === parentSet.id);
    setSelectedFamilyId(parentSet.family_id ?? null);
    setSelectedParentSetId(parentSet.id);
    setSelectedRoundId(latestRound?.id ?? null);
    setRepeatParentSetId(null);
    notify(repeated ? `已新增同代第 ${latestRound?.sibling_index ?? ""} 轮，共 ${count} 张候选` : `已创建下一代候选，建议从 ${suggestedNextParentCount(count)} 张中挑选分支样本`);
    return next;
  });

  const openBranch = (roundId: string) => {
    setBranchSourceRoundId(roundId);
    setBranchName("");
    setBranchCandidateIds(new Set());
  };

  const toggleBranchCandidate = (candidateId: string) => setBranchCandidateIds((previous) => {
    const next = new Set(previous);
    if (next.has(candidateId)) next.delete(candidateId); else next.add(candidateId);
    return next;
  });

  const createBranch = () => {
    if (!branchSourceRound) return;
    void act(async () => {
      const name = branchName.trim();
      if (!name) throw new Error("请为审美分支命名");
      if (!branchCandidateIds.size) throw new Error("请至少选择一张优秀子代");
      const next = await api.styleExploreCreateDeepBranch(run.id, { source_round_id: branchSourceRound.id, name, candidate_ids: [...branchCandidateIds] });
      const parentSet = (next.deep?.parent_sets ?? []).find((item) => item.branch?.source_round_id === branchSourceRound.id);
      setSelectedFamilyId(parentSet?.family_id ?? null);
      setSelectedRoundId(null);
      setSelectedParentSetId(parentSet?.id ?? null);
      setBranchSourceRoundId(null);
      notify(`已建立「${name}」：本家族第一代父本与选中子代将生成下一代`);
      return next;
    });
  };

  const requestDeleteRound = (round: StyleExploreRound) => setConfirmState({
    title: "删除分支",
    message: `确认删除第 ${round.generation ?? 2} 代候选堆 ${round.sibling_index ?? 1} 吗？候选记录会移除，已生成图片会进入该任务的内部回收目录。`,
    onConfirm: () => {
      setConfirmState(null);
      void act(async () => {
        const next = await api.styleExploreDeleteDeepRound(run.id, round.id);
        if (selectedRoundId === round.id) setSelectedRoundId(null);
        notify("图片堆已删除");
        return next;
      });
    },
  });

  const requestDeleteParentSet = (parentSet: StyleExploreDeepParentSet) => setConfirmState({
    title: "删除父本集",
    message: "确认撤回这个审美分支父本集吗？上一代会恢复为可继续分支的当前代。",
    onConfirm: () => {
      setConfirmState(null);
      void act(async () => {
        const next = await api.styleExploreDeleteDeepParentSet(run.id, parentSet.id);
        const family = next.deep?.families?.find((item) => item.id === parentSet.family_id);
        setSelectedRoundId(null);
        setSelectedParentSetId(family?.active_parent_set_id ?? null);
        notify("分支父本集已撤回");
        return next;
      });
    },
  });

  const requestDeleteFamily = (family: StyleExploreDeepFamily) => setConfirmState({
    title: "删除父本集（整个家族）",
    message: `确认删除家族 ${family.number} 吗？这个家族的父本集、图片堆和候选记录都会移除，已生成图片会进入任务内部回收目录；其他家族不受影响。`,
    onConfirm: () => {
      setConfirmState(null);
      void act(async () => {
        const next = await api.styleExploreDeleteDeepFamily(run.id, family.id);
        const activeFamily = next.deep?.families?.find((item) => item.id === next.deep?.active_family_id) ?? next.deep?.families?.at(-1);
        setSelectedRoundId(null);
        setSelectedFamilyId(activeFamily?.id ?? null);
        setSelectedParentSetId(activeFamily?.active_parent_set_id ?? null);
        notify(`家族 ${family.number} 已删除`);
        return next;
      });
    },
  });

  const controlRound = (action: "start" | "pause" | "resume" | "retry") => void act(async () => action === "start" ? api.styleExploreStartRun(run.id) : action === "pause" ? api.styleExplorePauseRun(run.id) : action === "resume" ? api.styleExploreResumeRun(run.id, params) : api.styleExploreRetryFailed(run.id));

  const applyRoundReviews = async (moves: { path: string; tag: string }[]) => {
    const result = await api.styleExploreApplyReviews(run.id, moves.map((move) => ({ candidate_id: move.path, tag: move.tag })));
    onRunChange(result.run);
    return result;
  };

  const chooseRound = (round: StyleExploreRound) => {
    setSelectedRoundId(round.id);
    setSelectedParentSetId(round.parent_set_id ?? null);
    setSelectedFamilyId(round.family_id ?? parentSets.find((item) => item.id === round.parent_set_id)?.family_id ?? null);
  };

  const chooseFamily = (family: StyleExploreDeepFamily) => {
    if (selectedFamily?.id !== family.id) {
      setSelectedRoundId(null);
      setSelectedParentSetId(family.active_parent_set_id);
    }
    setSelectedFamilyId(family.id);
  };

  return <section className="glass mt-5 rounded-2xl p-5" aria-labelledby="deep-explore-title">
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "var(--accent)" }}><GitBranch size={20} /></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 id="deep-explore-title" className="font-semibold">深度探索</h2><button className="rounded-full text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => setHelpKey("algorithm")}><CircleHelp size={15} /></button></div><p className="mt-1 text-xs text-[var(--muted)]">每个普通父本集开启一个独立家族；家族内通过“第一代父本 + 优秀子代”回交，并允许同代新增多轮候选。</p></div>
      <button className={buttonClass} onClick={() => setChoosingParents(true)} disabled={busy || run.status === "running"}><Plus size={14} />建立普通父本集（新家族）</button>
    </div>

    {(!families.length || choosingParents) && <div className="mt-5 space-y-4">
      <Guide step={1}>从本任务 Treasure 选择代表图，或输入任意 Artist String。确认后会创建一个全新家族；不会覆盖或改写已有家族。</Guide>
      {treasures.length > 0 && <div className="flex items-center justify-between gap-3"><span className="text-xs text-[var(--muted)]">可选 {treasures.length} 张 Treasure</span><button type="button" className={buttonClass} onClick={toggleAllTreasures} disabled={busy}>{treasures.every((candidate) => selectedTreasureIds.has(candidate.id)) ? "取消全选" : "全选 Treasure"}</button></div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{treasures.map((candidate) => {
        const selected = selectedTreasureIds.has(candidate.id);
        return <button key={candidate.id} type="button" onClick={() => toggleTreasure(candidate.id)} className={`overflow-hidden rounded-xl border text-left transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--input)]/30 hover:bg-[var(--hover)]"}`}><div className="relative aspect-[3/4] bg-[var(--hover)]"><img className="h-full w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="Treasure 候选" loading="lazy" />{selected && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white"><Check size={12} />已选</span>}</div><code className="block max-h-14 overflow-hidden px-3 py-2 text-xs text-[var(--accent)]">{candidate.artist_string}</code></button>;
      })}{treasures.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)] sm:col-span-2">当前任务还没有 Treasure，也可以直接添加自定义 Artist String。</div>}</div>
      <label className="block text-sm">自定义 Artist String <span className="text-xs text-[var(--muted)]">（一行一条）</span><textarea className={`${inputClass} mt-1 min-h-24 font-mono text-xs`} value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="0.8::artist_a::, 1.1::artist_b::" /></label>
      <div className="flex flex-wrap items-center gap-3"><button className={primaryButtonClass} onClick={confirmParents} disabled={busy}><Plus size={15} />创建新家族</button>{families.length > 0 && <button className={buttonClass} onClick={() => setChoosingParents(false)} disabled={busy}>取消</button>}<span className="text-xs text-[var(--muted)]">已选择 {selectedTreasureIds.size} 张 Treasure</span></div>
    </div>}

    {families.length > 0 && !choosingParents && <div className="mt-6 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">代际探索链</h3><button className="rounded-full text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => setHelpKey("lineage")}><CircleHelp size={14} /></button><span className="text-xs text-[var(--muted)]">横向滚动切换家族 · 悬停图片堆查看谱系连线</span></div>
      <div className="mt-4 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--input)]/15 pb-3">
        <div className="flex w-max min-w-full items-stretch">
          {families.map((family) => {
            const familyParentSets = parentSets.filter((item) => item.family_id === family.id);
            const familyRounds = rounds.filter((round) => (round.family_id ?? parentSets.find((item) => item.id === round.parent_set_id)?.family_id) === family.id).sort((a, b) => (a.generation ?? 2) - (b.generation ?? 2) || (a.sibling_index ?? a.number) - (b.sibling_index ?? b.number));
            const rootParentSet = familyParentSets.find((item) => item.id === family.root_parent_set_id) ?? familyParentSets[0];
            const activeSet = familyParentSets.find((item) => item.id === family.active_parent_set_id) ?? familyParentSets.at(-1);
            const generations = [...new Set(familyRounds.map((round) => round.generation ?? 2))];
            const emptyGeneration = activeSet && !familyRounds.some((round) => round.parent_set_id === activeSet.id) ? (activeSet.generation ?? 1) + 1 : null;
            const width = familyWidth(familyRounds);
            return <div key={family.id} ref={(node) => { if (node) familyRefs.current.set(family.id, node); else familyRefs.current.delete(family.id); }} className={`relative shrink-0 border-r border-[var(--border)] px-5 py-4 last:border-r-0 ${selectedFamily?.id === family.id ? "bg-[var(--accent)]/[0.035]" : ""}`} style={{ width }} onClick={() => chooseFamily(family)}>
              {connector?.familyId === family.id && <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full overflow-visible" aria-hidden><path d={`M ${connector.root.x} ${connector.root.y} V ${connector.current.y - 20} Q ${connector.root.x} ${connector.current.y} ${connector.current.x} ${connector.current.y}`} fill="none" stroke="var(--accent)" strokeWidth="3" strokeDasharray="7 5" opacity="0.75" />{connector.source && <path d={`M ${connector.source.x} ${connector.source.y} V ${(connector.source.y + connector.current.y) / 2} H ${connector.current.x} V ${connector.current.y}`} fill="none" stroke="var(--accent)" strokeWidth="4" opacity="0.95" />}</svg>}
              <div className="mb-3 flex items-center justify-between"><div><span className="text-sm font-semibold">家族 {family.number}</span><span className="ml-2 text-xs text-[var(--muted)]">独立谱系</span></div><div className="flex items-center gap-2">{selectedFamily?.id === family.id && <span className="rounded-full bg-[var(--accent)]/15 px-2 py-1 text-[10px] font-medium text-[var(--accent)]">当前查看</span>}<button type="button" className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-red-500/10 hover:text-red-400 disabled:opacity-40" title="删除父本集（整个家族）" aria-label={`删除家族 ${family.number}`} disabled={busy || run.status === "running"} onClick={(event) => { event.stopPropagation(); requestDeleteFamily(family); }}><Trash2 size={14} /></button></div></div>
              {rootParentSet && <div ref={(node) => { if (node) rootRefs.current.set(family.id, node); else rootRefs.current.delete(family.id); }} className={`relative z-30 rounded-xl border bg-[var(--input)]/55 p-3 transition-colors ${selectedParentSet?.id === rootParentSet.id && !selectedRound ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)]"}`} onClick={(event) => { event.stopPropagation(); setSelectedFamilyId(family.id); setSelectedParentSetId(rootParentSet.id); setSelectedRoundId(null); }}>
                <div className="flex items-center gap-3"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="text-sm">第一代父本集</strong><button className="text-[var(--muted)] hover:text-[var(--accent)]" onClick={(event) => { event.stopPropagation(); setHelpKey("parents"); }}><CircleHelp size={13} /></button></div><p className="mt-1 text-xs text-[var(--muted)]">{rootParentSet.parents.length} 条 Artist String · 创建于 {rootParentSet.created_at?.slice(0, 10)}</p><code className="mt-1 block truncate text-[10px] text-[var(--accent)]">{rootParentSet.parents.map((parent) => parent.artist_string).join("  |  ")}</code></div><div className="flex shrink-0 -space-x-3">{rootParentSet.parents.map((parent) => candidateForParent(run, parent)).filter((candidate): candidate is StyleExploreCandidate => Boolean(candidate)).slice(0, 6).map((candidate) => <img key={candidate.id} className="h-14 w-11 rounded-lg border-2 border-white object-cover shadow" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="父本代表图" />)}{!rootParentSet.parents.some((parent) => candidateForParent(run, parent)) && <div className="flex h-14 w-28 items-center justify-center rounded-lg bg-[var(--hover)] text-[10px] text-[var(--muted)]">自定义文字父本</div>}</div></div>
              </div>}
              <div className="relative z-30 mt-5 space-y-5">
                {generations.map((generation) => {
                  const generationRounds = familyRounds.filter((round) => (round.generation ?? 2) === generation);
                  return <div key={generation} className="min-h-[335px]"><div className="mb-2 flex items-center gap-2 text-xs text-[var(--muted)]"><span>第 {generation} 代</span>{generationRounds[0] && parentSets.find((item) => item.id === generationRounds[0].parent_set_id)?.branch?.name && <span className="font-medium text-[var(--accent)]">经「{parentSets.find((item) => item.id === generationRounds[0].parent_set_id)?.branch?.name}」回交</span>}</div><div className="flex items-start gap-3">{generationRounds.map((round, roundIndex) => {
                    const roundCandidates = run.candidates.filter((candidate) => candidate.round_id === round.id);
                    const parentSet = familyParentSets.find((item) => item.id === round.parent_set_id);
                    const hasNextBranch = familyParentSets.some((item) => item.branch?.source_parent_set_id === parentSet?.id);
                    const isBranchSource = familyParentSets.some((item) => item.branch?.source_round_id === round.id);
                    const siblingRoundIds = new Set(familyRounds.filter((item) => item.parent_set_id === parentSet?.id).map((item) => item.id));
                    const siblingCandidates = run.candidates.filter((candidate) => siblingRoundIds.has(String(candidate.round_id)));
                    const hasPending = siblingCandidates.some((candidate) => ["pending", "generating"].includes(candidate.generation.status));
                    const canBranch = siblingCandidates.some((candidate) => candidate.generation.status === "done" && candidate.generation.path && !candidate.generation.deleted_at) && !hasPending;
                    const isCurrentGeneration = parentSet?.id === family.active_parent_set_id;
                    return <div key={round.id} className="flex w-[345px] shrink-0 items-start gap-2">
                      <div ref={(node) => { if (node) roundRefs.current.set(round.id, node); else roundRefs.current.delete(round.id); }} onMouseEnter={() => setHoveredRoundId(round.id)} onMouseLeave={() => setHoveredRoundId(null)} className={`w-60 rounded-2xl p-1 transition-shadow ${selectedRoundId === round.id ? "ring-2 ring-[var(--accent)]" : ""}`}><AlbumStackCard title={`候选堆 ${round.sibling_index ?? roundIndex + 1}`} subtitle={`${round.status} · ${roundCandidates.length} 张`} count={roundCandidates.length} date={round.created_at?.slice(0, 10)} coverUrls={roundCandidates.filter((candidate) => candidate.generation.status === "done" && candidate.generation.path && !candidate.generation.deleted_at).slice(0, 3).map((candidate) => api.styleExploreCandidateImageUrl(run.id, candidate.id))} color="#7c8cff" icon={GitBranch} index={roundIndex} onOpen={(event) => { event.stopPropagation(); chooseRound(round); }} /></div>
                      <div className="mt-10 flex w-24 shrink-0 flex-col gap-2"><button className={`${buttonClass} px-2 text-xs`} onClick={(event) => { event.stopPropagation(); openBranch(round.id); }} disabled={busy || hasNextBranch || run.status === "running" || !canBranch || !isCurrentGeneration} title={hasNextBranch ? "这一代已建立后续分支" : !isCurrentGeneration ? "历史代不能继续分支" : !canBranch ? "请等待本代所有轮次完成" : undefined}><GitBranch size={13} />{hasNextBranch ? "已分支" : "新建分支"}</button><button className={`${buttonClass} px-2 text-xs`} onClick={(event) => { event.stopPropagation(); if (parentSet) { setSelectedFamilyId(family.id); setSelectedParentSetId(parentSet.id); setTargetCount(parentSet.suggested_target_count ?? suggestedTargetCount(parentSet.parents.length)); setRepeatParentSetId(parentSet.id); } }} disabled={busy || run.status === "running" || !isCurrentGeneration || hasNextBranch}><Repeat2 size={13} />新增一轮</button><button className={`${buttonClass} px-2 text-xs text-red-400`} onClick={(event) => { event.stopPropagation(); requestDeleteRound(round); }} disabled={busy || run.status === "running" || isBranchSource} title={isBranchSource ? "请先撤回由该图片堆建立的后续分支" : "删除分支"}><Trash2 size={13} />删除分支</button></div>
                    </div>;
                  })}</div></div>;
                })}
                {emptyGeneration && activeSet && <div className="min-h-[210px]"><div className="mb-2 text-xs text-[var(--muted)]">第 {emptyGeneration} 代{activeSet.branch?.name && <span className="ml-2 font-medium text-[var(--accent)]">经「{activeSet.branch.name}」回交</span>}</div><div className="flex items-start gap-2"><button type="button" className={`w-72 rounded-2xl border border-dashed p-5 text-left transition-colors hover:bg-[var(--hover)] ${selectedParentSet?.id === activeSet.id && !selectedRound ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)]"}`} onClick={(event) => { event.stopPropagation(); setSelectedFamilyId(family.id); setSelectedRoundId(null); setSelectedParentSetId(activeSet.id); }}><div className="flex items-center gap-2 text-sm font-medium"><Plus size={16} />空图片堆</div><p className="mt-1 text-xs text-[var(--muted)]">选择后在下方设置张数并创建本代候选</p></button>{activeSet.branch && <button type="button" className="rounded-lg border border-[var(--border)] p-2 text-red-400 hover:bg-red-500/10 disabled:opacity-40" title="删除父本集并撤回分支" aria-label="删除父本集" disabled={busy || run.status === "running"} onClick={(event) => { event.stopPropagation(); requestDeleteParentSet(activeSet); }}><Trash2 size={15} /></button>}</div></div>}
              </div>
            </div>;
          })}
        </div>
      </div>
    </div>}

    {pairingParentSet && !choosingParents && <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--input)]/25 p-4"><div className="flex flex-wrap items-center gap-2"><div><h3 className="text-sm font-semibold">家族 {selectedFamily?.number} · 当前父本集</h3><p className="mt-1 text-xs text-[var(--muted)]">第 {pairingParentSet.generation ?? 1} 代育种父本 · {pairingParentSet.parents.length} 条 Artist String</p></div><button className={`${buttonClass} ml-auto`} onClick={() => { setPairIndex(0); setPairwiseOpen(true); }} disabled={busy || pairingParentSet.parents.length < 2 || Boolean(pairingParentSet.used_round_ids?.length)}><Heart size={14} />帮我排序（可选）</button></div></div>}

    {selectedParentSet && !rounds.some((round) => round.parent_set_id === selectedParentSet.id) && <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--input)]/25 p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">创建第 {(selectedParentSet.generation ?? 1) + 1} 代候选</h3><button className="rounded-full text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => setHelpKey("suggestion")}><CircleHelp size={14} /></button></div><Guide step={3}>使用家族 {selectedFamily?.number} 的当前父本集生成第一轮；之后可在图片堆右侧继续“新增一轮”。</Guide><div className="mt-3 flex flex-wrap items-end gap-3"><label className="w-36 text-sm">本轮出图数<input className={`${inputClass} mt-1`} type="number" min={selectedParentSet.parents.length + 1} max={1000} value={targetCount} onChange={(event) => setTargetCount(Math.max(selectedParentSet.parents.length + 1, Math.min(1000, Number(event.target.value) || 1)))} /></label><button className={primaryButtonClass} onClick={() => appendRoundFor(selectedParentSet, targetCount, false)} disabled={busy || run.status === "running"}><Sparkles size={15} />创建候选轮</button></div></div>}

    {selectedRound && <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--input)]/25 p-4"><div className="flex flex-wrap items-center gap-2"><div><h3 className="text-sm font-semibold">家族 {familyById(selectedRound.family_id ?? parentSets.find((item) => item.id === selectedRound.parent_set_id)?.family_id)?.number} · 第 {selectedRound.generation ?? 2} 代 · 候选堆 {selectedRound.sibling_index ?? 1}</h3><p className="mt-1 text-xs text-[var(--muted)]">{selectedRoundCandidates.length} 条候选 · 已完成 {roundDoneCount} · 待生成 {selectedRoundCandidates.length - roundDoneCount - roundFailedCount}{roundFailedCount ? ` · 失败 ${roundFailedCount}` : ""}</p></div><div className="ml-auto flex flex-wrap gap-2">{run.status === "draft" && taskPendingCount > 0 && <button className={primaryButtonClass} onClick={() => controlRound("start")} disabled={busy}><Play size={14} />开始任务生成</button>}{run.status === "running" && <button className={buttonClass} onClick={() => controlRound("pause")} disabled={busy}><Pause size={14} />暂停任务生成</button>}{run.status === "paused" && taskPendingCount > 0 && <button className={primaryButtonClass} onClick={() => controlRound("resume")} disabled={busy}><Play size={14} />继续全部待生成</button>}{run.candidates.some((candidate) => candidate.generation.status === "failed") && <button className={buttonClass} onClick={() => controlRound("retry")} disabled={busy}>失败重试</button>}{unreviewedRoundCandidates.length > 0 && !selectedRoundCandidates.some((candidate) => ["pending", "generating"].includes(candidate.generation.status)) && <button className={buttonClass} onClick={() => setReviewingRoundId(selectedRound.id)} disabled={busy}><ArrowDown size={14} />按轮筛选</button>}</div></div>
      <div className="mt-3 space-y-2"><div className="flex justify-between text-xs text-[var(--muted)]"><span>本轮进度 {roundDoneCount}/{selectedRoundCandidates.length}</span><span>{roundProgress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${roundProgress}%` }} /></div><div className="flex justify-between text-[10px] text-[var(--muted)]"><span>任务总进度 {taskDoneCount}/{run.candidates.length}</span><span>{taskProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${taskProgress}%` }} /></div></div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{selectedRoundCandidates.filter((candidate) => candidate.generation.status === "done" && candidate.generation.path && !candidate.generation.deleted_at).map((candidate) => <button type="button" key={candidate.id} className="overflow-hidden rounded-lg border border-[var(--border)] text-left hover:border-[var(--accent)]" onClick={() => onPreviewCandidate(candidate.id)}><img className="aspect-[3/4] w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="深度候选" loading="lazy" /><code className="block max-h-12 overflow-hidden px-2 py-1.5 text-[10px] text-[var(--accent)]">{candidate.artist_string}</code></button>)}</div>
    </div>}

    {repeatParentSetId && (() => { const parentSet = parentSets.find((item) => item.id === repeatParentSetId); return parentSet ? <Modal open onClose={() => setRepeatParentSetId(null)} title={`第 ${(parentSet.generation ?? 1) + 1} 代 · 新增一轮`}><div className="space-y-4"><p className="text-sm leading-6 text-[var(--muted)]">新一轮会复用左侧候选堆完全相同的父本关系，生成结果与已有图片属于同一代、同辈，不会创建审美分支。</p><label className="block text-sm">新增图片数<input className={`${inputClass} mt-1`} type="number" min={parentSet.parents.length + 1} max={1000} value={targetCount} onChange={(event) => setTargetCount(Math.max(parentSet.parents.length + 1, Math.min(1000, Number(event.target.value) || 1)))} /></label><div className="flex justify-end gap-2"><button className={buttonClass} onClick={() => setRepeatParentSetId(null)}>取消</button><button className={primaryButtonClass} onClick={() => appendRoundFor(parentSet, targetCount, true)} disabled={busy}><Repeat2 size={14} />确认新增一轮</button></div></div></Modal> : null; })()}

    {branchSourceRound && <Modal open onClose={() => setBranchSourceRoundId(null)} title="添加审美分支" wide><div className="space-y-4"><p className="text-sm leading-6 text-[var(--muted)]">从这个候选堆勾选优秀子代。系统会把它们与本家族第一代父本去重合并，用于生成下一代；其他家族以及 Treasure、Special、Reject 结果都不会改变。</p><label className="block text-sm">分支名称<input className={`${inputClass} mt-1`} value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="例如：柔和光影" autoFocus /></label><div><div className="mb-2 flex items-center justify-between text-sm"><span>优秀子代</span><span className="text-xs text-[var(--muted)]">已选 {branchCandidateIds.size} 张</span></div><div className="grid max-h-[48vh] gap-3 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">{branchCandidates.map((candidate) => { const checked = branchCandidateIds.has(candidate.id); return <div key={candidate.id} className="relative"><button type="button" onClick={() => toggleBranchCandidate(candidate.id)} className={`w-full overflow-hidden rounded-xl border text-left ${checked ? "border-[var(--accent)] ring-1 ring-[var(--accent)]" : "border-[var(--border)]"}`}><div className="relative aspect-[3/4]"><img className="h-full w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="可选优秀子代" loading="lazy" />{checked && <span className="absolute left-2 top-2 rounded-full bg-[var(--accent)] p-1 text-white"><Check size={14} /></span>}</div><code className="block max-h-12 overflow-hidden px-2 py-1.5 text-[10px] text-[var(--accent)]">{candidate.artist_string}</code></button><button type="button" className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-lg bg-black/65 px-2 py-1 text-xs text-white shadow-lg transition-colors hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white" onClick={(event) => { event.stopPropagation(); onPreviewCandidate(candidate.id); }} aria-label="放大查看优秀子代" title="放大查看"><ZoomIn size={14} />放大</button></div>; })}</div></div><div className="flex justify-end gap-2"><button className={buttonClass} onClick={() => setBranchSourceRoundId(null)} disabled={busy}>取消</button><button className={primaryButtonClass} onClick={createBranch} disabled={busy || !branchName.trim() || branchCandidateIds.size === 0}><GitBranch size={15} />确认建立分支</button></div></div></Modal>}

    {pairwiseOpen && pairingParentSet && <Modal open onClose={() => setPairwiseOpen(false)} title="可选偏好排序" wide>{currentPair ? <div className="space-y-4"><Guide step={2}>本次评分只影响这个父本集即将生成的候选。{pairIndex + 1} / {pairCandidates.length}</Guide><div className="grid gap-3 sm:grid-cols-2">{(["left", "right"] as const).map((side) => { const parent = currentPair[side]; const candidate = candidateForParent(run, parent); return <div key={side} className="overflow-hidden rounded-xl border border-[var(--border)]">{candidate ? <img className="aspect-[3/4] w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="父本代表图" /> : <div className="flex aspect-[3/4] items-center justify-center bg-[var(--hover)] text-sm text-[var(--muted)]">自定义串 · 无代表图</div>}<code className="block max-h-24 overflow-auto p-3 text-xs text-[var(--accent)]">{parent.artist_string}</code><button className={`${side === "left" ? primaryButtonClass : buttonClass} m-3`} onClick={() => recordPreference(side)} disabled={busy}>{side === "left" ? <ArrowUp size={14} /> : <ArrowRight size={14} />}选择这一方</button></div>; })}</div><div className="flex justify-end gap-2"><button className={buttonClass} onClick={() => recordPreference("skip")} disabled={busy}>跳过</button><button className={buttonClass} onClick={() => recordPreference("neither")} disabled={busy}>都不合适</button><button className={buttonClass} onClick={() => setPairwiseOpen(false)}>结束排序</button></div></div> : <p className="text-sm text-[var(--muted)]">当前父本不足两条，或本次比较已完成。</p>}</Modal>}

    {reviewingRoundId && createPortal(<div className="fixed inset-x-0 bottom-0 top-[52px] z-[9000] bg-[var(--bg)]"><ReviewMode key={`${run.id}-${reviewingRoundId}-${unreviewedRoundCandidates.map((candidate) => candidate.id).join("-")}`} items={unreviewedRoundCandidates.map((candidate) => ({ path: candidate.id, name: String(candidate.generation.name ?? candidate.id), hearted: !!candidate.review.heart }))} categoryLabel={`${run.name} · 深度候选轮`} choices={DEEP_REVIEW_CHOICES} imageUrl={(item) => api.styleExploreCandidateImageUrl(run.id, item.path)} applyReview={applyRoundReviews} recycleReject={false} onFinished={(result) => { setReviewingRoundId(null); notify(`${result.message}；未筛选图片可下次继续`, result.ok ? "ok" : "err"); }} onCancel={() => setReviewingRoundId(null)} /></div>, document.body)}

    <Modal open={helpKey !== null} onClose={() => setHelpKey(null)} title={helpKey ? HELP[helpKey].title : "说明"}>{helpKey && <p className="text-sm leading-7 text-[var(--muted)]">{HELP[helpKey].text}</p>}</Modal>
    <ConfirmDialog open={confirmState !== null} title={confirmState?.title ?? "确认删除"} message={confirmState?.message ?? ""} danger onConfirm={() => confirmState?.onConfirm()} onCancel={() => setConfirmState(null)} />
  </section>;
}
