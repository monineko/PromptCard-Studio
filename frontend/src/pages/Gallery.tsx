import {
  ArrowLeft,
  Crown,
  Heart,
  Images,
  LayoutGrid,
  Play,
  ThumbsUp,
  Undo2,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Lightbox from "yet-another-react-lightbox";
import Captions from "yet-another-react-lightbox/plugins/captions";
import "yet-another-react-lightbox/styles.css";
import "yet-another-react-lightbox/plugins/captions.css";
import { api } from "../api";
import { GalleryMasonry } from "../components/gallery/GalleryMasonry";
import { PngPanel } from "../components/gallery/PngPanel";
import { ReviewMode } from "../components/gallery/ReviewMode";
import { useStore } from "../store";
import type {
  LibraryCategoryKey,
  LibraryImageItem,
  LibrarySummary,
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
      const labelOf = (k: LibraryCategoryKey) => CATEGORY_META[k].desc.split(" ")[0] ?? k;
      const dates = [...new Set(list.map((i) => i.date))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || b.localeCompare(a));
      for (const d of dates) {
        groups.push({
          key: `${key}:${d}`,
          label: dateLabel(d, key),
          categoryLabel: labelOf(key),
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
  }, []);

  const groups = useMemo(() => (category ? buildGroups(items, category) : []), [category, items]);
  const slides = useMemo(
    () =>
      items.map((item) => ({
        src: api.libraryImageUrl(item.path),
        title: item.name,
        description: (
          <PngPanel
            slides={items}
            onSendToWorkspace={(prompt, uc) => {
              const ok = window.confirm("发送到工作区会用这张图的提示词覆盖当前正面/负面区域的全部内容，是否继续？");
              if (!ok) return;
              overwriteZonesFromPng(prompt, uc);
              setLightboxIndex(null);
              navigate("/");
            }}
          />
        ),
      })),
    [items, navigate, overwriteZonesFromPng]
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

  // ---------- 分类入口页 ----------
  if (!category) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <h1 className="mb-1 text-lg font-semibold">图片库</h1>
        <p className="mb-5 text-xs text-[var(--muted)]">
          {summary?.library_path || "正在读取图库路径…"}
        </p>
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
          <button
            onClick={() => {
              setLightboxIndex(null);
              setReviewing(true);
            }}
            disabled={!items.length}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-40"
            style={{ background: "var(--accent)" }}
          >
            <Play size={13} /> 筛选模式
          </button>
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
        <div className="mx-auto w-full max-w-6xl px-4 pt-2">
          {groups.map((group) => (
            <section key={group.key} className="mb-3">
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
        plugins={[Captions]}
        captions={{ descriptionTextAlign: "start", descriptionMaxLines: 0 }}
        on={{ view: ({ index }) => setLightboxIndex(index) }}
      />
    </div>
  );
}
