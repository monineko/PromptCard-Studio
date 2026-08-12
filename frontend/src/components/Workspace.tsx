import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowDownToLine,
  ClipboardCopy,
  Combine,
  Eraser,
  FolderPlus,
  MousePointerClick,
  Pencil,
  Plus,
  Redo2,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import craftingTable from "../assets/icons/crafting-table.png";
import {
  cn,
  categoryHue,
  normalizePromptTerms,
  NOTE_COLOR_CATEGORIES,
  serializeSections,
  splitWeightedPrompt,
} from "../lib";
import { useStore } from "../store";
import type { Block, PromptBlock, Section } from "../types";
import { FlipNavButton } from "./FlipNavButton";
import { Button, CategoryBadge, ConfirmDialog, IconBtn, Modal } from "./UI";

type DragState = {
  block: Block;
  fromSectionId: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  multi: boolean;
};

let suppressClickUntil = 0;

function PromptChip({
  block,
  sectionId,
  onDragStart,
  onEdit,
  selectMode,
  selected,
  onSelectClick,
}: {
  block: PromptBlock;
  sectionId: string;
  onDragStart: (e: React.PointerEvent, block: Block) => void;
  onEdit: (block: PromptBlock, sectionId: string) => void;
  selectMode: boolean;
  selected: boolean;
  onSelectClick?: (e: React.MouseEvent, block: Block) => void;
}) {
  const removeBlock = useStore((s) => s.removeBlock);
  const adjustWeight = useStore((s) => s.adjustWeight);
  const showCn = useStore((s) => s.settings?.show_chinese ?? true);
  const colorMap = useStore((s) => s.categoryColor);
  const weight = block.weight && block.weight !== 1 ? block.weight : null;
  // 词典分类 → 卡包颜色；负面/其他/未知保持灰色，分类颜色缺失时用随机（稳定）色
  const noteHue =
    block.category && NOTE_COLOR_CATEGORIES.has(block.category)
      ? colorMap[block.category] ?? categoryHue(block.category)
      : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const tooltip = [
    block.text,
    block.cn && showCn ? `中文：${block.cn}` : "",
    block.note ? `备注：${block.note}` : "",
    selectMode ? "选择模式：单击选中/取消，Shift+单击 头尾连选" : "点击编辑；拖动排序；+/- 调节提示词系数",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      data-block-id={block.id}
      onPointerDown={(e) => onDragStart(e, block)}
      onClick={(ev) => {
        if (Date.now() < suppressClickUntil) return;
        if (selectMode) {
          onSelectClick?.(ev, block);
          return;
        }
        onEdit(block, sectionId);
      }}
      title={tooltip}
      className={cn(
        "group flex cursor-grab touch-none select-none items-center gap-0.5 rounded-lg border px-1 py-1 text-xs transition-colors active:cursor-grabbing",
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/15 shadow-[0_0_10px] shadow-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
          : weight !== null
            ? weight > 1
              ? "border-orange-400/60 bg-orange-400/10 hover:bg-orange-400/15"
              : "border-sky-400/60 bg-sky-400/10 hover:bg-sky-400/15"
            : "border-[var(--border)] bg-[var(--input)] hover:border-[var(--accent)] hover:bg-[var(--hover)]"
      )}
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
      <span className="min-w-0 max-w-[260px] truncate px-0.5">{block.text}</span>
      {block.cn && showCn && (
        <>
          <span className="text-[var(--muted)]">|</span>
          <span className="max-w-[180px] truncate text-[var(--accent)]">{block.cn}</span>
        </>
      )}
      {block.note && (
        <span
          title={block.note}
          className={cn(
            "max-w-[120px] truncate rounded px-1 text-[10px]",
            noteHue == null && "bg-[var(--hover)] text-[var(--muted)]"
          )}
          style={
            noteHue != null
              ? {
                  background: `hsl(${noteHue} 70% 55% / 0.16)`,
                  color: `hsl(${noteHue} 75% 60%)`,
                  border: `1px solid hsl(${noteHue} 70% 55% / 0.35)`,
                }
              : undefined
          }
        >
          {block.note}
        </span>
      )}
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
  selectMode,
  selected,
  onSelectClick,
}: {
  block: Extract<Block, { type: "card" }>;
  sectionId: string;
  onDragStart: (e: React.PointerEvent, block: Block) => void;
  selectMode: boolean;
  selected: boolean;
  onSelectClick?: (e: React.MouseEvent, block: Block) => void;
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
      onClick={(ev) => {
        if (Date.now() < suppressClickUntil) return;
        if (selectMode) {
          onSelectClick?.(ev, block);
          return;
        }
        openDetail(block.category, block.name);
      }}
      className={cn(
        "group flex cursor-grab touch-none select-none items-center gap-1.5 rounded-lg border px-2 py-1 text-xs transition-colors active:cursor-grabbing",
        selected
          ? "border-[var(--accent)] bg-[var(--accent)]/15 shadow-[0_0_10px] shadow-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
          : "border-[var(--border)] bg-[var(--input)] hover:border-[var(--accent)] hover:bg-[var(--hover)]"
      )}
      title={
        `<${block.category}:${block.name}> · ` +
        (selectMode ? "选择模式：单击选中/取消，Shift+单击 头尾连选" : "点击打开卡片详情")
      }
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
  onSelectClick,
  large,
  isFirst,
  onSplit,
  onMerge,
  onComposeCard,
  onMoveAll,
}: {
  section: Section;
  drag: DragState | null;
  hoverSectionId: string | null;
  onDragStart: (e: React.PointerEvent, block: Block) => void;
  onEditPrompt: (block: PromptBlock, sectionId: string) => void;
  onSelectClick: (e: React.MouseEvent, block: Block) => void;
  large?: boolean;
  isFirst?: boolean;
  onSplit?: () => void;
  onMerge?: () => void;
  onComposeCard?: () => void;
  onMoveAll?: () => void;
}) {
  const renameSection = useStore((s) => s.renameSection);
  const deleteSection = useStore((s) => s.deleteSection);
  const addPrompt = useStore((s) => s.addPrompt);
  const copySection = useStore((s) => s.copySection);
  const clearSection = useStore((s) => s.clearSection);
  const selectMode = useStore((s) => s.selectMode);
  const selected = useStore((s) => s.selected);
  const exitSelectMode = useStore((s) => s.exitSelectMode);
  const [inputOpen, setInputOpen] = useState(false);
  const [value, setValue] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(section.name);
  const [confirmDel, setConfirmDel] = useState(false);
  const colorMap = useStore((s) => s.categoryColor);
  const hue = colorMap[section.name] ?? categoryHue(section.name);
  const isTarget = drag !== null && hoverSectionId === section.id;

  const submit = () => {
    addPrompt(section.id, value);
    setValue("");
    setInputOpen(false);
  };

  return (
    <div
      data-section-id={section.id}
      onClick={(e) => {
        if (selectMode && e.target === e.currentTarget) exitSelectMode();
      }}
      className={cn(
        "rounded-2xl border p-3 transition-all",
        isTarget ? "border-[var(--accent)] bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--input)]/50"
      )}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span
          className="h-3 w-1 rounded-full"
          style={{ background: `hsl(${hue} 70% 55%)`, boxShadow: `0 0 8px hsl(${hue} 70% 55% / .5)` }}
        />
        <span className="text-sm font-semibold">{section.name}</span>
        <span className="text-xs text-[var(--muted)]">{section.blocks.length}</span>
        <span className="ml-auto flex flex-wrap items-center gap-0.5">
          {isFirst && (
            <>
              <Button
                size="md"
                variant="ghost"
                className="border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)]/10"
                title="把本分区所有提示词块合并成一个块（不创建卡片，原块删除，可撤销）"
                onClick={onMerge}
              >
                <Combine size={14} /> 提示词合并
              </Button>
              <Button
                size="md"
                variant="ghost"
                className="border-[var(--accent)]/50 text-[var(--accent)] hover:bg-[var(--accent)]/10"
                title="把本分区所有提示词按系数语法分块，分块后自动标注中文"
                onClick={onSplit}
              >
                <Plus size={14} /> 提示词分块
              </Button>
              <Button
                size="md"
                title="把本分区所有提示词合成为一张卡片（原内容会删除，可撤销）"
                onClick={onComposeCard}
              >
                <img src={craftingTable} alt="" className="h-4 w-4" /> 合成Card
              </Button>
              <Button
                size="md"
                variant="ghost"
                title="把工作台全部提示词移到「角色」分区，用于先挑词再合成"
                onClick={onMoveAll}
              >
                <ArrowDownToLine size={14} /> 先放下面！
              </Button>
            </>
          )}
          <IconBtn title="合并本分区所有提示词块" onClick={() => onMerge?.()}>
            <Combine size={13} />
          </IconBtn>
          <IconBtn title="清空本分区" onClick={() => clearSection(section.id)}>
            <Eraser size={13} />
          </IconBtn>
          <IconBtn title="复制本分区全部提示词" onClick={() => void copySection(section.id)}>
            <ClipboardCopy size={13} />
          </IconBtn>
          {!section.locked && (
            <>
              <IconBtn title="重命名分区" onClick={() => { setNewName(section.name); setRenaming(true); }}>
                <Pencil size={13} />
              </IconBtn>
              <IconBtn danger title="删除分区（内容移入提示词工作台）" onClick={() => setConfirmDel(true)}>
                <Trash2 size={13} />
              </IconBtn>
            </>
          )}
        </span>
      </div>

      {isFirst && (
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--muted)]">
          导入大段提示词后点「提示词分块」自动拆成单词块并标注中文；点「先放下面！」把整段移到角色分区挑词，
          挑回工作台的块点「合成Card」保存为卡片。
        </p>
      )}

      <div
        className={cn(
          "flex flex-wrap items-center gap-1.5",
          large ? "min-h-[150px]" : "min-h-[34px]"
        )}
      >
        <AnimatePresence initial={false}>
          {section.blocks.map((b) =>
            b.type === "prompt" ? (
              <PromptChip
                key={b.id}
                block={b}
                sectionId={section.id}
                onDragStart={onDragStart}
                onEdit={onEditPrompt}
                selectMode={selectMode}
                selected={selected.includes(b.id)}
                onSelectClick={onSelectClick}
              />
            ) : (
              <CardChip
                key={b.id}
                block={b}
                sectionId={section.id}
                onDragStart={onDragStart}
                selectMode={selectMode}
                selected={selected.includes(b.id)}
                onSelectClick={onSelectClick}
              />
            )
          )}
        </AnimatePresence>
        <IconBtn
          title="添加提示词"
          className="h-5 w-5 shrink-0 self-start rounded-md hover:text-[var(--accent)]"
          onClick={() => setInputOpen((v) => !v)}
        >
          <Plus size={13} />
        </IconBtn>
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
        message={`确定删除分区「${section.name}」吗？其中的内容会移到「提示词工作台」。`}
        danger
        onConfirm={() => { deleteSection(section.id); setConfirmDel(false); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

export function Workspace() {
  const positive = useStore((s) => s.positive);
  const negative = useStore((s) => s.negative);
  const backNote = useStore((s) => s.backNote);
  const setBackNote = useStore((s) => s.setBackNote);
  const selectMode = useStore((s) => s.selectMode);
  const selected = useStore((s) => s.selected);
  const selectAnchor = useStore((s) => s.selectAnchor);
  const toggleSelectMode = useStore((s) => s.toggleSelectMode);
  const exitSelectMode = useStore((s) => s.exitSelectMode);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const rangeSelect = useStore((s) => s.rangeSelect);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const clearZone = useStore((s) => s.clearZone);
  const addSection = useStore((s) => s.addSection);
  const updatePrompt = useStore((s) => s.updatePrompt);
  const updatePromptMeta = useStore((s) => s.updatePromptMeta);
  const splitSectionPrompts = useStore((s) => s.splitSectionPrompts);
  const mergeSectionBlocks = useStore((s) => s.mergeSectionBlocks);
  const copyPositive = useStore((s) => s.copyPositive);
  const moveWorkbenchToRole = useStore((s) => s.moveWorkbenchToRole);
  const setNewCardContent = useStore((s) => s.setNewCardContent);
  const setNewCardCategory = useStore((s) => s.setNewCardCategory);
  const setShowNewCard = useStore((s) => s.setShowNewCard);
  const setComposeSectionId = useStore((s) => s.setComposeSectionId);
  const addToast = useStore((s) => s.addToast);
  const showCn = useStore((s) => s.settings?.show_chinese ?? true);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const sections = useMemo(() => [...positive, ...negative], [positive, negative]);
  const blocksCount = sections.reduce((n, x) => n + x.blocks.length, 0);
  const positiveCount = positive.reduce((n, x) => n + x.blocks.length, 0);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [hoverSectionId, setHoverSectionId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showAddSection, setShowAddSection] = useState(false);
  const [newSectionName, setNewSectionName] = useState("");
  const [backView, setBackView] = useState(false);
  const [editingPrompt, setEditingPrompt] = useState<{ sectionId: string; blockId: string } | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [cnDraft, setCnDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [dictSaving, setDictSaving] = useState(false);
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const pendingCtrlRef = useRef(false);

  const openPromptEdit = (block: PromptBlock, sectionId: string) => {
    setEditingPrompt({ sectionId, blockId: block.id });
    setPromptDraft(block.text);
    setCnDraft(block.cn ?? "");
    setNoteDraft(block.note ?? "");
  };

  const handleSplit = useCallback(
    (sectionId: string) => {
      const s = useStore.getState();
      const section = [...s.positive, ...s.negative].find((x) => x.id === sectionId);
      if (!section) return;
      const promptCount = section.blocks.filter((b) => b.type === "prompt").length;
      void splitSectionPrompts(sectionId);
      addToast(`已按系数语法分块并查词标注（原 ${promptCount} 个提示词块）`);
    },
    [splitSectionPrompts, addToast]
  );

  const handleMerge = useCallback(
    (sectionId: string) => {
      void mergeSectionBlocks(sectionId);
    },
    [mergeSectionBlocks]
  );

  const handleComposeCard = useCallback(async (sectionId: string) => {
    const s = useStore.getState();
    const section = [...s.positive, ...s.negative].find((x) => x.id === sectionId);
    if (!section || section.blocks.length === 0) {
      s.addToast("提示词工作台还没有内容，无法合成卡片", "err");
      return;
    }
    try {
      const raw = serializeSections([section]);
      const { text } = await api.expand(raw);
      const terms = splitWeightedPrompt(text);
      if (!terms.length) {
        s.addToast("未解析到有效提示词", "err");
        return;
      }
      setComposeSectionId(sectionId);
      setNewCardContent(normalizePromptTerms(terms));
      setNewCardCategory("");
      setShowNewCard(true);
    } catch (e) {
      s.addToast(`合成失败: ${(e as Error).message}`, "err");
    }
  }, [setNewCardContent, setNewCardCategory, setShowNewCard, setComposeSectionId]);

  const handleSelectClick = useCallback(
    (e: React.MouseEvent, block: Block) => {
      e.stopPropagation();
      if (e.shiftKey) {
        if (selectAnchor && selectAnchor !== block.id) rangeSelect(selectAnchor, block.id);
        else toggleSelect(block.id);
      } else {
        toggleSelect(block.id);
      }
    },
    [selectAnchor, rangeSelect, toggleSelect]
  );

  const onDragStart = (e: React.PointerEvent, block: Block) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const sectionId = (e.currentTarget.closest("[data-section-id]") as HTMLElement)?.dataset.sectionId;
    if (!sectionId) return;
    // 选择模式下：只有拖动“已选中的块”才整组移动；点选/取消完全交给 click 处理，
    // 避免 pointerdown 预选与 click 切换互相抵消（闪一下又取消）。
    const st = useStore.getState();
    const multi = st.selectMode && st.selected.includes(block.id);
    setDrag({ block, fromSectionId: sectionId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, multi });
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
        setDrag(null);
        setHoverSectionId(null);
        return;
      }
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      const sectionEl = el?.closest("[data-section-id]") as HTMLElement | null;
      const toSectionId = sectionEl?.dataset.sectionId ?? d.fromSectionId;
      const st = useStore.getState();
      if (d.multi) {
        st.moveSelectedBlocks(toSectionId);
      } else if (st.selectMode) {
        // 拖动未选中的块：先把它设为唯一选中，再移动它
        st.clearSelection();
        st.toggleSelect(d.block.id);
        useStore.getState().moveSelectedBlocks(toSectionId);
      } else {
        const blockEl = el?.closest("[data-block-id]") as HTMLElement | null;
        const sections = [...st.positive, ...st.negative];
        const toSection = sections.find((s) => s.id === toSectionId);
        let index: number | undefined;
        if (blockEl && toSection) {
          const targetId = blockEl.dataset.blockId;
          const targetIndex = toSection.blocks.findIndex((b) => b.id === targetId);
          if (targetIndex >= 0 && targetId !== d.block.id) index = targetIndex;
        }
        st.moveBlock(d.fromSectionId, d.block.id, toSectionId ?? d.fromSectionId, index);
      }
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

  // Ctrl 短按（未与其他键组合）切换选择模式；Esc 退出选择模式
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Control" && !e.repeat) pendingCtrlRef.current = true;
      else if (e.key !== "Control") pendingCtrlRef.current = false;
      if (e.key === "Escape") useStore.getState().exitSelectMode();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Control" && pendingCtrlRef.current) {
        pendingCtrlRef.current = false;
        useStore.getState().toggleSelectMode();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  const saveDictFromPopup = async () => {
    if (!editingPrompt || !promptDraft.trim() || !cnDraft.trim()) {
      addToast("需要同时填写提示词与中文翻译", "err");
      return;
    }
    setDictSaving(true);
    try {
      const r = await api.dictSave(promptDraft.trim(), cnDraft.trim());
      addToast(`已保存到词典（当前共 ${r.count} 条）`);
    } catch (e) {
      addToast(`保存到词典失败: ${(e as Error).message}`, "err");
    } finally {
      setDictSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--input)] p-0.5">
          {(
            [
              ["front", "正面"],
              ["back", "背面"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setBackView(key === "back")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] transition-all",
                (key === "back") === backView ? "text-white shadow" : "text-[var(--muted)] hover:text-[var(--text)]"
              )}
              style={(key === "back") === backView ? { background: "var(--accent)" } : undefined}
            >
              {label}
            </button>
          ))}
        </div>

        {!backView && (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <motion.button
              onClick={() => toggleSelectMode()}
              animate={selectMode ? { opacity: [1, 0.45, 1] } : { opacity: 1 }}
              transition={selectMode ? { duration: 1.1, repeat: Infinity } : undefined}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all active:scale-[.97]",
                selectMode
                  ? "border-[var(--accent)] bg-[var(--accent)]/15 text-[var(--accent)]"
                  : "border-[var(--border)] text-[var(--muted)] hover:text-[var(--text)]"
              )}
              title="进入选择模式：单击选中/取消，Shift+单击 头尾连选，拖动整组移动；Ctrl 短按也可切换"
            >
              <MousePointerClick size={13} /> {selectMode ? "选择中" : "选择"}
            </motion.button>
            <Button size="sm" variant="ghost" onClick={() => { setNewSectionName(""); setShowAddSection(true); }}>
              <FolderPlus size={14} /> 添加分区
            </Button>
            <Button size="sm" variant="ghost" onClick={() => undo()} disabled={!canUndo} title="撤销 Ctrl+Z">
              <Undo2 size={14} /> 撤销
            </Button>
            <Button size="sm" variant="ghost" onClick={() => redo()} disabled={!canRedo} title="重做 Ctrl+Y">
              <Redo2 size={14} /> 重做
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmClear(true)} disabled={blocksCount === 0}>
              <Trash2 size={14} /> 清空
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copyPositive()}
              disabled={positiveCount === 0}
              title="复制除负面分区外的所有提示词（展开卡片引用）"
            >
              <ClipboardCopy size={14} /> 复制正面
            </Button>
          </div>
        )}
      </div>

      {selectMode && !backView && (
        <div className="rounded-lg border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-1.5 text-xs text-[var(--accent)]">
          选择模式：单击 选中/取消 · Shift+单击 头尾连选 · 拖动 整组移动 · 点击空白处、Esc 或再次按「选择」退出
        </div>
      )}

      {backView ? (
        <div className="relative flex min-h-[420px] flex-1 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">背面留言</span>
            <span className="text-xs text-[var(--muted)]">自由文本区，不会影响提示词与生成</span>
          </div>
          <textarea
            value={backNote}
            onChange={(e) => setBackNote(e.target.value)}
            placeholder="你可以在这里随意粘贴~"
            className="scroll-thin min-h-0 w-full flex-1 resize-none rounded-2xl border border-[var(--border)] bg-[var(--input)]/50 p-3 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
          />
          <motion.button
            whileTap={{ scale: 1.35, rotate: 90 }}
            transition={{ type: "spring", stiffness: 400, damping: 12 }}
            className="absolute bottom-3 right-3 rounded-full border border-[var(--border)] bg-[var(--panel-solid)] px-3 py-1.5 text-xs text-[var(--muted)] shadow-lg hover:text-[var(--text)]"
            title="只是按钮"
          >
            按钮
          </motion.button>
        </div>
      ) : (
        <div
          onClick={(e) => {
            if (selectMode && e.target === e.currentTarget) exitSelectMode();
          }}
          className="scroll-thin min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1"
        >
          {sections.length === 0 ? (
            <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] text-[var(--muted)]">
              <span className="text-sm">当前区域还没有分区</span>
              <span className="text-xs">点击"添加分区"创建，或在下方卡片面板添加卡片</span>
            </div>
          ) : (
            sections.map((section, i) => (
              <SectionView
                key={section.id}
                section={section}
                drag={drag}
                hoverSectionId={hoverSectionId}
                onDragStart={onDragStart}
                onEditPrompt={openPromptEdit}
                onSelectClick={handleSelectClick}
                large={i === 0}
                isFirst={i === 0}
                onSplit={i === 0 ? () => handleSplit(section.id) : undefined}
                onMerge={() => handleMerge(section.id)}
                onComposeCard={i === 0 ? () => void handleComposeCard(section.id) : undefined}
                onMoveAll={i === 0 ? () => moveWorkbenchToRole() : undefined}
              />
            ))
          )}
        </div>
      )}

      {/* 底部快捷跳转：去生图 / 选择卡片（各占一半宽度） */}
      <div className="flex gap-2">
        <div className="flex-1">
          <FlipNavButton
            className="w-full"
            front="去生图"
            back="前往参数设置与生成区域"
            onClick={() =>
              document.getElementById("ai-settings")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
        </div>
        <div className="flex-1">
          <FlipNavButton
            className="w-full"
            front="选择卡片"
            back="选择已保存的卡片"
            onClick={() =>
              document.getElementById("prompt-cards")?.scrollIntoView({ behavior: "smooth", block: "start" })
            }
          />
        </div>
      </div>

      <AnimatePresence>
        {drag && (
          <motion.div
            className="pointer-events-none fixed z-50 flex items-center gap-1.5 rounded-lg border border-[var(--accent)] bg-[var(--panel-solid)] px-2.5 py-1.5 text-xs shadow-2xl"
            style={{ left: drag.x + 10, top: drag.y + 10 }}
            initial={{ scale: 0.9, opacity: 0.8 }}
            animate={{ scale: 1.05, opacity: 1 }}
          >
            {drag.multi ? (
              <span>{selected.length} 个块</span>
            ) : drag.block.type === "card" ? (
              <>
                <CategoryBadge name={drag.block.category} />
                <span className="text-[var(--muted)]">{drag.block.category}：</span>
                <span className="font-medium">{drag.block.name}</span>
              </>
            ) : (
              <>
                <span>{drag.block.text}</span>
                {drag.block.cn && showCn && <span className="text-[var(--accent)]">| {drag.block.cn}</span>}
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

      {/* 提示词块编辑弹窗：内容 + 中文翻译 + 备注 + 保存到词典 */}
      <Modal open={!!editingPrompt} onClose={() => setEditingPrompt(null)} title="编辑提示词">
        <label className="mb-1 block text-xs text-[var(--muted)]">提示词内容</label>
        <textarea
          autoFocus
          value={promptDraft}
          onChange={(e) => setPromptDraft(e.target.value)}
          rows={3}
          placeholder="输入完整提示词…支持 <分类:名称> 嵌套引用"
          className="scroll-thin w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
        />
        <div className="mt-3">
          <label className="mb-1 block text-xs text-[var(--muted)]">中文翻译 / 标注</label>
          <div className="flex gap-2">
            <input
              value={cnDraft}
              onChange={(e) => setCnDraft(e.target.value)}
              placeholder="例如：阳光"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
            />
            <Button size="sm" variant="ghost" disabled={dictSaving} onClick={() => void saveDictFromPopup()}>
              {dictSaving ? "保存中…" : "保存到词典"}
            </Button>
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            保存到词典后，以后分块遇到相同提示词会自动带上这条中文标注。
          </p>
        </div>
        <div className="mt-3">
          <label className="mb-1 block text-xs text-[var(--muted)]">备注（只存在这个块上）</label>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            rows={3}
            placeholder="可选，例如：这个姿势要强调腿部"
            className="scroll-thin w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setEditingPrompt(null)}>取消</Button>
          <Button
            onClick={() => {
              if (editingPrompt && promptDraft.trim()) {
                updatePrompt(editingPrompt.sectionId, editingPrompt.blockId, promptDraft);
                updatePromptMeta(editingPrompt.sectionId, editingPrompt.blockId, { cn: cnDraft, note: noteDraft });
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
        title="清空提示词工作区"
        message="确定清空整个提示词工作区（含负面Prompt）的所有提示词吗？可以用撤销恢复。"
        danger
        onConfirm={() => { clearZone(); setConfirmClear(false); }}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
