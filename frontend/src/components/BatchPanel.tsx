import { AlertTriangle, Loader2, Pause, Play, Square, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { cn, serializeSections } from "../lib";
import { useStore } from "../store";
import { useBatchStore } from "../store/batch";
import { useGenerateStore } from "../store/generate";
import type { BatchDimension, BatchRun, CardBlock, GenerateStatus, Section } from "../types";
import { Button, ConfirmDialog, Modal } from "./UI";

const DIM_NAMES = ["角色", "动作", "画师串"];
const WORKBENCH_NAME = "提示词工作台";
const ESTIMATE_SEC_PER_IMAGE = 30;

const MODEL_LABELS: Record<string, string> = {
  "nai-diffusion-4-5-full": "NAI Diffusion 4.5 Full",
  "nai-diffusion-4-5-curated": "NAI Diffusion 4.5 Curated",
  "nai-diffusion-4-full": "NAI Diffusion 4 Full",
  "nai-diffusion-4-curated-preview": "NAI Diffusion 4 Curated",
  "nai-diffusion-3": "NAI Diffusion 3",
  "nai-diffusion-furry-3": "NAI Diffusion Furry 3",
};

const STATUS_META: Record<BatchRun["status"], { label: string; cls: string }> = {
  running: { label: "生成中", cls: "text-green-400" },
  paused: { label: "已暂停", cls: "text-amber-400" },
  stopped: { label: "已停止", cls: "text-red-400" },
  completed: { label: "已完成", cls: "text-sky-400" },
};

function fmtMin(sec: number): string {
  const total = Math.max(1, Math.round(sec / 60));
  if (total < 60) return `约 ${total} 分钟`;
  return `约 ${Math.floor(total / 60)} 小时 ${total % 60} 分钟`;
}

export function BatchPanel() {
  const navigate = useNavigate();
  const positive = useStore((s) => s.positive);
  const negative = useStore((s) => s.negative);
  const addToast = useStore((s) => s.addToast);
  const params = useGenerateStore((s) => s.params);
  const vibes = useGenerateStore((s) => s.vibes);
  const setResult = useGenerateStore((s) => s.setResult);
  const run = useBatchStore((s) => s.run);
  const setRun = useBatchStore((s) => s.setRun);
  const cardCoeffs = useBatchStore((s) => s.config.cardCoeffs);
  const customModes = useBatchStore((s) => s.config.customModes);
  const stopDelta = useBatchStore((s) => s.config.stopDelta);
  const setCardCoeff = useBatchStore((s) => s.setCardCoeff);
  const setAllCardCoeff = useBatchStore((s) => s.setAllCardCoeff);
  const setCustomMode = useBatchStore((s) => s.setCustomMode);
  const setStopDelta = useBatchStore((s) => s.setStopDelta);

  const [status, setStatus] = useState<GenerateStatus | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [endConfirm, setEndConfirm] = useState(false);
  const [moveDialog, setMoveDialog] = useState<{ name: string; count: number }[] | null>(null);
  const [thresholdInput, setThresholdInput] = useState<number | null>(null);
  const lastShownPath = useRef<string | null>(null);

  const refreshStatus = useCallback(() => {
    api
      .generateStatus()
      .then(setStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // 轮询批量状态：刷新进度、断点记录与最新图片预览
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await api.batchStatus();
        if (cancelled) return;
        setRun(res.run);
        const img = res.run?.last_image;
        if (img && img.path !== lastShownPath.current) {
          lastShownPath.current = img.path;
          setResult({
            ok: true,
            path: img.path,
            name: img.name,
            seed: img.seed,
            width: img.width ?? 0,
            height: img.height ?? 0,
            anlas: res.run?.anlas ?? null,
            elapsed_ms: 0,
          });
        }
      } catch {
        /* 后端可能正在重启，忽略 */
      }
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [setRun, setResult]);

  const workbench = positive.find((s) => s.name === WORKBENCH_NAME) ?? null;
  const systemDims = useMemo(
    () => DIM_NAMES.map((n) => positive.find((s) => s.name === n)).filter(Boolean) as Section[],
    [positive]
  );
  const customSections = useMemo(
    () =>
      positive.filter(
        (s) => s.name !== WORKBENCH_NAME && !DIM_NAMES.includes(s.name) && s.blocks.length > 0
      ),
    [positive]
  );

  const dimSections = useMemo(() => {
    const list = [...systemDims];
    for (const s of customSections) if (customModes[s.id] === "dim") list.push(s);
    return list;
  }, [systemDims, customSections, customModes]);

  const sharedSections = useMemo(() => {
    const list: Section[] = [];
    if (workbench) list.push(workbench);
    for (const s of customSections) if (customModes[s.id] !== "dim") list.push(s);
    return list;
  }, [workbench, customSections, customModes]);

  const basePositive = useMemo(() => serializeSections(sharedSections), [sharedSections]);
  const negativeText = useMemo(() => serializeSections(negative), [negative]);

  const dimensions = useMemo<BatchDimension[]>(
    () =>
      dimSections.map((s) => ({
        name: s.name,
        cards: s.blocks
          .filter((b): b is CardBlock => b.type === "card")
          .map((b) => ({
            category: b.category,
            name: b.name,
            coefficient: Math.max(1, Math.round(cardCoeffs[b.id] ?? 1)),
          })),
      })),
    [dimSections, cardCoeffs]
  );

  const dimEffective = useMemo(
    () => dimensions.map((d) => d.cards.reduce((n, c) => n + c.coefficient, 0)),
    [dimensions]
  );
  const total = useMemo(() => dimEffective.reduce((n, v) => n * v, 1), [dimEffective]);

  const looseInDims = useMemo(
    () => dimSections.filter((s) => s.blocks.some((b) => b.type === "prompt")),
    [dimSections]
  );

  const currentAnlas = status?.anlas ?? run?.anlas ?? null;
  const threshold =
    thresholdInput !== null
      ? thresholdInput
      : currentAnlas !== null
        ? currentAnlas + stopDelta
        : stopDelta;
  const handleStartClick = () => {
    if (run) return;
    if (!status?.configured) {
      addToast("请先在「设置」中配置 NovelAI token", "err");
      navigate("/settings");
      return;
    }
    if (looseInDims.length > 0) {
      setMoveDialog(looseInDims.map((s) => ({ name: s.name, count: s.blocks.filter((b) => b.type === "prompt").length })));
      return;
    }
    if (dimensions.length === 0 || total <= 0) {
      addToast("组合为空：请先在工作区为组合分区添加卡片", "err");
      return;
    }
    setConfirmOpen(true);
  };

  const moveLooseToWorkbench = async () => {
    const st = useStore.getState();
    const wb = st.positive.find((s) => s.name === WORKBENCH_NAME);
    if (!wb) return;
    for (const section of st.positive) {
      const isDim = DIM_NAMES.includes(section.name) || customModes[section.id] === "dim";
      if (!isDim) continue;
      const prompts = section.blocks.filter((b) => b.type === "prompt");
      for (const p of prompts) st.moveBlock(section.id, p.id, wb.id);
    }
    const after = useStore.getState();
    await api.saveWorkspace(after.positive, after.negative).catch(() => {});
    setMoveDialog(null);
    addToast("已将散装提示词移到「提示词工作台」作为全局正面提示词");
  };

  const confirmStart = async () => {
    setStarting(true);
    try {
      const payload = {
        base_positive: basePositive,
        negative: negativeText,
        dimensions,
        params: {
          ...params,
          vibes: vibes.map((v) => ({
            id: v.id,
            strength: v.strength,
            information_extracted: v.information_extracted,
          })),
        },
        stop_anlas: Math.max(0, threshold),
      };
      const r = await api.batchStart(payload);
      setRun(r);
      setConfirmOpen(false);
      addToast(`批量生成已开始，共 ${r.total} 张（串行逐张生成）`);
    } catch (e) {
      addToast(`启动失败：${(e as Error).message}`, "err");
    } finally {
      setStarting(false);
    }
  };

  const pause = async () => {
    try {
      const r = await api.batchPause();
      addToast(r.message);
    } catch (e) {
      addToast(`暂停失败：${(e as Error).message}`, "err");
    }
  };

  const resume = async () => {
    try {
      const r = await api.batchResume();
      setRun(r);
      addToast("已从断点继续");
    } catch (e) {
      addToast(`继续失败：${(e as Error).message}`, "err");
    }
  };

  const end = async () => {
    try {
      const r = await api.batchEnd();
      setRun(null);
      setEndConfirm(false);
      addToast(r.message);
    } catch (e) {
      addToast(`结束任务失败：${(e as Error).message}`, "err");
    }
  };

  return (
    <div className="space-y-2">
      {run ? (
        <RunPanel
          run={run}
          onPause={() => void pause()}
          onResume={() => void resume()}
          onEnd={() => setEndConfirm(true)}
        />
      ) : (
        <ConfigPanel
          systemDims={systemDims}
          customSections={customSections}
          customModes={customModes}
          dimSections={dimSections}
          dimensions={dimensions}
          dimEffective={dimEffective}
          total={total}
          sharedSections={sharedSections}
          negativeCount={negative.reduce((n, s) => n + s.blocks.length, 0)}
          baseCount={sharedSections.reduce((n, s) => n + s.blocks.length, 0)}
          currentAnlas={currentAnlas}
          threshold={threshold}
          stopDelta={stopDelta}
          params={params}
          vibesCount={vibes.length}
          cardCoeffs={cardCoeffs}
          setCardCoeff={setCardCoeff}
          setAllCardCoeff={setAllCardCoeff}
          setCustomMode={setCustomMode}
          setStopDelta={setStopDelta}
          onThresholdInput={(v) => setThresholdInput(v)}
          onStart={() => void handleStartClick()}
        />
      )}

      {/* 详细确认弹窗 */}
      <Modal open={confirmOpen} onClose={() => !starting && setConfirmOpen(false)} title="确认开始批量生成">
        <ConfirmBody
          params={params}
          vibes={vibes.map((v) => v.name)}
          dimensions={dimensions}
          dimEffective={dimEffective}
          total={total}
          baseCount={sharedSections.reduce((n, s) => n + s.blocks.length, 0)}
          negativeCount={negative.reduce((n, s) => n + s.blocks.length, 0)}
          currentAnlas={currentAnlas}
          threshold={threshold}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={starting}>
            返回调整
          </Button>
          <Button onClick={() => void confirmStart()} disabled={starting}>
            {starting ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
            确认开始
          </Button>
        </div>
      </Modal>

      {/* 散装提示词引导弹窗 */}
      <Modal open={!!moveDialog} onClose={() => setMoveDialog(null)} title="组合分区包含散装提示词">
        <p className="mb-2 text-sm leading-relaxed">
          批量生成要求组合维度（角色 / 动作 / 画师串 / 自定义维度）中全部为卡片，以下分区含有散装提示词块：
        </p>
        <ul className="mb-3 space-y-1 rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5 text-xs">
          {moveDialog?.map((m) => (
            <li key={m.name} className="flex items-center gap-1.5">
              <AlertTriangle size={12} className="shrink-0 text-amber-400" />
              {m.name}（{m.count} 个散装块）
            </li>
          ))}
        </ul>
        <p className="mb-4 text-xs leading-relaxed text-[var(--muted)]">
          点击下方按钮可一键把散装提示词移到「提示词工作台」，之后它们会作为每张图的全局正面提示词；也可以回到工作区手动整理。
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setMoveDialog(null)}>
            取消
          </Button>
          <Button onClick={() => void moveLooseToWorkbench()}>
            一键移到提示词工作台
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={endConfirm}
        title="结束批量任务"
        message="结束任务后断点记录将被清理，未完成的部分不会再保留「继续上次任务」的入口。确定结束吗？"
        danger
        onConfirm={() => void end()}
        onCancel={() => setEndConfirm(false)}
      />
    </div>
  );
}

function RunPanel({
  run,
  onPause,
  onResume,
  onEnd,
}: {
  run: BatchRun;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}) {
  const meta = STATUS_META[run.status];
  const pct = run.total ? Math.round((run.done / run.total) * 100) : 0;
  const comboEntries = Object.entries(run.current_combo ?? {});
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">批量生成</span>
        <span className={cn("rounded-md px-1.5 py-0.5 text-[10px]", meta.cls, "bg-current/10")}>
          {meta.label}
        </span>
        {run.stop_reason && (
          <span className="flex items-center gap-1 rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">
            <AlertTriangle size={11} />
            {run.stop_reason}
          </span>
        )}
        <span className="ml-auto text-[10px] text-[var(--muted)]">任务 {run.id}</span>
      </div>

      <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--hover)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
        <span>
          已完成 {run.done} / {run.total}
          {run.failed > 0 && <span className="ml-1 text-amber-400">（失败 {run.failed}）</span>}
        </span>
        <span>剩余点数 {run.anlas ?? "—"}</span>
        {run.status === "running" && run.eta_sec > 0 && <span>预计剩余 {fmtMin(run.eta_sec)}</span>}
      </div>

      {comboEntries.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 px-2.5 py-2 text-[11px]">
          <span className="text-[var(--muted)]">当前组合：</span>
          {comboEntries.map(([dim, ref]) => (
            <span key={dim} className="rounded-md bg-[var(--hover)] px-1.5 py-0.5">
              {dim} <span className="text-[var(--accent)]">{ref}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mb-2 text-[10px] leading-relaxed text-[var(--muted)]">
        参数已锁定为开始时快照：{MODEL_LABELS[run.params.model ?? ""] ?? run.params.model} ·{" "}
        {run.params.width}×{run.params.height} · {run.params.steps} 步 ·{" "}
        {run.params.seed === -1 ? "随机种子" : "固定种子递增"} · Vibe {run.params.vibes?.length ?? 0} 个
      </div>

      <div className="flex flex-wrap gap-2">
        {run.status === "running" && (
          <Button variant="ghost" className="!px-5 !py-2.5 text-sm" onClick={onPause}>
            <Pause size={16} /> 暂停
          </Button>
        )}
        {(run.status === "paused" || run.status === "stopped") && (
          <Button className="!px-5 !py-2.5 text-sm" onClick={onResume}>
            <Play size={16} /> 继续上次未完成的任务
          </Button>
        )}
        <Button variant="ghost" className="!px-5 !py-2.5 text-sm" onClick={onEnd}>
          <Square size={16} /> 结束任务（清理记录）
        </Button>
      </div>
    </div>
  );
}

function ConfigPanel({
  systemDims,
  customSections,
  customModes,
  dimSections,
  dimensions,
  dimEffective,
  total,
  sharedSections,
  baseCount,
  negativeCount,
  currentAnlas,
  threshold,
  stopDelta,
  params,
  vibesCount,
  cardCoeffs,
  setCardCoeff,
  setAllCardCoeff,
  setCustomMode,
  setStopDelta,
  onThresholdInput,
  onStart,
}: {
  systemDims: Section[];
  customSections: Section[];
  customModes: Record<string, "dim" | "shared">;
  dimSections: Section[];
  dimensions: BatchDimension[];
  dimEffective: number[];
  total: number;
  sharedSections: Section[];
  baseCount: number;
  negativeCount: number;
  currentAnlas: number | null;
  threshold: number;
  stopDelta: number;
  params: ReturnType<typeof useGenerateStore.getState>["params"];
  vibesCount: number;
  cardCoeffs: Record<string, number>;
  setCardCoeff: (blockId: string, value: number) => void;
  setAllCardCoeff: (blockIds: string[], value: number) => void;
  setCustomMode: (sectionId: string, mode: "dim" | "shared") => void;
  setStopDelta: (value: number) => void;
  onThresholdInput: (v: number | null) => void;
  onStart: () => void;
}) {
  const editableDims = dimSections.map((s) => {
    const spec = dimensions.find((d) => d.name === s.name);
    return { section: s, spec: spec ?? { name: s.name, cards: [] } };
  });

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">批量生成</span>
        <span className="text-[10px] text-[var(--muted)]">
          按组合维度枚举卡片并串行逐张生成（与 ANR 一致，不做并发）
        </span>
      </div>

      {/* 组合维度 */}
      <div className="space-y-2">
        {editableDims.map(({ section, spec }, i) => {
          const cardBlocks = section.blocks.filter((b) => b.type === "card") as CardBlock[];
          const uniform = spec.cards.every((c) => c.coefficient === spec.cards[0]?.coefficient)
            ? spec.cards[0]?.coefficient
            : null;
          return (
            <div key={section.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 p-2.5">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium">{section.name}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {spec.cards.length} 张卡 · 有效 {dimEffective[i]}（张数 ×{dimEffective[i]}）
                </span>
                <span className="ml-auto flex items-center gap-1 text-[10px] text-[var(--muted)]">
                  统一系数
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={uniform ?? ""}
                    placeholder={uniform === null ? "已单独设置" : "1"}
                    onChange={(e) => {
                      const v = Math.max(1, Math.round(Number(e.target.value) || 1));
                      setAllCardCoeff(cardBlocks.map((b) => b.id), v);
                    }}
                    className="w-14 rounded-md border border-[var(--border)] bg-[var(--input)] px-1.5 py-0.5 text-center text-xs outline-none focus:border-[var(--accent)]"
                  />
                </span>
              </div>
              {cardBlocks.length === 0 ? (
                <p className="text-[10px] text-amber-400">该分区没有卡片，无法参与组合</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {cardBlocks.map((b) => (
                    <span
                      key={b.id}
                      className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--input)] px-1.5 py-1 text-[11px]"
                    >
                      <span className="max-w-[160px] truncate">{b.name}</span>
                      <span className="text-[var(--muted)]">×</span>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={cardCoeffs[b.id] ?? 1}
                        onChange={(e) =>
                          setCardCoeff(b.id, Math.max(1, Math.round(Number(e.target.value) || 1)))
                        }
                        className="w-12 rounded-md border border-[var(--border)] bg-[var(--input)] px-1 py-0.5 text-center text-[11px] outline-none focus:border-[var(--accent)]"
                        title="单卡系数：该卡在组合中重复生成的次数"
                      />
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 自定义分区：维度 or 共享 */}
      {customSections.length > 0 && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 p-2.5">
          <div className="text-[10px] font-medium text-[var(--muted)]">自定义分区（有内容）</div>
          {customSections.map((s) => {
            const mode = customModes[s.id] ?? "shared";
            return (
              <div key={s.id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{s.name}</span>
                <span className="text-[10px] text-[var(--muted)]">{s.blocks.length} 个块</span>
                <span className="ml-auto flex items-center gap-1">
                  <Button
                    size="sm"
                    variant={mode === "shared" ? "primary" : "ghost"}
                    className="!px-2 !py-0.5 !text-[10px]"
                    onClick={() => setCustomMode(s.id, "shared")}
                  >
                    全局共享
                  </Button>
                  <Button
                    size="sm"
                    variant={mode === "dim" ? "primary" : "ghost"}
                    className="!px-2 !py-0.5 !text-[10px]"
                    onClick={() => setCustomMode(s.id, "dim")}
                  >
                    作为维度
                  </Button>
                </span>
                <span className="w-full text-[10px] text-[var(--muted)]">
                  {mode === "shared"
                    ? "效果：内容进入每张图的全局正面提示词，不增加张数"
                    : "效果：该分区参与组合，总张数会乘以该维度卡片系数之和"}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* 共享基础与负面 */}
      <div className="mt-2 grid grid-cols-1 gap-2 text-[10px] text-[var(--muted)] sm:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 px-2.5 py-2">
          <span className="font-medium text-[var(--text)]">全局正面基础</span>
          <div className="mt-0.5">
            {sharedSections.length === 0
              ? "（空）"
              : sharedSections.map((s) => `${s.name} ${s.blocks.length} 块`).join(" · ")}
          </div>
          <div className="mt-0.5">共 {baseCount} 块，每张图固定传入</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 px-2.5 py-2">
          <span className="font-medium text-[var(--text)]">负面提示词</span>
          <div className="mt-0.5">共 {negativeCount} 块，全部图片固定传入</div>
        </div>
      </div>

      {/* 停止阈值 */}
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 px-2.5 py-2">
        <span className="text-[10px] font-medium text-[var(--muted)]">停止阈值</span>
        <input
          type="number"
          min={0}
          value={threshold}
          onChange={(e) => onThresholdInput(Number(e.target.value))}
          onBlur={() => onThresholdInput(null)}
          className="w-24 rounded-md border border-[var(--border)] bg-[var(--input)] px-1.5 py-0.5 text-center text-xs outline-none focus:border-[var(--accent)]"
          title="剩余点数低于该值时自动停止（开始后固定）"
        />
        <Button size="sm" variant="ghost" className="!px-2 !py-0.5 !text-[10px]" onClick={() => setStopDelta(-100)}>
          −100
        </Button>
        <Button size="sm" variant="ghost" className="!px-2 !py-0.5 !text-[10px]" onClick={() => setStopDelta(-1000)}>
          −1000
        </Button>
        <span className="text-[10px] text-[var(--muted)]">
          当前点数 {currentAnlas ?? "—"}；默认在当前点数 −{Math.abs(stopDelta)}
        </span>
      </div>

      {/* 汇总与开始 */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--panel)]/40 px-2.5 py-2">
        <span className="text-sm font-semibold">
          预计 {total} 张
        </span>
        <span className="text-[10px] text-[var(--muted)]">
          约每张 {ESTIMATE_SEC_PER_IMAGE} 秒，预计 {fmtMin(total * ESTIMATE_SEC_PER_IMAGE)}
        </span>
        <Button
          className="ml-auto !px-6 !py-3 text-base"
          onClick={onStart}
          disabled={!currentAnlas}
          title={!currentAnlas ? "无法获取点数，请先配置 Token" : undefined}
        >
          <Wand2 size={16} /> 开始批量
        </Button>
      </div>
      <p className="mt-1 text-[10px] text-[var(--muted)]">
        开始后将锁定当前参数（模型 / 分辨率 / 步数 / Vibe 等），如需调整请结束任务后修改。
      </p>
    </div>
  );
}

function ConfirmBody({
  params,
  vibes,
  dimensions,
  dimEffective,
  total,
  baseCount,
  negativeCount,
  currentAnlas,
  threshold,
}: {
  params: ReturnType<typeof useGenerateStore.getState>["params"];
  vibes: string[];
  dimensions: BatchDimension[];
  dimEffective: number[];
  total: number;
  baseCount: number;
  negativeCount: number;
  currentAnlas: number | null;
  threshold: number;
}) {
  const kv: [string, string][] = [
    ["模型", MODEL_LABELS[params.model] ?? params.model],
    ["分辨率", `${params.width} × ${params.height}`],
    ["采样步数", `${params.steps} 步`],
    ["提示词引导", `${params.scale}`],
    ["重采样系数", `${params.cfg_rescale}`],
    ["采样器", params.sampler],
    ["调度器", params.noise_schedule],
    ["负面预设", params.uc_preset],
    ["种子", params.seed === -1 ? "每张随机" : `固定 ${params.seed} 后逐张 +1`],
    ["质量词", params.quality_toggle ? "开启" : "关闭"],
    ["Variety+", params.variety ? "开启" : "关闭"],
    ...(params.furry_mode ? ([["Furry", "开启"]] as [string, string][]) : []),
    ...(params.decrisp ? ([["Decrisp", "开启"]] as [string, string][]) : []),
    ...(params.sm ? ([["SMEA", "开启"], ["SMEA DYN", params.sm_dyn ? "开启" : "关闭"]] as [string, string][]) : []),
    ...(params.legacy_uc ? ([["Legacy UC", "开启"]] as [string, string][]) : []),
    ["Vibe 参考", vibes.length ? vibes.join("、") : "无"],
  ];
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5">
        <div className="mb-1 text-xs font-medium text-[var(--muted)]">生成参数（开始后锁定）</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
          {kv.map(([k, v]) => (
            <div key={k} className="flex gap-1.5">
              <span className="shrink-0 text-[var(--muted)]">{k}</span>
              <span className="truncate">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5">
        <div className="mb-1 text-xs font-medium text-[var(--muted)]">组合方案</div>
        <div className="space-y-1 text-xs">
          {dimensions.map((d, i) => (
            <div key={d.name}>
              <span className="font-medium">{d.name}：</span>
              {d.cards.map((c) => `${c.name} ×${c.coefficient}`).join("、")}
              <span className="text-[var(--muted)]">（有效 {dimEffective[i]}）</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5 text-xs">
        <div className="mb-1 font-medium text-[var(--muted)]">提示词</div>
        <div className="space-y-0.5">
          <div>全局正面基础：{baseCount} 块（提示词工作台 + 共享分区）</div>
          <div>负面提示词：{negativeCount} 块，全部图片固定传入</div>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5 text-xs">
        <div className="mb-1 font-medium text-[var(--muted)]">点数与预计</div>
        <div className="space-y-0.5">
          <div>
            当前点数 {currentAnlas ?? "—"}；剩余点数低于 {threshold} 时自动停止
          </div>
          <div>
            总张数 <span className="font-semibold text-[var(--accent)]">{total} 张</span>，预计{" "}
            {fmtMin(total * ESTIMATE_SEC_PER_IMAGE)}（按每张约 {ESTIMATE_SEC_PER_IMAGE} 秒估算）
          </div>
          <div className="text-[var(--muted)]">串行逐张生成；中断后可「继续上次未完成的任务」</div>
        </div>
      </div>
    </div>
  );
}
