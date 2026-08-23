import { ArrowDown, ArrowRight, ArrowUp, Check, CircleHelp, GitBranch, Heart, Pause, Play, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api";
import { AlbumStackCard } from "../gallery/AlbumStackCard";
import { ReviewMode, type ReviewChoice } from "../gallery/ReviewMode";
import { Modal } from "../UI";
import type { StyleExploreCandidate, StyleExploreDeepParent, StyleExploreDeepState, StyleExploreRun } from "../../types";

const buttonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-2 text-sm transition-colors hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45";
const primaryButtonClass = "inline-flex items-center justify-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45";
const inputClass = "w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

const DEEP_REVIEW_CHOICES: ReviewChoice[] = [
  { tag: "treasure", label: "Treasure", key: "ArrowLeft", icon: Sparkles, color: "#f59e0b" },
  { tag: "special", label: "Special", key: "ArrowDown", icon: Heart, color: "#ec4899" },
  { tag: "reject", label: "Reject", key: "ArrowRight", icon: X, color: "#f87171" },
];

const HELP: Record<string, { title: string; text: string }> = {
  parents: { title: "当前父本集", text: "父本是 Artist String，不是图片本身。Treasure 图片仅作为代表和筛选依据；自定义串没有代表图也可参与，并允许包含当前 ArtistPool 之外的 ID。后代可以继承这些 ID，但算法新增、替换和随机注入的 ID 仍来自当前池子。" },
  preference: { title: "可选偏好排序", text: "不排序时所有父本等权。排序只影响交叉和变异时的抽取概率，不会让低偏好父本完全失去产生后代的机会。" },
  suggestion: { title: "建议出图数", text: "系统按父本数给出建议：通常为 4 × 父本数后取最接近的 5，最低为 10；下一轮建议数为 sqrt(出图数) 并限制在 3 到 10。所有数值都可由你覆盖。" },
  lineage: { title: "纵向家系图", text: "每张深度候选会保存父本和操作记录。这里按时间从上到下显示基础探索、父本集和深度轮次；审美分支不属于本阶段。" },
  algorithm: { title: "深度候选如何产生", text: "每个父本至少保留一次局部变异，其余候选由父本交叉、ID 增删替换、权重扰动与少量 Split-Beta 随机注入组成。权重始终限制在当前范围并按 0.1 离散，等价串会去重。" },
  review: { title: "深度轮次筛选", text: "生成完成后仍使用 Treasure、Special、Reject 正式筛选。只有你再次点击“建立下一轮父本集”并确认，当前父本才会更新；未选中的 Treasure 不会丢失。" },
};

function deepState(run: StyleExploreRun): StyleExploreDeepState {
  return run.deep ?? { active_parent_set_id: null, parent_sets: [] };
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

export function StyleExploreDeepExplorer({
  run,
  positive,
  negative,
  params,
  algorithm,
  onRunChange,
  onPreviewCandidate,
  notify,
}: {
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
  const activeParentSet = parentSets.find((item) => item.id === deep.active_parent_set_id) ?? parentSets.find((item) => item.status === "active") ?? null;
  const treasures = useMemo(() => run.candidates.filter((candidate) => candidate.review.label === "treasure" && candidate.generation.status === "done"), [run.candidates]);
  const [selectedTreasureIds, setSelectedTreasureIds] = useState<Set<string>>(new Set());
  const [customText, setCustomText] = useState("");
  const [choosingParents, setChoosingParents] = useState(false);
  const [pairwiseOpen, setPairwiseOpen] = useState(false);
  const [pairIndex, setPairIndex] = useState(0);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [reviewingRoundId, setReviewingRoundId] = useState<string | null>(null);
  const [targetCount, setTargetCount] = useState(10);
  const [helpKey, setHelpKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = activeParentSet?.suggested_target_count ?? suggestedTargetCount(activeParentSet?.parents.length ?? 0);
    setTargetCount(next);
  }, [activeParentSet?.id, activeParentSet?.suggested_target_count, activeParentSet?.parents.length]);

  useEffect(() => {
    if (activeParentSet || choosingParents || selectedTreasureIds.size || treasures.length === 0) return;
    setSelectedTreasureIds(new Set(treasures.map((candidate) => candidate.id)));
  }, [activeParentSet, choosingParents, selectedTreasureIds.size, treasures]);

  useEffect(() => {
    if (!rounds.some((round) => round.id === selectedRoundId)) setSelectedRoundId(rounds[rounds.length - 1]?.id ?? null);
  }, [run.id, rounds, selectedRoundId]);

  const selectedRound = rounds.find((round) => round.id === selectedRoundId) ?? null;
  const selectedRoundCandidates = useMemo(() => run.candidates.filter((candidate) => candidate.round_id === selectedRound?.id || selectedRound?.candidate_ids?.includes(candidate.id)), [run.candidates, selectedRound]);
  const unreviewedRoundCandidates = selectedRoundCandidates.filter((candidate) => candidate.generation.status === "done" && !candidate.review.label);
  const roundDoneCount = selectedRoundCandidates.filter((candidate) => candidate.generation.status === "done").length;
  const roundFailedCount = selectedRoundCandidates.filter((candidate) => candidate.generation.status === "failed").length;
  const roundProgress = selectedRoundCandidates.length ? Math.round((roundDoneCount / selectedRoundCandidates.length) * 100) : 0;
  const taskPendingCount = run.candidates.filter((candidate) => ["pending", "generating"].includes(candidate.generation.status)).length;
  const taskDoneCount = run.candidates.filter((candidate) => candidate.generation.status === "done").length;
  const taskProgress = run.candidates.length ? Math.round((taskDoneCount / run.candidates.length) * 100) : 0;
  const pairCandidates = activeParentSet ? buildPairs(activeParentSet.parents) : [];
  const currentPair = pairCandidates[pairIndex] ?? null;

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

  const confirmParents = () => void act(async () => {
    const custom_artist_strings = customText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (!selectedTreasureIds.size && !custom_artist_strings.length) throw new Error("请至少选择一张 Treasure 或输入一条 Artist String");
    const next = await api.styleExploreSetDeepParents(run.id, { candidate_ids: [...selectedTreasureIds], custom_artist_strings });
    setCustomText("");
    setSelectedTreasureIds(new Set());
    setChoosingParents(false);
    notify("当前父本集已确认；可直接创建深度轮次，也可先进行偏好排序");
    return next;
  });

  const recordPreference = (result: "left" | "right" | "skip" | "neither") => {
    if (!activeParentSet || !currentPair) return;
    void act(async () => {
      const next = await api.styleExploreRecordDeepPreference(run.id, activeParentSet.id, {
        left_parent_id: currentPair.left.id,
        right_parent_id: currentPair.right.id,
        result,
      });
      if (pairIndex + 1 >= pairCandidates.length) {
        setPairwiseOpen(false);
        notify("偏好排序已保存；未比较的父本仍按中等权重参与");
      } else setPairIndex((value) => value + 1);
      return next;
    });
  };

  const appendRound = () => {
    if (!activeParentSet) return;
    void act(async () => {
      if (!Number.isInteger(targetCount) || targetCount < 1) throw new Error("出图数至少为 1");
      const next = await api.styleExploreAppendDeepRound(run.id, {
        target_count: targetCount,
        positive,
        negative,
        params,
        algorithm,
      });
      const latestRound = [...(next.rounds ?? [])].reverse().find((round) => round.phase === "deep");
      setSelectedRoundId(latestRound?.id ?? null);
      notify(`已创建深度轮次，建议从 ${suggestedNextParentCount(targetCount)} 个候选中确认下一轮父本`);
      return next;
    });
  };

  const controlRound = (action: "start" | "pause" | "resume" | "retry") => {
    void act(async () => {
      const next = action === "start" ? await api.styleExploreStartRun(run.id)
        : action === "pause" ? await api.styleExplorePauseRun(run.id)
          : action === "resume" ? await api.styleExploreResumeRun(run.id, params)
            : await api.styleExploreRetryFailed(run.id);
      return next;
    });
  };

  const applyRoundReviews = async (moves: { path: string; tag: string }[]) => {
    const result = await api.styleExploreApplyReviews(run.id, moves.map((move) => ({ candidate_id: move.path, tag: move.tag })));
    onRunChange(result.run);
    return result;
  };

  const familySets = [...parentSets].sort((left, right) => (left.number ?? 0) - (right.number ?? 0));
  const hasDeepHistory = familySets.length > 0 || rounds.length > 0;

  return <section className="glass mt-5 rounded-2xl p-5" aria-labelledby="deep-explore-title">
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: "var(--accent)" }}><GitBranch size={20} /></div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 id="deep-explore-title" className="font-semibold">深度探索</h2><button className="rounded-full text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => setHelpKey("algorithm")} aria-label="查看深度探索算法说明"><CircleHelp size={15} /></button></div><p className="mt-1 text-xs text-[var(--muted)]">从当前任务的 Treasure 与自定义 Artist String 建立父本集，逐轮交叉、变异并收敛。审美分支将在后续阶段提供。</p></div>
    </div>

    {(!activeParentSet || choosingParents) && <div className="mt-5 space-y-4">
      <Guide step={1}>先从本任务的 Treasure 选择代表图，或补充任意自定义 Artist String；池外 ID 可以继承到后代，而算法主动新增、替换和随机注入的 ID 仍来自当前 ArtistPool。这不会移动图片或影响既有 Treasure 档案。</Guide>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{treasures.map((candidate) => {
        const selected = selectedTreasureIds.has(candidate.id);
        return <button key={candidate.id} type="button" onClick={() => toggleTreasure(candidate.id)} className={`overflow-hidden rounded-xl border text-left transition-colors ${selected ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--input)]/30 hover:bg-[var(--hover)]"}`}><div className="relative aspect-[3/4] bg-[var(--hover)]"><img className="h-full w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="Treasure 候选" loading="lazy" />{selected && <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-[var(--accent)] px-2 py-1 text-xs font-medium text-white"><Check size={12} />已选</span>}</div><code className="block max-h-14 overflow-hidden px-3 py-2 text-xs text-[var(--accent)]">{candidate.artist_string}</code></button>;
      })}{treasures.length === 0 && <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-sm text-[var(--muted)] sm:col-span-2">当前任务还没有 Treasure。可先完成基础探索筛选，或直接添加自定义 Artist String。</div>}</div>
      <label className="block text-sm">自定义 Artist String <span className="text-xs text-[var(--muted)]">（一行一条，无代表图片时作为文字父本）</span><textarea className={`${inputClass} mt-1 min-h-24 font-mono text-xs`} value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder="0.8::artist_a::, 1.1::artist_b::" /></label>
      <div className="flex flex-wrap items-center gap-3"><button className={primaryButtonClass} onClick={confirmParents} disabled={busy}><Plus size={15} />确认当前父本集</button>{activeParentSet && <button className={buttonClass} onClick={() => setChoosingParents(false)} disabled={busy}>取消</button>}<span className="text-xs text-[var(--muted)]">已选择 {selectedTreasureIds.size} 张 Treasure</span></div>
    </div>}

    {activeParentSet && !choosingParents && <div className="mt-5 space-y-5">
      <Guide step={2}>当前父本集包含 {activeParentSet.parents.length} 条 Artist String。你可以跳过排序直接开始；排序只会调整抽样倾向。</Guide>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/25 p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">当前父本集 · {activeParentSet.parents.length} 条</h3><button className="rounded-full text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => setHelpKey("parents")} aria-label="父本集说明"><CircleHelp size={14} /></button><button className={`${buttonClass} ml-auto`} onClick={() => { setPairIndex(0); setPairwiseOpen(true); }} disabled={busy || activeParentSet.parents.length < 2}><Heart size={14} />帮我排序（可选）</button><button className={buttonClass} onClick={() => setChoosingParents(true)} disabled={busy || run.status === "running"}><Plus size={14} />建立下一轮父本集</button></div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{activeParentSet.parents.map((parent) => { const candidate = candidateForParent(run, parent); return <div key={parent.id} className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--input)]/35">{candidate ? <img className="aspect-[3/2] w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="父本代表图" loading="lazy" /> : <div className="flex aspect-[3/2] items-center justify-center bg-[var(--hover)] px-4 text-center text-xs text-[var(--muted)]">自定义 Artist String<br />无代表图片</div>}<code className="block max-h-14 overflow-hidden px-3 py-2 text-xs text-[var(--accent)]">{parent.artist_string}</code></div>; })}</div></div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/25 p-4"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">创建下一轮深度候选</h3><button className="rounded-full text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => setHelpKey("suggestion")} aria-label="出图建议说明"><CircleHelp size={14} /></button></div><Guide step={3}>建议生成 {activeParentSet.suggested_target_count ?? suggestedTargetCount(activeParentSet.parents.length)} 张；生成后建议选择 {suggestedNextParentCount(targetCount)} 条进入下一轮。</Guide><div className="mt-3 flex flex-wrap items-end gap-3"><label className="w-36 text-sm">本轮出图数<input className={`${inputClass} mt-1`} type="number" min={activeParentSet.parents.length + 1} max={1000} value={targetCount} onChange={(event) => setTargetCount(Math.max(activeParentSet.parents.length + 1, Math.min(1000, Number(event.target.value) || 1)))} /></label><button className={primaryButtonClass} onClick={appendRound} disabled={busy || run.status === "running"}><Sparkles size={15} />创建深度轮次</button></div></div>
    </div>}

    {hasDeepHistory && <div className="mt-6 border-t border-[var(--border)] pt-5">
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">纵向家系图</h3><button className="rounded-full text-[var(--muted)] hover:text-[var(--accent)]" onClick={() => setHelpKey("lineage")} aria-label="家系图说明"><CircleHelp size={14} /></button></div>
      <div className="mt-4 flex flex-col items-stretch">
        <div className="glass mx-auto w-full max-w-3xl rounded-xl p-3 text-sm"><span className="font-medium">基础探索</span><span className="ml-2 text-xs text-[var(--muted)]">{treasures.length} 个 Treasure 档案</span></div>
        {familySets.map((parentSet) => {
          const setRounds = rounds.filter((round) => round.parent_set_id === parentSet.id);
          return <div key={parentSet.id} className="flex flex-col items-stretch">
            <div className="mx-auto h-7 w-px bg-[var(--border)]" />
            <button className={`glass mx-auto w-full max-w-3xl rounded-xl p-3 text-left transition-colors hover:bg-[var(--hover)] ${parentSet.id === activeParentSet?.id ? "ring-1 ring-[var(--accent)]" : ""}`} onClick={() => setSelectedRoundId(setRounds[0]?.id ?? null)}>
              <div className="flex flex-wrap items-center gap-3"><div><div className="font-medium">父本集 {parentSet.number}</div><div className="mt-1 text-xs text-[var(--muted)]">{parentSet.parents.length} 条 Artist String · {parentSet.comparisons.length} 次偏好记录</div></div><div className="ml-auto flex -space-x-3">{parentSet.parents.slice(0, 4).map((parent) => { const candidate = candidateForParent(run, parent); return candidate ? <img key={parent.id} className="h-12 w-12 rounded-lg border-2 border-white object-cover shadow" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="父本代表图" /> : <span key={parent.id} className="flex h-12 w-12 items-center justify-center rounded-lg border-2 border-white bg-[var(--hover)] text-[9px] text-[var(--muted)] shadow">自定义</span>; })}</div></div>
            </button>
            {setRounds.map((round) => {
              const roundCandidates = run.candidates.filter((candidate) => candidate.round_id === round.id);
              const deepNumber = rounds.findIndex((item) => item.id === round.id) + 1;
              return <div key={round.id} className="flex flex-col items-stretch"><div className="mx-auto h-7 w-px bg-[var(--border)]" /><div className={`mx-auto w-72 rounded-2xl p-2 ${selectedRoundId === round.id ? "ring-2 ring-[var(--accent)]" : ""}`}><AlbumStackCard title={`深度第 ${deepNumber} 轮`} subtitle={`${round.status} · 建议选 ${round.suggested_next_parent_count ?? suggestedNextParentCount(round.target_count)} 条进入下一轮`} count={roundCandidates.length} date={round.created_at?.slice(0, 10)} coverUrls={roundCandidates.filter((candidate) => candidate.generation.status === "done" && candidate.generation.path).slice(0, 3).map((candidate) => api.styleExploreCandidateImageUrl(run.id, candidate.id))} color="#7c8cff" icon={GitBranch} index={deepNumber - 1} onOpen={() => setSelectedRoundId(round.id)} /></div></div>;
            })}
          </div>;
        })}
      </div>
    </div>}

    {selectedRound && <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--input)]/25 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div><h3 className="text-sm font-semibold">深度第 {rounds.findIndex((item) => item.id === selectedRound.id) + 1} 轮</h3><p className="mt-1 text-xs text-[var(--muted)]">{selectedRoundCandidates.length} 条候选 · 已完成 {roundDoneCount} · 待生成 {selectedRoundCandidates.length - roundDoneCount - roundFailedCount}{roundFailedCount ? ` · 失败 ${roundFailedCount}` : ""}</p></div>
        <div className="ml-auto flex flex-wrap gap-2">{run.status === "draft" && taskPendingCount > 0 && <button className={primaryButtonClass} onClick={() => controlRound("start")} disabled={busy}><Play size={14} />开始任务生成</button>}{run.status === "running" && <button className={buttonClass} onClick={() => controlRound("pause")} disabled={busy}><Pause size={14} />暂停任务生成</button>}{run.status === "paused" && taskPendingCount > 0 && <button className={primaryButtonClass} onClick={() => controlRound("resume")} disabled={busy}><Play size={14} />继续全部待生成</button>}{run.candidates.some((candidate) => candidate.generation.status === "failed") && <button className={buttonClass} onClick={() => controlRound("retry")} disabled={busy}>失败重试</button>}{unreviewedRoundCandidates.length > 0 && !selectedRoundCandidates.some((candidate) => ["pending", "generating"].includes(candidate.generation.status)) && <button className={buttonClass} onClick={() => setReviewingRoundId(selectedRound.id)} disabled={busy}><ArrowDown size={14} />按轮筛选</button>}</div>
      </div>
      <div className="mt-3 space-y-2"><div className="flex justify-between text-xs text-[var(--muted)]"><span>本轮进度 {roundDoneCount}/{selectedRoundCandidates.length}</span><span>{roundProgress}%</span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${roundProgress}%` }} /></div><div className="flex justify-between text-[10px] text-[var(--muted)]"><span>任务总进度 {taskDoneCount}/{run.candidates.length}</span><span>{taskProgress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-[var(--hover)]"><div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${taskProgress}%` }} /></div>{taskPendingCount > 0 && <p className="text-[10px] text-[var(--muted)]">任务使用同一个串行队列；继续后会把页面当前生图参数应用到所有尚未请求的候选，先补完较早轮次，再进入当前轮次。权重与候选串不会改变。</p>}</div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{selectedRoundCandidates.filter((candidate) => candidate.generation.status === "done" && candidate.generation.path && !candidate.generation.deleted_at).map((candidate) => <button type="button" key={candidate.id} className="overflow-hidden rounded-lg border border-[var(--border)] text-left transition-colors hover:border-[var(--accent)]" onClick={() => onPreviewCandidate(candidate.id)}><img className="aspect-[3/4] w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt="深度候选" loading="lazy" /><code className="block max-h-12 overflow-hidden px-2 py-1.5 text-[10px] text-[var(--accent)]">{candidate.artist_string}</code></button>)}</div>
    </div>}

    {pairwiseOpen && activeParentSet && <Modal open onClose={() => setPairwiseOpen(false)} title="可选偏好排序" wide>{currentPair ? <div className="space-y-4"><Guide step={2}>选择更符合本次目标的一方，也可跳过或选择都不合适。{pairIndex + 1} / {pairCandidates.length}</Guide><div className="grid gap-3 sm:grid-cols-2">{(["left", "right"] as const).map((side) => { const parent = currentPair[side]; const candidate = candidateForParent(run, parent); return <div key={side} className="overflow-hidden rounded-xl border border-[var(--border)]">{candidate ? <img className="aspect-[3/4] w-full object-cover" src={api.styleExploreCandidateImageUrl(run.id, candidate.id)} alt={`${side} 父本代表图`} /> : <div className="flex aspect-[3/4] items-center justify-center bg-[var(--hover)] text-sm text-[var(--muted)]">自定义串 · 无代表图</div>}<code className="block max-h-24 overflow-auto p-3 text-xs text-[var(--accent)]">{parent.artist_string}</code><button className={`${side === "left" ? primaryButtonClass : buttonClass} m-3`} onClick={() => recordPreference(side)} disabled={busy}>{side === "left" ? <ArrowUp size={14} /> : <ArrowRight size={14} />}选择这一方</button></div>; })}</div><div className="flex flex-wrap justify-end gap-2"><button className={buttonClass} onClick={() => recordPreference("skip")} disabled={busy}>跳过</button><button className={buttonClass} onClick={() => recordPreference("neither")} disabled={busy}>都不合适</button><button className={buttonClass} onClick={() => setPairwiseOpen(false)}>结束排序</button></div></div> : <div className="space-y-3"><p className="text-sm text-[var(--muted)]">当前父本不足两条，或本次比较已完成。</p><button className={buttonClass} onClick={() => setPairwiseOpen(false)}>关闭</button></div>}</Modal>}

    {reviewingRoundId && createPortal(<div className="fixed inset-x-0 bottom-0 top-[52px] z-[9000] bg-[var(--bg)]"><ReviewMode key={`${run.id}-${reviewingRoundId}-${unreviewedRoundCandidates.map((candidate) => candidate.id).join("-")}`} items={unreviewedRoundCandidates.map((candidate) => ({ path: candidate.id, name: String(candidate.generation.name ?? candidate.id), hearted: !!candidate.review.heart }))} categoryLabel={`${run.name} · 深度第 ${Math.max(1, rounds.findIndex((item) => item.id === reviewingRoundId) + 1)} 轮`} choices={DEEP_REVIEW_CHOICES} imageUrl={(item) => api.styleExploreCandidateImageUrl(run.id, item.path)} applyReview={applyRoundReviews} requireAllTagged recycleReject={false} onFinished={(result) => { setReviewingRoundId(null); notify(result.message); }} onCancel={() => setReviewingRoundId(null)} /></div>, document.body)}

    <Modal open={helpKey !== null} onClose={() => setHelpKey(null)} title={helpKey ? HELP[helpKey].title : "说明"}>{helpKey && <p className="text-sm leading-7 text-[var(--muted)]">{HELP[helpKey].text}</p>}</Modal>
  </section>;
}
