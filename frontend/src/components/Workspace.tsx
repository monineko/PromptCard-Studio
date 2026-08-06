import { AnimatePresence, motion } from "framer-motion";
import {
  ClipboardCopy,
  FolderPlus,
  Pencil,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn, categoryHue } from "../lib";
import { useStore } from "../store";
import type { Block, Section } from "../types";
import { Button, CategoryBadge, ConfirmDialog, IconBtn, Modal } from "./UI";

function ZoneTabs() {
  const zone = useStore((s) => s.zone);
  const setZone = useStore((s) => s.setZone);
  const positiveCount = useStore((s) => s.positive.reduce((n, x) => n + x.blocks.length, 0));
  const negativeCount = useStore((s) => s.negative.reduce((n, x) => n + x.blocks.length, 0));
  return (
    <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--input)] p-1">
      {(
        [
          ["positive", "正面提示词", positiveCount],
          ["negative", "负面提示词", negativeCount],
        ] as const
      ).map(([key, label, count]) => (
        <button
          key={key}
          onClick={() => setZone(key)}
          className={cn(
            "rounded-lg px-4 py-1.5 text-sm transition-all",
            zone === key ? "text-white shadow" : "text-[var(--muted)] hover:text-[var(--text)]"
          )}
          style={zone === key ? { background: "var(--accent)" } : undefined}
        >
          {label}
          <span className={cn("ml-1.5 text-xs opacity-70", zone !== key && "text-[var(--muted)]")}>
            {count}
          </span>
        </button>
      ))}
    </div>
  );
}

type DragState = {
  block: Block;
  fromSectionId: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
};

let suppressClickUntil = 0;

function PromptChip({
  block,
  sectionId,
  onDragStart,
  onEdit,
}: {
  block: Extract<Block, { type: "prompt" }>;
  sectionId: string;
  onDragStart: (e: React.PointerEvent, block: Block) => void;
  onEdit: (block: Extract<Block, { type: "prompt" }>, sectionId: string) => void;
}) {
  const removeBlock = useStore((s) => s.removeBlock);
  const adjustWeight = useStore((s) => s.adjustWeight);
  const weight = block.weight && block.weight !== 1 ? block.weight : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      data-block-id={block.id}
      onPointerDown={(e) => onDragStart(e, block)}
      onClick={() => {
        if (Date.now() < suppressClickUntil) return;
        onEdit(block, sectionId);
      }}
      className={
        "group flex cursor-grab touch-none select-none items-center gap-0.5 rounded-lg border px-1 py-1 text-xs transition-colors active:cursor-grabbing " +
        (weight !== null
          ? weight > 1
            ? "border-orange-400/60 bg-orange-400/10 hover:bg-orange-400/15"
            : "border-sky-400/60 bg-sky-400/10 hover:bg-sky-400/15"
          : "border-[var(--border)] bg-[var(--input)] hover:border-[var(--accent)] hover:bg-[var(--hover)]")
      }
      title="点击编辑；拖动排序；+/- 调节提示词系数"
    >
      <button
        title="降低系数 0.1"
        disabled={weight !== null && weight <= 0.1}
        onPointerDown={stop}
        onClick={(e) => {
          stop(e);
          adjustWeight(sectionId, block.id, -0.1);
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:text-red-400 disabled:opacity-30"
      >
        −
      </button>
      <span className="min-w-0 truncate px-0.5">{block.text}</span>
      {weight !== null && (
        <span className="rounded bg-[var(--hover)] px-1 font-mono text-[10px] text-[var(--accent)]">
          | {weight.toFixed(1)}
        </span>
      )}
      <button
        title="提高系数 0.1"
        disabled={weight !== null && weight >= 3}
        onPointerDown={stop}
        onClick={(e) => {
          stop(e);
          adjustWeight(sectionId, block.id, 0.1);
        }}
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:text-[var(--accent)] disabled:opacity-30"
      >
        +
      </button>
      <IconBtn
        danger
        title="删除该提示词"
        className="hidden h-4 w-4 group-hover:inline-flex"
        onClick={(e) => {
          stop(e);
          removeBlock(sectionId, block.id);
        }}
      >
        <X size={11} />
      </IconBtn>
    </motion.div>
  );
}

function CardChip({
  block,
  sectionId,
  onDragStart,
}: {
  block: Extract<Block, { type: "card" }>;
  sectionId: string;
  onDragStart: (e: React.PointerEvent, block: Block) => void;
}) {
  const removeBlock = useStore((s) => s.removeBlock);
  const openDetail = useStore((s) => s.openDetail);
  const colorMap = useStore((s) => s.categoryColor);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      data-block-id={block.id}
      onPointerDown={(e) => onDragStart(e, block)}
      onClick={() => {
        if (Date.now() < suppressClickUntil) return;
        openDetail(block.category, block.name);
      }}
      className="group flex cursor-grab touch-none select-none items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-xs transition-colors hover:border-[var(--accent)] hover:bg-[var(--hover)] active:cursor-grabbing"
      title={`<${block.category}:${block.name}> · 点击打开卡片详情`}
    >
      <CategoryBadge name={block.category} hue={colorMap[block.category]} />
      <span className="text-[var(--muted)]">{block.category}：</span>
      <span className="font-medium">{block.name}</span>
      <IconBtn
        danger
        title="移除该块"
        className="hidden h-4 w-4 group-hover:inline-flex"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          removeBlock(sectionId, block.id);
        }}
      >
        <X size={11} />
      </IconBtn>
    </motion.div>
  );
}

