import {
  ArrowLeft,
  Crown,
  FileJson,
  FolderOpen,
  FolderPlus,
  Heart,
  Images,
  LayoutGrid,
  Loader2,
  Plus,
  ThumbsUp,
  Undo2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { api } from "../api";
import { GalleryMasonry } from "../components/gallery/GalleryMasonry";
import { PngInfoPopup } from "../components/gallery/PngInfoPopup";
import { ReviewMode } from "../components/gallery/ReviewMode";
import { ZoomableImage } from "../components/gallery/ZoomableImage";
import { useSidebarStore } from "../sidebarStore";
import { useStore } from "../store";
import type {
  LibraryCategoryKey,
  LibraryImageItem,
  LibrarySummary,
  PngInfoResult,
  ReviewApplyResult,
} from "../types";

const CATEGORY_META: Record<
  LibraryCategoryKey,
  { icon: typeof LayoutGrid; color: string; desc: string }
> = {
  all: { icon: LayoutGrid, color: "var(--accent)", desc: "图库内全部图片" },
  treasure: { icon: Crown, color: "#f59e0b", desc: "最满意的作品" },
  fine: { icon: ThumbsUp, color: "#34d399", desc: "可用的好图" },
  reject: { icon: XCircle, color: "#f87171", desc: "淘汰进回收站" },
  favorites: { icon: Heart, color: "#ec4899", desc: "Like 收藏夹" },
  unrated: { icon: Images, color: "#94a3b8", desc: "根目录下未分类的图片" },
};

const CATEGORY_ORDER: LibraryCategoryKey[] = ["all", "treasure", "fine", "reject", "favorites", "unrated"];
const CATEGORY_LABEL: Record<LibraryCategoryKey, string> = {
  all: "全部",
  treasure: "Treasure",
  fine: "Fine",
  reject: "Reject",
  favorites: "收藏",
  unrated: "未评分",
};

type Group = { key: string; label: string; categoryLabel?: string; items: LibraryImageItem[] };

function dateLabel(date: string, category: LibraryCategoryKey): string {
  if (date) return date;
  return category === "unrated" ? "未评分" : "未分组";
}

function buildGroups(items: LibraryImageItem[], category: LibraryCategoryKey): Group[] {
  if (category === "all") {
    const groups: Group[] = [];
    for (const key of CATEGORY_ORDER.slice(1)) {
      const list = items.filter((i) => i.category === key);
      if (!list.length) continue;
      const dates = [...new Set(list.map((i) => i.date))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || b.localeCompare(a));
      for (const d of dates) {
        groups.push({
          key: `${key}:${d}`,
          label: dateLabel(d, key),
          categoryLabel: CATEGORY_LABEL[key],
          items: list.filter((i) => i.date === d),
        });
      }
    }
    return groups;
  }
  const dates = [...new Set(items.map((i) => i.date))].sort(
    (a, b) => (a ? 1 : 0) - (b ? 1 : 0) || b.localeCompare(a)
  );
  return dates.map((d) => ({
    key: d || "no-date",
    label: dateLabel(d, category),
    items: items.filter((i) => i.date === d),
  }));
}

export function Gallery() {
  const navigate = useNavigate();
  const addToast = useStore((s) => s.addToast);
  const overwriteZonesFromPng = useStore((s) => s.overwriteZonesFromPng);
  const recycleReject = useStore((s) => s.settings?.recycle_reject ?? true);

  const [summary, setSummary] = useState<LibrarySummary | null>(null);
  const [category, setCategory] = useState<LibraryCategoryKey | null>(null);
  const [items, setItems] = useState<LibraryImageItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [undoToken, setUndoToken] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [pngInfo, setPngInfo] = useState<PngInfoResult | null>(null);
  const [pngLoading, setPngLoading] = useState(false);
  const [pngError, setPngError] = useState("");
  const [pngOpen, setPngOpen] = useState(false);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const setSidebarGroups = useSidebarStore((s) => s.setGroups);
  const setSidebarActive = useSidebarStore((s) => s.setActiveGroup);
  const setReviewAvailable = useSidebarStore((s) => s.setReviewAvailable);
  const setSidebarOpen = useSidebarStore((s) => s.setOpen);
  const registerGallery = useSidebarStore((s) => s.registerGallery);
  const unregisterGallery = useSidebarStore((s) => s.unregisterGallery);

  const refresh = useCallback(async () => {
    try {
      const s = await api.librarySummary();
      setSummary(s);
    } catch (e) {
      addToast(`图库加载失败: ${(e as Error).message}`, "err");
    }
  }, [addToast]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openCategory = useCallback(async (key: LibraryCategoryKey) => {
    setCategory(key);
    setReviewing(false);
    setUndoToken(null);
    setLoadingItems(true);
    try {
      const result = await api.libraryImages(key);
      setItems(result.items);
    } catch (e) {
      addToast(`图片列表加载失败: ${(e as Error).message}`, "err");
      setItems([]);
    } finally {
      setLoadingItems(false);
    }
  }, [addToast]);

  const backToCategories = useCallback(() => {
    setCategory(null);
    setItems([]);
    setReviewing(false);
    setLightboxIndex(null);
    setUndoToken(null);
    setPngOpen(false);
    setPngInfo(null);
  }, []);

  const groups = useMemo(() => (category ? buildGroups(items, category) : []), [category, items]);
  const slides = useMemo(
    () =>
      items.map((item) => ({
        src: api.libraryImageUrl(item.path),
        path: item.path,
        name: item.name,
      })),
    [items]
  );

  // 切换图片时重置 PNG 信息状态
  useEffect(() => {
    if (lightboxIndex !== null) {
      setPngInfo(null);
      setPngError("");
      setPngOpen(false);
    }
  }, [lightboxIndex]);

  // 分类入口页（没有时间索引）时侧边栏保持收起
  useEffect(() => {
    if (!category) setSidebarOpen(false);
  }, [category, setSidebarOpen]);

  const scrollToGroup = useCallback((key: string) => {
    const el = document.getElementById(`group-${key}`);
    if (!el) return;
    const y = el.getBoundingClientRect().top + window.scrollY - 96;
    window.scrollTo({ top: y, behavior: "smooth" });
  }, []);

  // 滚动时检测当前查看位置，高亮对应时间索引
  useEffect(() => {
    if (!groups.length) {
      setSidebarActive(null);
      return;
    }
    const onScroll = () => {
      const refY = window.scrollY + 110;
      let current: string | null = null;
      for (const g of groups) {
        const el = document.getElementById(`group-${g.key}`);
        if (el && el.getBoundingClientRect().top + window.scrollY <= refY) current = g.key;
      }
      setSidebarActive(current);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [groups, setSidebarActive]);

  // 向全局侧边栏注册时间索引与筛选模式
  useEffect(() => {
    if (!category || !groups.length) return;
    setSidebarOpen(true); // 进入图片流（出现时间索引）时才主动展开侧边栏
    setSidebarGroups(groups.map((g) => ({ key: g.key, label: g.label, count: g.items.length })));
    setReviewAvailable(items.length > 0 && !reviewing);
    registerGallery({
      scrollTo: (key) => scrollToGroup(key),
      startReview: () => {
        setLightboxIndex(null);
        setReviewing(true);
      },
    });
    return () => {
      setSidebarGroups([]);
      setReviewAvailable(false);
      unregisterGallery();
    };
  }, [
    category,
    groups,
    items.length,
    reviewing,
    registerGallery,
    scrollToGroup,
    setReviewAvailable,
    setSidebarOpen,
    setSidebarGroups,
    unregisterGallery,
  ]);

  const handleReadPngInfo = useCallback(
    async (path: string) => {
      if (!path || pngLoading) return;
      setPngLoading(true);
      setPngError("");
      try {
        const result = await api.libraryPngInfo(path);
        setPngInfo(result);
        setPngOpen(true);
      } catch (e) {
        setPngError((e as Error).message);
        setPngOpen(true);
      } finally {
        setPngLoading(false);
      }
    },
    [pngLoading]
  );

  const sendToWorkspace = useCallback(
    (prompt: string, uc: string) => {
      const ok = window.confirm(
        "发送到工作区会用这张图的提示词覆盖当前正面/负面区域的全部内容，是否继续？"
      );
      if (!ok) return;
      overwriteZonesFromPng(prompt, uc);
      setLightboxIndex(null);
      setPngOpen(false);
      navigate("/");
    },
    [navigate, overwriteZonesFromPng]
  );

  const handleReviewFinished = useCallback(
    async (result: ReviewApplyResult) => {
      setUndoToken(result.undo_token);
      setReviewing(false);
      setLightboxIndex(null);
      addToast(result.message);
      await refresh();
      if (category) await openCategory(category);
    },
    [addToast, category, refresh, openCategory]
  );

  const undoApplied = useCallback(async () => {
    if (!undoToken) return;
    try {
      const res = await api.undoReview(undoToken);
      addToast(`已撤销 ${res.restored.length} 张` + (res.failed.length ? `，${res.failed.length} 张无法还原` : ""));
      setUndoToken(null);
      await refresh();
      if (category) await openCategory(category);
    } catch (e) {
      addToast(`撤销失败: ${(e as Error).message}`, "err");
    }
  }, [addToast, category, openCategory, refresh, undoToken]);

  const handleImport = useCallback(
    async (fileList: FileList | null) => {
      if (!fileList?.length || importing) return;
      const files = Array.from(fileList).filter((f) =>
        /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name)
      );
      if (!files.length) {
        addToast("没有可导入的图片文件", "err");
        return;
      }
      setImporting(true);
      try {
        const result = await api.importLibraryFiles(files);
        addToast(
          `已导入 ${result.imported} 张` + (result.skipped ? `，跳过 ${result.skipped} 张` : "")
        );
        await refresh();
      } catch (e) {
        addToast(`导入失败: ${(e as Error).message}`, "err");
      } finally {
        setImporting(false);
      }
    },
    [addToast, importing, refresh]
  );

  const openFolder = useCallback(async () => {
    try {
      await api.openLibraryFolder();
      addToast("已在资源管理器中打开图库文件夹");
    } catch (e) {
      addToast(`打开文件夹失败: ${(e as Error).message}`, "err");
    }
  }, [addToast]);

  // ---------- 分类入口页 ----------
  if (!category) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">图片库</h1>
            <p className="mt-0.5 truncate text-xs text-[var(--muted)]" title={summary?.library_path}>
              {summary?.library_path || "正在读取图库路径…"}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <input
              ref={folderInputRef}
              type="file"
              multiple
              className="hidden"
              {...{ webkitdirectory: "" }}
              onChange={(e) => {
                handleImport(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handleImport(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--hover)] px-3 py-1.5 text-xs disabled:opacity-40"
              title="选择整个文件夹，图片会复制进图库"
            >
              <FolderPlus size={14} /> 选择文件夹
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-1.5 rounded-lg bg-[var(--hover)] px-3 py-1.5 text-xs disabled:opacity-40"
              title="多选图片导入图库"
            >
              <Plus size={14} /> 选择图片
            </button>
            <button
              onClick={openFolder}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-85"
              style={{ background: "var(--accent)" }}
              title="用系统资源管理器打开图库目录"
            >
              <FolderOpen size={14} /> 打开图库文件夹
            </button>
          </div>
        </div>
        {importing && (
          <div className="mb-4 flex items-center gap-2 text-xs text-[var(--muted)]">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" />
            正在导入图片…
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          {CATEGORY_ORDER.map((key) => {
            const meta = CATEGORY_META[key];
            const info = summary?.categories.find((c) => c.key === key);
            const Icon = meta.icon;
            return (
              <button
                key={key}
                onClick={() => openCategory(key)}
                className="glass group flex flex-col items-start gap-3 rounded-2xl p-5 text-left transition-transform hover:-translate-y-0.5 hover:shadow-xl"
              >
                <span
                  className="flex h-11 w-11 items-center justify-center rounded-xl text-white shadow"
                  style={{ background: meta.color }}
                >
                  <Icon size={20} />
                </span>
                <span className="text-base font-semibold">{info?.label ?? key}</span>
                <span className="text-xs leading-relaxed text-[var(--muted)]">{meta.desc}</span>
                <span className="mt-auto text-2xl font-bold tabular-nums">{info?.count ?? 0}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ---------- 筛选模式 ----------
  if (reviewing) {
    return (
      <ReviewMode
        items={items}
        categoryLabel={summary?.categories.find((c) => c.key === category)?.label ?? category}
        recycleReject={recycleReject}
        onFinished={handleReviewFinished}
        onCancel={() => setReviewing(false)}
      />
    );
  }

  // ---------- 图片流（按日期分组） ----------
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;
  const currentItem = lightboxIndex !== null ? items[lightboxIndex] : null;
  return (
    <div className="min-h-full pb-10">
      <div className="glass sticky top-0 z-20 flex items-center gap-3 border-x-0 border-t-0 px-4 py-2">
        <button
          onClick={backToCategories}
          className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          <ArrowLeft size={14} /> 分类
        </button>
        <span className="flex items-center gap-2 text-sm font-semibold">
          <Icon size={16} style={{ color: meta.color }} />
          {summary?.categories.find((c) => c.key === category)?.label ?? category}
        </span>
        <span className="text-xs text-[var(--muted)]">{items.length} 张</span>
        <div className="ml-auto flex items-center gap-2">
          {undoToken && (
            <button
              onClick={undoApplied}
              className="flex items-center gap-1 rounded-lg bg-[var(--hover)] px-2.5 py-1.5 text-xs"
            >
              <Undo2 size={13} /> 撤销本次筛选
            </button>
          )}
        </div>
      </div>

      {loadingItems && (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--muted)]">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--muted)] border-t-transparent" />
          正在扫描图库…
        </div>
      )}

      {!loadingItems && !items.length && (
        <div className="py-20 text-center text-sm text-[var(--muted)]">
          这个分类还没有图片。
        </div>
      )}

      {!loadingItems && items.length > 0 && (
        <div className="mx-auto w-full max-w-7xl px-4 pt-2">
          {groups.map((group) => (
            <section key={group.key} id={`group-${group.key}`} className="mb-3 scroll-mt-24">
              <div className="sticky top-11 z-10 -mx-1 mb-2 flex items-center gap-2 px-1 py-1">
                <span className="rounded-full bg-[var(--accent)] px-3 py-0.5 text-xs font-semibold text-white">
                  {group.label}
                </span>
                {group.categoryLabel && (
                  <span className="text-xs text-[var(--muted)]">{group.categoryLabel}</span>
                )}
                <span className="text-xs text-[var(--muted)]">{group.items.length} 张</span>
              </div>
              <GalleryMasonry
                key={group.key}
                items={group.items}
                onItemClick={(_item, idx) => {
                  const base = items.findIndex((i) => i.path === group.items[0].path);
                  setLightboxIndex(base + idx);
                }}
              />
            </section>
          ))}
        </div>
      )}

      <Lightbox
        open={lightboxIndex !== null}
        close={() => setLightboxIndex(null)}
        index={lightboxIndex ?? 0}
        slides={slides}
        render={{
          slide: ({ slide, offset }) =>
            offset !== 0 ? null : (
              <ZoomableImage key={slide.src} src={slide.src} onClose={() => setLightboxIndex(null)} />
            ),
          slideFooter: ({ slide }) => {
            const sameItem = currentItem?.path === slide.path;
            const hasInfo = sameItem && pngInfo;
            return (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  void handleReadPngInfo(slide.path ?? "");
                }}
                disabled={pngLoading && sameItem}
                className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-85 disabled:opacity-50"
                style={{ background: "var(--accent)" }}
                title="按需读取 PNG 元数据"
              >
                {pngLoading && sameItem ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <FileJson size={15} />
                )}
                {pngLoading && sameItem ? "读取中…" : hasInfo ? "PNG 信息" : "读取 PNG 信息"}
              </button>
            );
          },
        }}
        on={{
          view: ({ index }) => setLightboxIndex(index),
          click: () => setLightboxIndex(null),
        }}
      />

      {pngOpen && currentItem && (
        <PngInfoPopup
          item={currentItem}
          info={pngInfo}
          loading={pngLoading}
          error={pngError}
          onRead={() => handleReadPngInfo(currentItem.path)}
          onClose={() => setPngOpen(false)}
          onSendToWorkspace={sendToWorkspace}
        />
      )}
    </div>
  );
}
