import {
  AlertTriangle,
  Check,
  ImagePlus,
  Images,
  Loader2,
  Pause,
  Play,
  Square,
  WandSparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { serializeSections } from "../lib";
import { useStore } from "../store";
import { useBatchStore } from "../store/batch";
import { useGenerateStore } from "../store/generate";
import type {
  BatchCoverCandidate,
  BatchCoverRun,
  BatchCoverTarget,
  BatchDimension,
  CardBlock,
  CardReference,
  GenerationOccupancy,
  Section,
} from "../types";
import { Button, ConfirmDialog, Modal } from "./UI";

const DIMENSION_NAMES = ["角色", "动作", "画师串"];
const WORKBENCH_NAME = "提示词工作台";

function cardKey(card: CardReference): string {
  return `${card.category}:${card.name}`;
}

function uniqueCards(cards: CardReference[]): CardReference[] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = cardKey(card);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function cardBlocks(sections: Section[]): CardBlock[] {
  return sections.flatMap((section) =>
    section.blocks.filter((block): block is CardBlock => block.type === "card")
  );
}

function statusLabel(status: BatchCoverRun["status"]): string {
  return {
    running: "生成中",
    paused: "已暂停",
    stopped: "已停止",
    completed: "可设置卡面",
  }[status];
}

export function BatchCoverPanel() {
  const positive = useStore((state) => state.positive);
  const negative = useStore((state) => state.negative);
  const categories = useStore((state) => state.categories);
  const addToast = useStore((state) => state.addToast);
  const refreshCategories = useStore((state) => state.refreshCategories);
  const params = useGenerateStore((state) => state.params);
  const vibes = useGenerateStore((state) => state.vibes);
  const config = useBatchStore((state) => state.config);

  const [run, setRun] = useState<BatchCoverRun | null>(null);
  const [anlas, setAnlas] = useState<number | null>(null);
  const [occupancy, setOccupancy] = useState<GenerationOccupancy | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [assigningDefaults, setAssigningDefaults] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [candidateTarget, setCandidateTarget] = useState<BatchCoverTarget | null>(null);
  const [candidateItems, setCandidateItems] = useState<BatchCoverCandidate[] | null>(null);
  const [assigningPath, setAssigningPath] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [coverStatus, currentOccupancy] = await Promise.allSettled([
      api.batchCoverStatus(),
      api.generationOccupancy(),
    ]);
    if (coverStatus.status === "fulfilled") setRun(coverStatus.value.run);
    if (currentOccupancy.status === "fulfilled") setOccupancy(currentOccupancy.value);
  }, []);

  useEffect(() => {
    void refresh();
    void api.generateStatus().then((status) => setAnlas(status.anlas)).catch(() => {});
    const timer = window.setInterval(() => void refresh(), 2200);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const systemDimensions = useMemo(
    () =>
      DIMENSION_NAMES.map((name) => positive.find((section) => section.name === name)).filter(
        (section): section is Section => !!section
      ),
    [positive]
  );
  const customSections = useMemo(
    () =>
      positive.filter(
        (section) =>
          section.name !== WORKBENCH_NAME &&
          !DIMENSION_NAMES.includes(section.name) &&
          section.blocks.length > 0
      ),
    [positive]
  );
  const dimensionSections = useMemo(
    () => [
      ...systemDimensions,
      ...customSections.filter((section) => config.customModes[section.id] === "dim"),
    ],
    [systemDimensions, customSections, config.customModes]
  );
  const sharedSections = useMemo(() => {
    const workbench = positive.find((section) => section.name === WORKBENCH_NAME);
    return [
      ...(workbench ? [workbench] : []),
      ...customSections.filter((section) => config.customModes[section.id] !== "dim"),
    ];
  }, [positive, customSections, config.customModes]);

  const dimensions = useMemo<BatchDimension[]>(
    () =>
      dimensionSections
        .map((section) => ({
          name: section.name,
          cards: cardBlocks([section]).map((block) => ({
            category: block.category,
            name: block.name,
            coefficient: Math.max(1, Math.round(config.cardCoeffs[block.id] ?? 1)),
          })),
        }))
        .filter((dimension) => dimension.cards.length > 0),
    [dimensionSections, config.cardCoeffs]
  );
  const sharedCards = useMemo<CardReference[]>(
    () =>
      uniqueCards(
        [...cardBlocks(sharedSections), ...cardBlocks(negative)].map((block) => ({
          category: block.category,
          name: block.name,
        }))
      ),
    [sharedSections, negative]
  );
  const participants = useMemo<CardReference[]>(
    () =>
      uniqueCards([
        ...dimensions.flatMap((dimension) =>
          dimension.cards.map((card) => ({ category: card.category, name: card.name }))
        ),
        ...sharedCards,
      ]),
    [dimensions, sharedCards]
  );
  const covered = useMemo(
    () =>
      new Set(
        categories.flatMap((category) =>
          category.cards
            .filter((card) => !!card.image)
            .map((card) => `${category.name}:${card.name}`)
        )
      ),
    [categories]
  );
  const missingTargets = useMemo(
    () => participants.filter((card) => !covered.has(cardKey(card))),
    [participants, covered]
  );
  const missingSignature = missingTargets.map(cardKey).join("|");

  useEffect(() => {
    if (!run) setSelected(new Set(missingTargets.map(cardKey)));
  }, [missingSignature, run]);

  const total = useMemo(() => {
    if (dimensions.length === 0) return participants.length ? 1 : 0;
    return dimensions
      .map((dimension) =>
        dimension.cards.reduce((sum, card) => sum + card.coefficient, 0)
      )
      .reduce((product, count) => product * count, 1);
  }, [dimensions, participants.length]);
  const looseDimensionPrompts = dimensionSections.reduce(
    (count, section) => count + section.blocks.filter((block) => block.type === "prompt").length,
    0
  );
  const hasLargeCombination = dimensions.length > 2 || total > 30;
  const hasRepeatedCards = dimensions.some((dimension) =>
    dimension.cards.some((card) => card.coefficient > 1)
  );
  const selectedTargets = missingTargets.filter((target) => selected.has(cardKey(target)));
  const stopThreshold = Math.max(0, (anlas ?? run?.anlas ?? 0) + config.stopDelta);
  const blockedByOtherTask = !run && !!occupancy?.occupied;

  const toggleTarget = (target: CardReference) => {
    const key = cardKey(target);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const start = async () => {
    if (!selectedTargets.length) {
      addToast("请至少选择一张需要准备卡面的卡片", "err");
      return;
    }
    if (looseDimensionPrompts) {
      addToast("组合维度中含散装提示词，请先在上方批量生成板块整理到工作台", "err");
      return;
    }
    setStarting(true);
    try {
      const started = await api.batchCoverStart({
        base_positive: serializeSections(sharedSections),
        negative: serializeSections(negative),
        dimensions,
        shared_cards: sharedCards,
        target_cards: selectedTargets,
        params: {
          ...params,
          vibes: vibes.map((vibe) => ({
            id: vibe.id,
            strength: vibe.strength,
            information_extracted: vibe.information_extracted,
          })),
        },
        stop_anlas: stopThreshold,
      });
      setRun(started);
      addToast(`批量卡面已开始：为 ${started.target_count} 张卡准备候选图`);
    } catch (error) {
      addToast(`启动失败：${(error as Error).message}`, "err");
    } finally {
      setStarting(false);
      void refresh();
    }
  };

  const pause = async () => {
    try {
      const result = await api.batchCoverPause();
      addToast(result.message);
    } catch (error) {
      addToast(`暂停失败：${(error as Error).message}`, "err");
    }
  };

  const resume = async () => {
    try {
      setRun(await api.batchCoverResume());
      addToast("批量卡面已从断点继续");
    } catch (error) {
      addToast(`继续失败：${(error as Error).message}`, "err");
    }
  };

  const end = async () => {
    try {
      const result = await api.batchCoverEnd();
      setRun(null);
      setEndConfirm(false);
      addToast(result.message);
      await refreshCategories(false);
    } catch (error) {
      addToast(`结束失败：${(error as Error).message}`, "err");
    }
  };

  const assignDefaults = async () => {
    setAssigningDefaults(true);
    try {
      const result = await api.batchCoverAssignDefaults();
      addToast(`已用首张成功图片设置 ${result.assigned.length} 张卡片`);
      await refreshCategories(false);
      await refresh();
    } catch (error) {
      addToast(`设置失败：${(error as Error).message}`, "err");
    } finally {
      setAssigningDefaults(false);
    }
  };

  const openCandidates = async (target: BatchCoverTarget) => {
    setCandidateTarget(target);
    setCandidateItems(null);
    try {
      const result = await api.batchCoverCandidates(target.category, target.name);
      setCandidateItems(result.items);
    } catch (error) {
      addToast(`候选图读取失败：${(error as Error).message}`, "err");
      setCandidateTarget(null);
    }
  };

  const assignCandidate = async (path: string) => {
    if (!candidateTarget) return;
    setAssigningPath(path);
    try {
      await api.batchCoverAssign(candidateTarget.category, candidateTarget.name, path);
      addToast(`已设置 <${candidateTarget.category}:${candidateTarget.name}> 的演示图`);
      setCandidateTarget(null);
      await refreshCategories(false);
      await refresh();
    } catch (error) {
      addToast(`设置失败：${(error as Error).message}`, "err");
    } finally {
      setAssigningPath(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <ImagePlus size={17} className="text-[var(--accent)]" />
          <span className="text-sm font-semibold">批量卡面</span>
          <span className="text-[10px] text-[var(--muted)]">
            独立任务，不会让普通批量生成自动检查卡面
          </span>
        </div>
        <p className="mt-2 rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel)]/40 px-3 py-2 text-xs leading-relaxed text-[var(--muted)]">
          推荐用法：1 个角色 + 一组暂无卡面的动作卡，再放入画师串、负面或工作台共享卡。
          尽量减少组合维度，并少用或不用系数，避免为了卡面一次生成过多图片。组合与系数沿用上方“批量生成”的当前设置。
        </p>

        {run ? (
          <BatchCoverRunView
            run={run}
            assigningDefaults={assigningDefaults}
            onAssignDefaults={() => void assignDefaults()}
            onCandidates={(target) => void openCandidates(target)}
            onPause={() => void pause()}
            onResume={() => void resume()}
            onEnd={() => setEndConfirm(true)}
          />
        ) : (
          <div className="mt-3 space-y-3">
            {blockedByOtherTask && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs">
                <AlertTriangle size={14} className="text-amber-400" />
                生成通道正被“{occupancy?.task_name ?? "其他任务"}”占用，请先暂停或结束该任务。
              </div>
            )}

            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">选择要补卡面的卡片</span>
                <span className="text-[var(--muted)]">
                  已选 {selectedTargets.length} / 暂无卡面 {missingTargets.length}
                </span>
                {missingTargets.length > 0 && (
                  <button
                    type="button"
                    className="ml-auto text-[10px] text-[var(--accent)] hover:underline"
                    onClick={() =>
                      setSelected(
                        selectedTargets.length === missingTargets.length
                          ? new Set()
                          : new Set(missingTargets.map(cardKey))
                      )
                    }
                  >
                    {selectedTargets.length === missingTargets.length ? "取消全选" : "全选"}
                  </button>
                )}
              </div>
              {missingTargets.length ? (
                <div className="flex max-h-36 flex-wrap gap-1.5 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 p-2">
                  {missingTargets.map((target) => {
                    const checked = selected.has(cardKey(target));
                    return (
                      <button
                        key={cardKey(target)}
                        type="button"
                        className={`flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors ${
                          checked
                            ? "border-[var(--accent)] bg-[var(--accent)]/10"
                            : "border-[var(--border)] bg-[var(--input)] text-[var(--muted)]"
                        }`}
                        onClick={() => toggleTarget(target)}
                      >
                        <span className="flex h-3.5 w-3.5 items-center justify-center rounded border border-current">
                          {checked && <Check size={10} />}
                        </span>
                        {target.category} · {target.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-xs text-[var(--muted)]">
                  当前工作区没有缺少演示图的卡片。
                </div>
              )}
            </div>

            {(hasLargeCombination || hasRepeatedCards || looseDimensionPrompts > 0) && (
              <div className="flex items-start gap-2 rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] text-amber-500">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {looseDimensionPrompts > 0
                    ? `组合维度内还有 ${looseDimensionPrompts} 个散装提示词，请先在上方批量板块整理。`
                    : `当前方案预计生成 ${total} 张${hasRepeatedCards ? "，且使用了大于 1 的系数" : ""}；建议先精简后再准备卡面。`}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 px-3 py-2">
              <span className="text-sm font-semibold">预计生成 {total} 张</span>
              <span className="text-[10px] text-[var(--muted)]">
                {dimensions.length} 个组合维度 · 停止阈值 {stopThreshold} · 当前点数 {anlas ?? "—"}
              </span>
              <Button
                className="ml-auto"
                onClick={() => void start()}
                disabled={
                  starting ||
                  blockedByOtherTask ||
                  !anlas ||
                  !selectedTargets.length ||
                  looseDimensionPrompts > 0
                }
              >
                {starting ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <WandSparkles size={15} />
                )}
                开始准备卡面
              </Button>
            </div>
          </div>
        )}
      </div>

      <Modal
        open={!!candidateTarget}
        onClose={() => !assigningPath && setCandidateTarget(null)}
        title={
          candidateTarget
            ? `选择 <${candidateTarget.category}:${candidateTarget.name}> 的演示图`
            : "选择演示图"
        }
      >
        {candidateItems === null ? (
          <div className="flex h-40 items-center justify-center text-[var(--muted)]">
            <Loader2 size={20} className="animate-spin" />
          </div>
        ) : candidateItems.length ? (
          <div className="grid max-h-[65vh] grid-cols-2 gap-2 overflow-auto sm:grid-cols-3">
            {candidateItems.map((item) => (
              <button
                key={`${item.index}-${item.path}`}
                type="button"
                disabled={!!assigningPath}
                className="group overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--input)] text-left hover:border-[var(--accent)]"
                onClick={() => void assignCandidate(item.path)}
              >
                <img
                  src={api.libraryThumbnailUrl(item.path)}
                  alt={`候选图 ${item.index + 1}`}
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
                <div className="flex items-center gap-1 px-2 py-1.5 text-[10px]">
                  {assigningPath === item.path ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Images size={11} />
                  )}
                  第 {item.index + 1} 张 · seed {item.seed ?? "—"}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-[var(--muted)]">
            这张卡还没有成功生成的候选图。
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={endConfirm}
        title="结束批量卡面任务"
        message="结束后会清理候选图与卡片的对应记录，已经设置的演示图和图库图片会保留。确定结束吗？"
        danger
        onConfirm={() => void end()}
        onCancel={() => setEndConfirm(false)}
      />
    </div>
  );
}

function BatchCoverRunView({
  run,
  assigningDefaults,
  onAssignDefaults,
  onCandidates,
  onPause,
  onResume,
  onEnd,
}: {
  run: BatchCoverRun;
  assigningDefaults: boolean;
  onAssignDefaults: () => void;
  onCandidates: (target: BatchCoverTarget) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  const percent = run.total ? Math.round((run.done / run.total) * 100) : 0;
  const readyCount = run.targets.filter((target) => target.candidate_count > 0).length;
  const assignedCount = run.targets.filter((target) => !!target.assigned_path).length;
  const readyUnassignedCount = run.targets.filter(
    (target) => target.candidate_count > 0 && !target.assigned_path
  ).length;

  return (
    <div className="mt-3 space-y-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold">{statusLabel(run.status)}</span>
          <span className="text-[var(--muted)]">
            已生成 {run.done}/{run.total} · 失败 {run.failed} · 可设置 {readyCount}/{run.target_count} · 已设置 {assignedCount}
          </span>
          <span className="ml-auto text-[10px] text-[var(--muted)]">任务 {run.id}</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--hover)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${percent}%` }}
          />
        </div>
        {run.stop_reason && <p className="mt-2 text-[11px] text-amber-500">{run.stop_reason}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {run.status === "running" && (
            <Button size="sm" variant="ghost" onClick={onPause}>
              <Pause size={14} /> 暂停
            </Button>
          )}
          {(run.status === "paused" || run.status === "stopped") && (
            <Button size="sm" onClick={onResume}>
              <Play size={14} /> 继续生成
            </Button>
          )}
          <Button
            size="sm"
            onClick={onAssignDefaults}
            disabled={assigningDefaults || readyUnassignedCount === 0}
          >
            {assigningDefaults ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ImagePlus size={14} />
            )}
            一键使用首张图
          </Button>
          <Button size="sm" variant="ghost" onClick={onEnd}>
            <Square size={14} /> 结束任务
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {run.targets.map((target) => {
          const preview = target.assigned_path ?? target.default_path;
          return (
            <div
              key={cardKey(target)}
              className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 p-2"
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-[var(--hover)]">
                {preview ? (
                  <img
                    src={api.libraryThumbnailUrl(preview)}
                    alt={target.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-[var(--muted)]">
                    <Images size={18} />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-medium">{target.name}</div>
                <div className="truncate text-[10px] text-[var(--muted)]">
                  {target.category} · 候选 {target.candidate_count} 张
                </div>
                <button
                  type="button"
                  disabled={target.candidate_count === 0}
                  className="mt-1 text-[10px] text-[var(--accent)] hover:underline disabled:text-[var(--muted)] disabled:no-underline"
                  onClick={() => onCandidates(target)}
                >
                  {target.assigned_path ? "更换演示图" : "选择演示图"}
                </button>
              </div>
              {target.assigned_path && <Check size={15} className="shrink-0 text-emerald-500" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