function SectionView({
  section,
  drag,
  hoverSectionId,
  onDragStart,
  onEditPrompt,
}: {
  section: Section;
  drag: DragState | null;
  hoverSectionId: string | null;
  onDragStart: (e: React.PointerEvent, block: Block) => void;
  onEditPrompt: (block: Extract<Block, { type: "prompt" }>, sectionId: string) => void;
}) {
  const renameSection = useStore((s) => s.renameSection);
  const deleteSection = useStore((s) => s.deleteSection);
  const addPrompt = useStore((s) => s.addPrompt);
  const addPrompts = useStore((s) => s.addPrompts);
  const autoSplit = useStore((s) => s.autoSplit);
  const [inputOpen, setInputOpen] = useState(false);
  const [value, setValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(section.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const colorMap = useStore((s) => s.categoryColor);
  const hue = colorMap[section.name] ?? categoryHue(section.name);
  const isTarget = drag !== null && hoverSectionId === section.id;

  const submit = () => {
    if (autoSplit && value.includes(",")) {
      addPrompts(section.id, value.split(","));
    } else {
      addPrompt(section.id, value);
    }
    setValue("");
    setInputOpen(false);
  };

  return (
    <div
      data-section-id={section.id}
      className={cn(
        "rounded-2xl border p-3 transition-all",
        isTarget ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--input)]/50"
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-3 w-1 rounded-full"
          style={{ background: `hsl(${hue} 70% 55%)`, boxShadow: `0 0 8px hsl(${hue} 70% 55% / .5)` }}
        />
        <span className="text-sm font-semibold">{section.name}</span>
        <span className="text-xs text-[var(--muted)]">{section.blocks.length}</span>
        <span className="ml-auto flex items-center gap-0.5">
          {!section.locked && (
            <>
              <IconBtn title="重命名分区" onClick={() => { setNewName(section.name); setRenaming(true); }}>
                <Pencil size={13} />
              </IconBtn>
              <IconBtn danger title="删除分区（内容移入其他）" onClick={() => setConfirmDel(true)}>
                <Trash2 size={13} />
              </IconBtn>
            </>
          )}
          <IconBtn title="添加提示词" onClick={() => setInputOpen((v) => !v)}>
            <Plus size={14} />
          </IconBtn>
        </span>
      </div>

      <div className="flex min-h-[34px] flex-wrap items-center gap-1.5">
        <AnimatePresence initial={false}>
          {section.blocks.map((b) =>
            b.type === "prompt" ? (
              <PromptChip
                key={b.id}
                block={b}
                sectionId={section.id}
                onDragStart={onDragStart}
                onEdit={onEditPrompt}
              />
            ) : (
              <CardChip key={b.id} block={b} sectionId={section.id} onDragStart={onDragStart} />
            )
          )}
        </AnimatePresence>
        {inputOpen && (
          <motion.input
            autoFocus
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 160, opacity: 1 }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") setInputOpen(false);
            }}
            onBlur={() => {
              if (value.trim()) submit();
              else setInputOpen(false);
            }}
            placeholder="输入提示词，回车添加"
            className="rounded-lg border border-[var(--accent)] bg-[var(--input)] px-2 py-1 text-xs outline-none"
          />
        )}
      </div>

      <Modal open={renaming} onClose={() => setRenaming(false)} title={`重命名分区「${section.name}」`}>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRenaming(false)}>取消</Button>
          <Button
            onClick={() => {
              renameSection(section.id, newName);
              setRenaming(false);
            }}
          >
            保存
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDel}
        title="删除分区"
        message={`确定删除分区「${section.name}」吗？其中的内容会移到「其他」。`}
        danger
        onConfirm={() => { deleteSection(section.id); setConfirmDel(false); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

export function Workspace() {
  const zone = useStore((s) => s.zone);
  const sections = useStore((s) => (s.zone === "positive" ? s.positive : s.negative));
  const copyZone = useStore((s) => s.copyZone);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const clearZone = useStore((s) => s.clearZone);
  const addSection = useStore((s) => s.addSection);
  const addPrompt = useStore((s) => s.addPrompt);
  const addPrompts = useStore((s) => s.addPrompts);
  const updatePrompt = useStore((s) => s.updatePrompt);
  const addToast = useStore((s) => s.addToast);
  const autoSplit = useStore((s) => s.autoSplit);
  const setAutoSplit = (v: boolean) => {
    localStorage.setItem("npm_auto_split", v ? "1" : "0");
    useStore.setState({ autoSplit: v });
  };
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const blocksCount = sections.reduce((n, x) => n + x.blocks.length, 0);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverSectionId, setHoverSectionId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [editingPrompt, setEditingPrompt] = useState<{ sectionId: string; blockId: string } | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [bottomValue, setBottomValue] = useState("");
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const openPromptEdit = (block: Extract<Block, { type: "prompt" }>, sectionId: string) => {
    setEditingPrompt({ sectionId, blockId: block.id });
    setPromptDraft(block.text);
  };

  const addBottomPrompt = () => {
    const v = bottomValue.trim();
    if (!v) return;
    const s = useStore.getState();
    const zoneSections = s.zone === "positive" ? s.positive : s.negative;
    const target = zoneSections.find((sec) => sec.name === "其他") ?? zoneSections[zoneSections.length - 1];
    if (!target) {
      addToast("当前区域还没有分区，请先添加分区", "err");
      return;
    }
    if (autoSplit && v.includes(",")) addPrompts(target.id, v.split(","));
    else addPrompt(target.id, v);
    setBottomValue("");
  };

  const onDragStart = (e: React.PointerEvent, block: Block) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const sectionId = (e.currentTarget.closest("[data-section-id]") as HTMLElement)?.dataset.sectionId;
    if (!sectionId) return;
    setDrag({ block, fromSectionId: sectionId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const sectionEl = el?.closest("[data-section-id]") as HTMLElement | null;
      setHoverSectionId(sectionEl?.dataset.sectionId ?? null);
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d) {
        setDrag(null);
        setHoverSectionId(null);
        return;
      }
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const moved = Math.hypot(dx, dy) > 6;
      if (moved) suppressClickUntil = Date.now() + 120;
      if (!moved) {
        // 纯点击（未拖动）：不触发移动，避免块被误挪到末尾
        setDrag(null);
        setHoverSectionId(null);
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const sectionEl = el?.closest("[data-section-id]") as HTMLElement | null;
      const toSectionId = sectionEl?.dataset.sectionId ?? d.fromSectionId;
      const blockEl = el?.closest("[data-block-id]") as HTMLElement | null;
      const sections = useStore.getState().zone === "positive" ? useStore.getState().positive : useStore.getState().negative;
      const toSection = sections.find((s) => s.id === toSectionId);
      let index: number | undefined;
      if (blockEl && toSection) {
        const targetId = blockEl.dataset.blockId;
        const targetIndex = toSection.blocks.findIndex((b) => b.id === targetId);
        if (targetIndex >= 0 && targetId !== d.block.id) index = targetIndex;
      }
      useStore.getState().moveBlock(
        d.fromSectionId,
        d.block.id,
        toSectionId ?? d.fromSectionId,
        index
      );
      setDrag(null);
      setHoverSectionId(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [drag]);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <ZoneTabs />
        <div className="ml-auto flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={autoSplit}
              onChange={(e) => setAutoSplit(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            自动分块
          </label>
          <Button size="sm" variant="ghost" onClick={() => { setNewSectionName(""); setShowAddSection(true); }}>
            <FolderPlus size={14} /> 添加分区
          </Button>
          <Button size="sm" variant="ghost" onClick={() => undo()} disabled={!canUndo} title="撤销 Ctrl+Z">
            <Undo2 size={14} /> 撤销
          </Button>
          <Button size="sm" variant="ghost" onClick={() => redo()} disabled={!canRedo} title="重做 Ctrl+Y">
            <Redo2 size={14} /> 重做
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)}>
            <Trash2 size={14} /> 清空
          </Button>
          <Button size="sm" onClick={() => copyZone()} disabled={blocksCount === 0}>
            <ClipboardCopy size={14} /> 复制
          </Button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
        {sections.length === 0 ? (
          <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] text-[var(--muted)]">
            <span className="text-sm">当前区域还没有分区</span>
            <span className="text-xs">点击"添加分区"创建，或在下方卡片面板添加卡片</span>
          </div>
        ) : (
          sections.map((section) => (
            <SectionView
              key={section.id}
              section={section}
              drag={drag}
              hoverSectionId={hoverSectionId}
              onDragStart={onDragStart}
              onEditPrompt={openPromptEdit}
            />
          ))
        )}
      </div>

      {/* 常驻输入框：始终显示在工作区底部，回车添加到当前区域 */}
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--input)]/50 px-3 py-2 transition-colors focus-within:border-[var(--accent)]">
        <Plus size={14} className="shrink-0 text-[var(--muted)]" />
        <input
          value={bottomValue}
          onChange={(e) => setBottomValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") addBottomPrompt();
            if (e.key === "Escape") setBottomValue("");
          }}
          placeholder={`输入提示词，回车添加到${zone === "positive" ? "正面" : "负面"}区域${
            autoSplit ? "（支持逗号自动分块）" : ""
          }`}
          className="w-full bg-transparent text-sm outline-none placeholder:text-[var(--muted)]"
        />
        <Button size="sm" onClick={addBottomPrompt} disabled={!bottomValue.trim()}>
          <Plus size={13} /> 添加
        </Button>
      </div>

      <AnimatePresence>
        {drag && (
          <motion.div
            className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--panel-solid)] px-2.5 py-1.5 text-xs shadow-2xl"
            style={{ left: drag.x + 10, top: drag.y + 10 }}
            initial={{ scale: 0.9, opacity: 0.8 }}
            animate={{ scale: 1.05, opacity: 1 }}
          >
            {drag.block.type === "card" ? (
              <>
                <CategoryBadge name={drag.block.category} />
                <span className="text-[var(--muted)]">{drag.block.category}：</span>
                <span className="font-medium">{drag.block.name}</span>
              </>
            ) : (
              <>
                <span>{drag.block.text}</span>
                {drag.block.weight && drag.block.weight !== 1 && (
                  <span className="font-mono text-[10px] text-[var(--accent)]">
                    | {drag.block.weight.toFixed(1)}
                  </span>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={showAddSection} onClose={() => setShowAddSection(false)} title="添加分区">
        <input
          autoFocus
          value={newSectionName}
          onChange={(e) => setNewSectionName(e.target.value)}
          placeholder="分区名称，如：外貌、服装"
          className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && newSectionName.trim()) {
              addSection(newSectionName);
              setShowAddSection(false);
            }
          }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setShowAddSection(false)}>取消</Button>
          <Button
            onClick={() => {
              if (newSectionName.trim()) {
                addSection(newSectionName);
                setShowAddSection(false);
              }
            }}
          >
            创建
          </Button>
        </div>
      </Modal>

      {/* 非卡片提示词块编辑弹窗：仅提示词内容可编辑 */}
      <Modal open={!!editingPrompt} onClose={() => setEditingPrompt(null)} title="编辑提示词">
        <label className="mb-1 block text-xs text-[var(--muted)]">提示词内容</label>
        <textarea
          autoFocus
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          rows={5}
          placeholder="输入完整提示词…支持 <分类:名称> 嵌套引用"
          className="scroll-thin w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditingPrompt(null)}>取消</Button>
          <Button
            onClick={() => {
              if (editingPrompt && promptDraft.trim()) {
                updatePrompt(editingPrompt.sectionId, editingPrompt.blockId, promptDraft);
              }
              setEditingPrompt(null);
            }}
          >
            保存
          </Button>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirmClear}
        title="清空当前区域"
        message={`确定清空${zone === "positive" ? "正面" : "负面"}区域的所有提示词吗？可以用撤销恢复。`}
        danger
        onConfirm={() => { clearZone(); setConfirmClear(false); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
