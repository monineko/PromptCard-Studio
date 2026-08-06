import { AnimatePresence, motion, Reorder, useDragControls } from "framer-motion";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileUp,
  FolderPlus,
  GripVertical,
  ImagePlus,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { cn, categoryHue } from "../lib";
import { useStore } from "../store";
import type { CardMeta, Category } from "../types";
import { Button, CategoryBadge, ConfirmDialog, IconBtn, Modal } from "./UI";

function download(url: string, name: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function downloadCsvTemplate() {
  const content =
    "\uFEFF分类,名称,内容\n角色,示例角色,1girl, long_hair, blue_eyes\n动作,示例动作,standing, looking_at_viewer\n质量,示例质量,masterpiece, best quality\n";
  download(URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" })), "卡片导入模板.csv");
}

function PokerCard({ category, card }: { category: string; card: CardMeta }) {
  const addCardBlock = useStore((s) => s.addCardBlock);
  const openDetail = useStore((s) => s.openDetail);
  const colorMap = useStore((s) => s.categoryColor);
  const hue = colorMap[category] ?? categoryHue(category);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      whileHover={{ y: -6, scale: 1.03 }}
      onClick={() => openDetail(category, card.name)}
      className="group relative h-52 w-40 cursor-pointer overflow-hidden rounded-2xl border border-white/15 text-white shadow-lg transition-shadow hover:shadow-2xl"
      style={{
        background: `linear-gradient(145deg, hsl(${hue} 45% 38%), hsl(${hue} 60% 24%))`,
      }}
      title={`${category}：${card.name} · 点击编辑`}
    >
      <div className="absolute inset-0 opacity-20" style={{ background: "radial-gradient(circle at 30% 20%, rgba(255,255,255,.7), transparent 55%)" }} />
      <div className="absolute left-2.5 top-2.5">
        <div className="text-lg font-bold leading-none">{card.name}</div>
        <div className="mt-1 text-[10px] uppercase tracking-wide opacity-70">{category}</div>
      </div>
      <IconBtn
        title="添加到当前区域"
        className="absolute right-2 top-2 hidden h-7 w-7 rounded-lg bg-white/20 text-white backdrop-blur hover:bg-white/35 hover:text-white group-hover:inline-flex"
        onClick={(e) => {
          e.stopPropagation();
          addCardBlock(category, card.name);
        }}
      >
        <Plus size={14} />
      </IconBtn>
      <p className="scroll-thin absolute inset-x-3 bottom-3 top-16 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-white/85">
        {card.preview}
      </p>
      <div className="absolute bottom-2 right-2.5 h-1.5 w-1.5 rounded-full bg-white/80" />
    </motion.div>
  );
}

function CategoryPack({ category }: { category: Category }) {
  const expanded = useStore((s) => !!s.expanded[category.name]);
  const toggle = useStore((s) => s.toggleExpanded);
  const setNewCardCategory = useStore((s) => s.setNewCardCategory);
  const setShowNewCard = useStore((s) => s.setShowNewCard);
  const renameCategory = useStore((s) => s.renameCategory);
  const deleteCategory = useStore((s) => s.deleteCategory);
  const saveCategoryColor = useStore((s) => s.saveCategoryColor);
  const colorMap = useStore((s) => s.categoryColor);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(category.name);
  const [newHue, setNewHue] = useState(colorMap[category.name] ?? categoryHue(category.name));
  const [confirmDel, setConfirmDel] = useState(false);
  const hue = colorMap[category.name] ?? categoryHue(category.name);
  const PALETTE = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--input)]/40">
      <div
        className="flex cursor-pointer items-center gap-3 px-4 py-3.5 transition-colors hover:bg-[var(--hover)]"
        onClick={() => toggle(category.name)}
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow"
          style={{ background: `hsl(${hue} 60% 42%)` }}
        >
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{category.name}</div>
          <div className="text-xs text-[var(--muted)]">{category.count} 张卡片</div>
        </div>
        <span
          className="mr-1 rounded-full px-2 py-0.5 text-[10px]"
          style={{ background: `hsl(${hue} 60% 42% / .15)`, color: `hsl(${hue} 70% 60%)` }}
        >
          {category.name}
        </span>
        <IconBtn
          title="在此分类新建卡片"
          onClick={(e) => {
            e.stopPropagation();
            setNewCardCategory(category.name);
            setShowNewCard(true);
          }}
        >
          <Plus size={15} />
        </IconBtn>
        <IconBtn
          title="编辑类别"
          onClick={(e) => {
            e.stopPropagation();
            setNewName(category.name);
            setNewHue(colorMap[category.name] ?? categoryHue(category.name));
            setRenaming(true);
          }}
        >
          <Pencil size={13} />
        </IconBtn>
        <IconBtn
          danger
          title="删除分类"
          onClick={(e) => {
            e.stopPropagation();
            setConfirmDel(true);
          }}
        >
          <Trash2 size={13} />
        </IconBtn>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex flex-wrap gap-3 px-4 pb-4 pt-1">
              {category.cards.length === 0 ? (
                <span className="py-4 text-xs text-[var(--muted)]">分类为空，点击右上角 + 新建卡片</span>
              ) : (
                category.cards.map((card) => (
                  <PokerCard key={card.name} category={category.name} card={card} />
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={renaming} onClose={() => setRenaming(false)} title={`编辑类别「${category.name}」`}>
        <label className="mb-1 block text-xs text-[var(--muted)]">名称</label>
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="mb-3 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
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
          <Button variant="ghost" onClick={() => setRenaming(false)}>取消</Button>
          <Button
            onClick={async () => {
              const target = newName.trim() || category.name;
              const nameChanged = target !== category.name;
              if (nameChanged) {
                const ok = await renameCategory(category.name, target);
                if (!ok) return;
              }
              if (newHue !== (colorMap[category.name] ?? categoryHue(category.name))) {
                await saveCategoryColor(target, newHue);
              }
              setRenaming(false);
            }}
          >
            保存
          </Button>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDel}
        title="删除分类"
        message={`确定删除分类「${category.name}」及其中的 ${category.count} 张卡片吗？会进入回收站。`}
        danger
        onConfirm={() => { deleteCategory(category.name); setConfirmDel(false); }}
        onCancel={() => setConfirmDel(false)}
      />
    </div>
  );
}

function CategoryPackItem({ category }: { category: Category }) {
  const controls = useDragControls();
  return (
    <Reorder.Item value={category.name} dragListener={false} dragControls={controls} layout>
      <div className="flex">
        <div
          className="mr-0 flex cursor-grab touch-none items-center rounded-l-2xl border border-r-0 border-[var(--border)] bg-[var(--input)]/40 px-1.5 text-[var(--muted)] transition-colors hover:text-[var(--text)] active:cursor-grabbing"
          title="拖动排序分类"
          onPointerDown={(e) => controls.start(e)}
        >
          <GripVertical size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <CategoryPack category={category} />
        </div>
      </div>
    </Reorder.Item>
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
  const reorderCategories = useStore((s) => s.reorderCategories);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({
        ...c,
        cards: c.cards.filter(
          (card) => card.name.toLowerCase().includes(q) || card.preview.toLowerCase().includes(q)
        ),
      }))
      .filter((c) => c.name.toLowerCase().includes(q) || c.cards.length > 0);
  }, [categories, search]);

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

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-[var(--border)] py-10 text-[var(--muted)]">
          <span className="text-sm">没有找到卡片</span>
          <span className="text-xs">点击"新建卡片"开始，或通过导入添加</span>
        </div>
      ) : (
        <Reorder.Group
          axis="y"
          values={filtered.map((c) => c.name)}
          onReorder={reorderCategories}
          className="flex flex-col gap-3"
        >
          {filtered.map((c) => (
            <CategoryPackItem key={c.name} category={c} />
          ))}
        </Reorder.Group>
      )}

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

          <button
            onClick={() => {}}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] py-4 text-xs text-[var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
          >
            <ImagePlus size={16} />
            演示图片（预留，后续版本支持）
          </button>

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
      setContent("");
    }
  }, [open, initialCategory]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="新建卡片" wide>
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
        <Button variant="ghost" onClick={() => setOpen(false)}>取消</Button>
        <Button
          onClick={async () => {
            const finalCat = newCat ? catName.trim() : category;
            if (!finalCat || !name.trim()) {
              useStore.getState().addToast("分类与名称不能为空", "err");
              return;
            }
            if (await createCard(finalCat, name.trim(), content)) setOpen(false);
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
  const [tab, setTab] = useState<"csv" | "json" | "anr">("csv");
  const [file, setFile] = useState<File | null>(null);
  const [anrPath, setAnrPath] = useState("");
  const [busy, setBusy] = useState(false);

  const doImport = async () => {
    if (!file) {
      addToast("请先选择文件", "err");
      return;
    }
    setBusy(true);
    try {
      const result = await api.importFile(tab, file);
      await refresh();
      addToast(`导入完成：新增 ${result.imported}，跳过 ${result.skipped}${result.errors?.length ? `，错误 ${result.errors.length}` : ""}`);
      setFile(null);
    } catch (e) {
      addToast(`导入失败: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  const doAnr = async () => {
    if (!anrPath.trim()) {
      addToast("请填写 ANR wildcards 目录路径", "err");
      return;
    }
    setBusy(true);
    try {
      const result = await api.importAnr(anrPath.trim());
      await refresh();
      addToast(`导入完成：新增 ${result.imported}，跳过 ${result.skipped}`);
    } catch (e) {
      addToast(`导入失败: ${(e as Error).message}`, "err");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) {
      setTab("csv");
      setFile(null);
      setAnrPath("");
    }
  }, [open]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="导入卡片">
      <div className="mb-3 flex gap-1 rounded-xl border border-[var(--border)] bg-[var(--input)] p-1">
        {(
          [
            ["csv", "CSV"],
            ["json", "JSON"],
            ["anr", "ANR 目录"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-sm transition-all",
              tab === key ? "text-white" : "text-[var(--muted)]"
            )}
            style={tab === key ? { background: "var(--accent)" } : undefined}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "csv" && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            模板格式：三列 <code className="rounded bg-[var(--input)] px-1">分类,名称,内容</code>
            ，第一行是表头。可以先下载模板填写。
          </p>
          <div className="flex gap-2">
            <input
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="w-full text-xs text-[var(--muted)] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--hover)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text)]"
            />
            <Button size="sm" variant="ghost" onClick={downloadCsvTemplate}>下载模板</Button>
          </div>
        </div>
      )}
      {tab === "json" && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            支持 JSON 数组 <code>{"[{\"category\",\"name\",\"content\"}]"}</code> 或对象{" "}
            <code>{"{\"分类\": {\"名称\": \"内容\"}}"}</code>
          </p>
          <input
            type="file"
            accept=".json"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-[var(--muted)] file:mr-2 file:rounded-lg file:border-0 file:bg-[var(--hover)] file:px-3 file:py-1.5 file:text-xs file:text-[var(--text)]"
          />
        </div>
      )}
      {tab === "anr" && (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed text-[var(--muted)]">
            填入你现有 ANR 的 wildcards 目录绝对路径（文件夹=分类，txt=卡片），自动迁移，重名卡片会跳过。
          </p>
          <input
            value={anrPath}
            onChange={(e) => setAnrPath(e.target.value)}
            placeholder="例如 E:\NAI\ANR\Auto-NovelAI-Refactor-main\wildcards"
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
          />
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setOpen(false)}>关闭</Button>
        <Button onClick={tab === "anr" ? doAnr : doImport} disabled={busy}>
          {busy ? "导入中…" : "导入"}
        </Button>
      </div>
    </Modal>
  );
}
