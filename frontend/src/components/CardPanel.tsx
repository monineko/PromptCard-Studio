import { AnimatePresence, motion } from "framer-motion";
import {
  CheckCircle2,
  Download,
  FileUp,
  FolderPlus,
  ImagePlus,
  Pencil,
  Pin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { cn, categoryHue, SYSTEM_SECTIONS } from "../lib";
import { useStore } from "../store";
import { useCardImagePicker } from "../store/cardImagePicker";
import type { CardMeta, Category } from "../types";
import { Button, CategoryBadge, ConfirmDialog, IconBtn, Modal } from "./UI";

const SYSTEM_ORDER = ["角色", "动作", "画师串", "负面"];
const PALETTE = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/** 卡片：上方 80% 演示图，下方 20% 两行文字（名称 + 预览），左上角类型角标。 */
function PokerCard({ category, card }: { category: string; card: CardMeta }) {
  const addCardBlock = useStore((s) => s.addCardBlock);
  const openDetail = useStore((s) => s.openDetail);
  const colorMap = useStore((s) => s.categoryColor);
  const positive = useStore((s) => s.positive);
  const negative = useStore((s) => s.negative);
  const hue = colorMap[category] ?? categoryHue(category);
  const added = useMemo(() => {
    const key = `${category}:${card.name}`;
    const has = (sections: { blocks: { type: string; category?: string; name?: string }[] }[]) =>
      sections.some((sec) =>
        sec.blocks.some((b) => b.type === "card" && `${b.category}:${b.name}` === key)
      );
    return has(positive) || has(negative);
  }, [positive, negative, category, card.name]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      whileHover={{ y: -6, scale: 1.03 }}
      onClick={() => openDetail(category, card.name)}
      className="card-shine group relative h-52 w-40 cursor-pointer overflow-hidden rounded-2xl border border-white/15 text-white shadow-lg transition-shadow hover:shadow-2xl"
      title={`${category}：${card.name} · 点击编辑`}
    >
      {/* 上方 80%：演示图片 */}
      <div
        className="absolute inset-x-0 top-0 h-[80%]"
        style={{ background: `linear-gradient(145deg, hsl(${hue} 45% 38%), hsl(${hue} 60% 24%))` }}
      >
        {card.image ? (
          <img
            src={api.libraryImageUrl(card.image)}
            alt={card.name}
            draggable={false}
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
            }}
            className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <ImagePlus size={24} className="text-white/45" />
          </div>
        )}
      </div>

      {/* 左上角类型角标：占宽 1/3、高 10% */}
      <div
        className="absolute left-0 top-0 z-20 flex h-[10%] w-1/3 items-center justify-center overflow-hidden rounded-br-xl"
        style={{
          background: `linear-gradient(120deg, hsl(${hue} 58% 42%), hsl(${hue} 70% 28%))`,
          boxShadow: "inset 0 -1px 0 rgba(255,255,255,0.18)",
        }}
      >
        <span className="w-full truncate px-1 text-center text-[9px] font-bold leading-none text-white/95 drop-shadow">
          {category}
        </span>
      </div>

      {/* 下方 20%：两行文字（名称 + 预览） */}
      <div
        className="absolute inset-x-0 bottom-0 flex h-[20%] flex-col items-center justify-center gap-0.5 px-1.5"
        style={{
          background: `linear-gradient(120deg, hsl(${hue} 58% 46%), hsl(${hue} 70% 26%))`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
      >
        <div className="w-full truncate text-center text-xs font-bold leading-tight drop-shadow">
          {card.name}
        </div>
        <div className="w-full truncate text-center text-[9px] leading-tight text-white/75">
          {card.preview}
        </div>
      </div>

      <IconBtn
        title="置顶（移到卡包首位作为封面）"
        className="absolute right-9 top-1.5 z-20 hidden h-7 w-7 rounded-lg bg-black/40 text-white/90 backdrop-blur transition-colors hover:bg-black/60 hover:text-white group-hover:inline-flex"
        onClick={async (e) => {
          e.stopPropagation();
          try {
            await api.pinCard(category, card.name);
            useStore.getState().refreshCategories();
          } catch (err) {
            useStore.getState().addToast(`置顶操作失败: ${(err as Error).message}`, "err");
          }
        }}
      >
        <Pin size={13} />
      </IconBtn>
      <IconBtn
        title="添加到当前区域"
        className="absolute right-1.5 top-1.5 z-20 hidden h-7 w-7 rounded-lg bg-white/20 text-white backdrop-blur hover:bg-white/35 hover:text-white group-hover:inline-flex"
        onClick={(e) => {
          e.stopPropagation();
          addCardBlock(category, card.name);
        }}
      >
        <Plus size={14} />
      </IconBtn>
      <AnimatePresence>
        {added && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-10 rounded-2xl"
            style={{
              background:
                "linear-gradient(to top, rgba(112,112,118,.9), rgba(112,112,118,.38) 55%, rgba(112,112,118,0) 78%)",
            }}
          >
            <div className="absolute inset-x-0 bottom-3 flex items-center justify-center gap-1.5">
              <CheckCircle2 size={16} className="text-emerald-400" />
              <span className="text-xs font-semibold text-emerald-300 drop-shadow">已添加</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/** 卡堆单层：按内部卡片外观渲染（左上类型角标 + 图 + 下方两行信息），无演示图时为分类色卡片。 */
function MiniStackCard({
  card,
  category,
  hue,
}: {
  card?: CardMeta;
  category: string;
  hue: number;
}) {
  const url = card?.image ? api.libraryImageUrl(card.image) : undefined;
  return (
    <div
      className="relative h-full w-full overflow-hidden rounded-xl border border-white/20 text-white"
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 45% 38%), hsl(${hue} 60% 24%))`,
      }}
    >
      {url && (
        <img
          src={url}
          alt=""
          draggable={false}
          loading="lazy"
          className="absolute inset-x-0 top-0 h-[80%] w-full object-cover"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      )}
      <div
        className="absolute left-0 top-0 z-10 flex h-[10%] w-1/3 items-center justify-center overflow-hidden rounded-br-lg"
        style={{ background: `linear-gradient(120deg, hsl(${hue} 58% 42%), hsl(${hue} 70% 28%))` }}
      >
        <span className="w-full truncate px-0.5 text-center text-[7px] font-bold leading-none text-white/95">
          {category}
        </span>
      </div>
      <div
        className="absolute inset-x-0 bottom-0 flex h-[20%] flex-col items-center justify-center gap-px px-1"
        style={{
          background: `linear-gradient(120deg, hsl(${hue} 58% 46%), hsl(${hue} 70% 26%))`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.18)",
        }}
      >
        <div className="w-full truncate text-center text-[9px] font-bold leading-tight drop-shadow">
          {card?.name ?? category}
        </div>
        <div className="w-full truncate text-center text-[7px] leading-tight text-white/70">
          {card?.preview || "点击打开"}
        </div>
      </div>
    </div>
  );
}

/** 分类卡堆：复用图库相册堆效果（底层两张散落 + 封面），封面为第一张卡片。 */
function CategoryStack({
  category,
  index,
  onOpen,
}: {
  category: Category;
  index: number;
  onOpen: () => void;
}) {
  const colorMap = useStore((s) => s.categoryColor);
  const hue = colorMap[category.name] ?? categoryHue(category.name);
  const coverCards = category.cards.slice(0, 3);
  return (
    <button
      onClick={onOpen}
      className="album-card group flex animate-fade-in-up flex-col items-center text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent"
      style={{ animationDelay: `${90 + index * 70}ms` }}
    >
      <div className="relative aspect-[3/4] w-[68%]">
        <div className="absolute inset-0 translate-x-3 translate-y-2 rotate-[6deg] overflow-hidden rounded-xl border-4 border-white shadow-lg transition-all duration-500 ease-out group-hover:translate-x-5 group-hover:rotate-[9deg] group-hover:brightness-110">
          <MiniStackCard card={coverCards[2]} category={category.name} hue={hue} />
        </div>
        <div className="absolute inset-0 -translate-x-2.5 -translate-y-1 rotate-[-5deg] overflow-hidden rounded-xl border-4 border-white shadow-lg transition-all duration-500 ease-out group-hover:-translate-x-5 group-hover:rotate-[-8deg] group-hover:brightness-110">
          <MiniStackCard card={coverCards[1]} category={category.name} hue={hue} />
        </div>
        <div className="relative z-10 h-full w-full overflow-hidden rounded-2xl border-4 border-white shadow-[0_16px_36px_-12px_rgba(0,0,0,0.5)] transition-all duration-500 ease-out group-hover:-translate-y-2 group-hover:scale-[1.025] group-hover:shadow-[0_26px_52px_-14px_rgba(0,0,0,0.6)]">
          <MiniStackCard card={coverCards[0]} category={category.name} hue={hue} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/10 to-transparent" />
          <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition-colors duration-300 group-hover:bg-black/55">
            {category.count} 张卡片
          </span>
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-medium tracking-wide text-white opacity-0 backdrop-blur-[4px] transition-all duration-300 group-hover:opacity-100">
            点击查看 →
          </span>
        </div>
      </div>

      <div className="mt-3.5 w-full px-1">
        <h3 className="flex items-center justify-center gap-1.5 text-base font-bold">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: `hsl(${hue} 70% 55%)`, boxShadow: `0 0 8px hsl(${hue} 70% 55% / .6)` }}
          />
          <span className="truncate text-[var(--text)] transition-colors duration-300 group-hover:text-[var(--accent)]">
            {category.name}
          </span>
        </h3>
        <p className="mt-1.5 truncate text-xs text-[var(--muted)]">{category.count} 张卡片 · 点击打开卡包</p>
      </div>
    </button>
  );
}

/** 卡包弹窗：磨砂玻璃，一行 5 张卡，弹窗内滚轮翻页，底部保留新建/编辑/删除。 */
function PackModal({
  category,
  onClose,
}: {
  category: Category;
  onClose: () => void;
}) {
  const setNewCardCategory = useStore((s) => s.setNewCardCategory);
  const setShowNewCard = useStore((s) => s.setShowNewCard);
  const deleteCategory = useStore((s) => s.deleteCategory);
  const colorMap = useStore((s) => s.categoryColor);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const hue = colorMap[category.name] ?? categoryHue(category.name);
  const systemCategory = SYSTEM_SECTIONS.includes(category.name as (typeof SYSTEM_SECTIONS)[number]);

  return (
    <Modal
      open
      onClose={onClose}
      maxW="max-w-5xl"
      title={
        <span className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: `hsl(${hue} 70% 55%)`, boxShadow: `0 0 8px hsl(${hue} 70% 55% / .6)` }}
          />
          <span>{category.name}</span>
          <span className="text-xs font-normal text-[var(--muted)]">{category.count} 张卡片</span>
        </span>
      }
    >
      <div className="scroll-thin grid max-h-[58vh] grid-cols-5 gap-3 overflow-y-auto pr-1">
        {category.cards.length === 0 ? (
          <div className="col-span-5 flex flex-col items-center gap-2 py-12 text-[var(--muted)]">
            <span className="text-sm">这个分类还没有卡片</span>
            <span className="text-xs">点击下方「新建卡片」创建第一张</span>
          </div>
        ) : (
          category.cards.map((card) => (
            <div key={card.name} className="flex justify-center">
              <PokerCard category={category.name} card={card} />
            </div>
          ))
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <Button
          variant="danger"
          size="sm"
          disabled={systemCategory}
          onClick={() => setConfirmDel(true)}
          title={systemCategory ? "系统默认分类不可删除" : "删除该类别"}
        >
          <Trash2 size={13} /> 删除该类别
        </Button>
        <span className="ml-auto" />
        <Button
          className="!px-6 !py-2.5 text-sm"
          onClick={() => {
            setNewCardCategory(category.name);
            setShowNewCard(true);
          }}
        >
          <Plus size={15} /> 新建卡片
        </Button>
        <Button variant="ghost" className="!px-6 !py-2.5 text-sm" onClick={() => setEditOpen(true)}>
          <Pencil size={15} /> 编辑类别
        </Button>
      </div>

      <CategoryEditModal category={category} open={editOpen} onClose={() => setEditOpen(false)} />
      <ConfirmDialog
        open={confirmDel}
        title="删除分类"
        message={`确定删除分类「${category.name}」及其中的 ${category.count} 张卡片吗？会进入回收站。`}
        danger
        onConfirm={() => {
          deleteCategory(category.name);
          setConfirmDel(false);
          onClose();
        }}
        onCancel={() => setConfirmDel(false)}
      />
    </Modal>
  );
}

function CategoryEditModal({
  category,
  open,
  onClose,
}: {
  category: Category;
  open: boolean;
  onClose: () => void;
}) {
  const renameCategory = useStore((s) => s.renameCategory);
  const saveCategoryColor = useStore((s) => s.saveCategoryColor);
  const colorMap = useStore((s) => s.categoryColor);
  const [newName, setNewName] = useState(category.name);
  const [newHue, setNewHue] = useState(colorMap[category.name] ?? categoryHue(category.name));
  const systemCategory = SYSTEM_SECTIONS.includes(category.name as (typeof SYSTEM_SECTIONS)[number]);

  useEffect(() => {
    if (open) {
      setNewName(category.name);
      setNewHue(colorMap[category.name] ?? categoryHue(category.name));
    }
  }, [open, category.name, colorMap]);

  return (
    <Modal open={open} onClose={onClose} title={`编辑类别「${category.name}」`}>
      <label className="mb-1 block text-xs text-[var(--muted)]">名称</label>
      <input
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        disabled={systemCategory}
        className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
      />
      {systemCategory && (
        <p className="-mt-2 mb-3 text-[10px] text-[var(--muted)]">系统默认分类，名称不可修改（仅可调整颜色）</p>
      )}
      <label className="mb-1 block text-xs text-[var(--muted)]">颜色</label>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {PALETTE.map((h) => (
          <button
            key={h}
            onClick={() => setNewHue(h)}
            className="h-7 w-7 rounded-lg transition-transform hover:scale-110"
            style={{
              background: `hsl(${h} 65% 48%)`,
              outline: newHue === h ? `2px solid var(--text)` : "none",
              outlineOffset: 2,
            }}
          />
        ))}
        <input
          type="range"
          min={0}
          max={359}
          value={newHue}
          onChange={(e) => setNewHue(Number(e.target.value))}
          className="ml-1 w-28 accent-[var(--accent)]"
          title="微调色相"
        />
        <span
          className="ml-1 h-6 w-6 rounded-lg"
          style={{ background: `hsl(${newHue} 65% 48%)`, boxShadow: "0 0 8px hsl(0 0% 0% / .3)" }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>取消</Button>
        <Button
          onClick={async () => {
            const target = newName.trim() || category.name;
            const nameChanged = target !== category.name && !systemCategory;
            if (nameChanged) {
              const ok = await renameCategory(category.name, target);
              if (!ok) return;
            }
            if (newHue !== (colorMap[category.name] ?? categoryHue(category.name))) {
              await saveCategoryColor(target, newHue);
            }
            onClose();
          }}
        >
          保存
        </Button>
      </div>
    </Modal>
  );
}

export function CardPanel() {
  const categories = useStore((s) => s.categories);
  const search = useStore((s) => s.search);
  const setSearch = useStore((s) => s.setSearch);
  const setShowNewCard = useStore((s) => s.setShowNewCard);
  const setNewCardCategory = useStore((s) => s.setNewCardCategory);
  const setShowNewCategory = useStore((s) => s.setShowNewCategory);
  const setShowImport = useStore((s) => s.setShowImport);
  const [openCatName, setOpenCatName] = useState<string | null>(null);

  const ordered = useMemo(() => {
    const system = SYSTEM_ORDER.map((n) => categories.find((c) => c.name === n)).filter(Boolean) as Category[];
    const rest = categories.filter((c) => !SYSTEM_ORDER.includes(c.name));
    const all = [...system, ...rest];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all
      .map((c) => ({
        ...c,
        cards: c.cards.filter(
          (card) => card.name.toLowerCase().includes(q) || card.preview.toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.name.toLowerCase().includes(q) || c.cards.length > 0);
  }, [categories, search]);

  const openCategory = openCatName ? categories.find((c) => c.name === openCatName) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索卡片名称或内容…"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] py-1.5 pl-8 pr-3 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setNewCardCategory(""); setShowNewCard(true); }}
        >
          <Plus size={14} /> 新建卡片
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowNewCategory(true)}>
          <FolderPlus size={14} /> 新建分类
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setShowImport(true)}>
          <FileUp size={14} /> 导入
        </Button>
        <Button size="sm" variant="ghost" onClick={() => download(api.exportUrl(), "cards.zip")}>
          <Download size={14} /> 导出
        </Button>
      </div>

      {ordered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] py-10 text-[var(--muted)]">
          <span className="text-sm">没有找到卡片</span>
          <span className="text-xs">点击"新建卡片"开始，或通过导入添加</span>
        </div>
      ) : (
        <div className="scroll-thin grid max-h-[720px] grid-cols-4 gap-x-3 gap-y-4 overflow-y-auto pr-1">
          {ordered.map((c, i) => (
            <CategoryStack key={c.name} category={c} index={i} onOpen={() => setOpenCatName(c.name)} />
          ))}
        </div>
      )}

      {openCategory && <PackModal category={openCategory} onClose={() => setOpenCatName(null)} />}

      <CardDetailModal />
      <NewCardModal />
      <NewCategoryModal />
      <ImportModal />
    </div>
  );
}

function CardDetailModal() {
  const detail = useStore((s) => s.detail);
  const close = useStore((s) => s.closeDetail);
  const saveCardDetail = useStore((s) => s.saveCardDetail);
  const deleteCard = useStore((s) => s.deleteCard);
  const addCardBlock = useStore((s) => s.addCardBlock);
  const categories = useStore((s) => s.categories);
  const [category, setCategory] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const startPick = useCardImagePicker((s) => s.startPick);
  const navigate = useNavigate();

  const cardImage = detail
    ? categories.find((c) => c.name === detail.category)?.cards.find((c) => c.name === detail.name)?.image ?? null
    : null;

  useEffect(() => {
    if (!detail) return;
    setLoading(true);
    setCategory(detail.category);
    setName(detail.name);
    api
      .cardContent(detail.category, detail.name)
      .then((c) => setContent(c.content))
      .catch(() => setContent(""))
      .finally(() => setLoading(false));
  }, [detail]);

  if (!detail) return null;

  return (
    <Modal
      open={!!detail}
      onClose={close}
      wide
      title={
        <span className="flex items-center gap-2">
          <CategoryBadge name={category} />
          <span>{category}：{name}</span>
        </span>
      }
    >
      {loading ? (
        <p className="py-6 text-center text-sm text-[var(--muted)]">加载中…</p>
      ) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">分类</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
              >
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-[var(--muted)]">名称</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>

          <label className="mb-1 block text-xs text-[var(--muted)]">提示词内容</label>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={8}
            placeholder="输入完整提示词…支持 <分类:名称> 嵌套引用"
            className="scroll-thin w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
          />

          {cardImage ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--input)]/40 p-2">
              <img
                src={api.libraryImageUrl(cardImage)}
                alt=""
                className="h-16 w-16 shrink-0 rounded-lg object-cover"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-medium">当前演示图片</div>
                <div className="truncate text-[11px] text-[var(--muted)]" title={cardImage}>
                  {cardImage}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigate("/library");
                  startPick(detail.category, detail.name);
                }}
              >
                更换
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await api.removeCardImage(detail.category, detail.name);
                    useStore.getState().refreshCategories();
                    useStore.getState().addToast(`已移除 <${detail.category}:${detail.name}> 的演示图片`);
                  } catch (e) {
                    useStore.getState().addToast(`移除失败: ${(e as Error).message}`, "err");
                  }
                }}
              >
                移除
              </Button>
            </div>
          ) : (
            <button
              onClick={() => {
                navigate("/library");
                startPick(detail.category, detail.name);
              }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] py-4 text-xs text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              <ImagePlus size={16} />
              添加演示图片（从图库选择）
            </button>
          )}

          <div className="mt-4 flex items-center gap-2">
            <Button variant="danger" size="sm" onClick={() => setConfirmDel(true)}>
              <Trash2 size={13} /> 删除
            </Button>
            <span className="ml-auto" />
            <Button variant="ghost" onClick={close}>取消</Button>
            <Button
              onClick={() => {
                addCardBlock(category || detail.category, name || detail.name);
                close();
              }}
            >
              <Plus size={14} /> 添加
            </Button>
            <Button
              onClick={async () => {
                const ok = await saveCardDetail(
                  content,
                  category !== detail.category ? category : undefined,
                  name !== detail.name ? name : undefined
                );
                if (ok) close();
              }}
            >
              保存
            </Button>
          </div>
        </>
      )}
      <ConfirmDialog
        open={confirmDel}
        title="删除卡片"
        message={`确定删除 <${category}:${name}> 吗？会进入回收站。`}
        danger
        onConfirm={async () => {
          await deleteCard(detail.category, detail.name);
          setConfirmDel(false);
          close();
        }}
        onCancel={() => setConfirmDel(false)}
      />
    </Modal>
  );
}

function NewCardModal() {
  const open = useStore((s) => s.showNewCard);
  const setOpen = useStore((s) => s.setShowNewCard);
  const initialCategory = useStore((s) => s.newCardCategory);
  const newCardContent = useStore((s) => s.newCardContent);
  const setNewCardContent = useStore((s) => s.setNewCardContent);
  const createCard = useStore((s) => s.createCard);
  const categories = useStore((s) => s.categories);
  const [category, setCategory] = useState("");
  const [newCat, setNewCat] = useState(false);
  const [catName, setCatName] = useState("");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (open) {
      setCategory(initialCategory || "");
      setNewCat(false);
      setCatName("");
      setName("");
      setContent(newCardContent || "");
    }
  }, [open, initialCategory, newCardContent]);

  const close = () => {
    setOpen(false);
    setNewCardContent("");
    useStore.getState().setComposeSectionId(null);
  };

  return (
    <Modal open={open} onClose={close} title="新建卡片" wide>
      <div className="mb-3 grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">分类</label>
          {newCat ? (
            <input
              autoFocus
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              placeholder="新分类名称"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
            />
          ) : (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
            >
              <option value="">选择分类…</option>
              {categories.map((c) => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          )}
          <label className="mt-1.5 flex cursor-pointer items-center gap-1 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={newCat}
              onChange={(e) => setNewCat(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            新建分类
          </label>
        </div>
        <div>
          <label className="mb-1 block text-xs text-[var(--muted)]">名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="卡片名称"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>
      <label className="mb-1 block text-xs text-[var(--muted)]">提示词内容</label>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={7}
        placeholder="完整提示词…支持 <分类:名称> 嵌套引用"
        className="scroll-thin w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm leading-relaxed outline-none focus:border-[var(--accent)]"
      />
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={close}>取消</Button>
        <Button
          onClick={async () => {
            const finalCat = newCat ? catName.trim() : category;
            const finalName = name.trim();
            if (!finalCat || !finalName) {
              useStore.getState().addToast("分类与名称不能为空", "err");
              return;
            }
            if (await createCard(finalCat, finalName, content)) {
              const st = useStore.getState();
              if (st.composeSectionId) {
                st.replaceSectionWithCard(st.composeSectionId, finalCat, finalName);
                st.setComposeSectionId(null);
                st.addToast("已用新卡片替换提示词工作台内容");
              }
              close();
            }
          }}
        >
          保存
        </Button>
      </div>
    </Modal>
  );
}

function NewCategoryModal() {
  const open = useStore((s) => s.showNewCategory);
  const setOpen = useStore((s) => s.setShowNewCategory);
  const createCategory = useStore((s) => s.createCategory);
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="新建分类">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="分类名称，如：角色 / 动作 / 质量"
        className="mb-4 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        onKeyDown={(e) => e.key === "Enter" && name.trim() && createCategory(name.trim()).then((ok) => ok && setOpen(false))}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
        <Button
          onClick={async () => {
            if (await createCategory(name.trim())) setOpen(false);
          }}
        >
          创建
        </Button>
      </div>
    </Modal>
  );
}

function ImportModal() {
  const open = useStore((s) => s.showImport);
  const setOpen = useStore((s) => s.setShowImport);
  const refresh = useStore((s) => s.refreshCategories);
  const addToast = useStore((s) => s.addToast);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const doImport = async () => {
    if (!file) {
      addToast("请先选择模板文件", "err");
      return;
    }
    setBusy(true);
    try {
      const result = await api.importFile(file);
      await refresh();
      const created = result.created_categories?.length
        ? `，新建分类：${result.created_categories.join("、")}`
        : "";
      addToast(
        `导入完成：新增 ${result.imported}，跳过 ${result.skipped}${result.renamed ? `，重名加后缀 ${result.renamed} 个` : ""}${result.errors?.length ? `，错误 ${result.errors.length}` : ""}${created}`
      );
      setFile(null);
    } catch (e) {
      addToast(`导入失败: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) setFile(null);
  }, [open]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="导入卡片">
      <div className="space-y-3">
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          使用内置的「卡片导入模板.xlsx」，填写不存在的分类会自动创建；图片列支持单元格内嵌图片或本地图片路径，导入后图片会复制进图库。
        </p>
        <p className="text-xs font-medium" style={{ color: "#ffb6c1" }}>
          模板内有同名 card 会创建新 card 并添加后缀（1）
        </p>
        <div className="flex gap-2">
          <input
            type="file"
            accept=".xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-[var(--muted)] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--hover)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text)]"
          />
          <a
            href={api.importTemplateUrl()}
            download
            className="shrink-0 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] transition-colors hover:text-[var(--text)]"
          >
            下载模板
          </a>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>关闭</Button>
        <Button onClick={() => void doImport()} disabled={busy}>
          {busy ? "导入中…" : "导入"}
        </Button>
      </div>
    </Modal>
  );
}
