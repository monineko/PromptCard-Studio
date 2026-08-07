import { create } from "zustand";
import { api, uid } from "./api";
import { copyText, serializeSections, splitWeightedPrompt, SYSTEM_SECTIONS } from "./lib";
import type { Block, Category, Section, Settings, Zone } from "./types";

type Snapshot = { positive: Section[]; negative: Section[] };

type Toast = { id: number; text: string; kind: "ok" | "err" };

type DetailState = { category: string; name: string } | null;

const DEFAULT_POSITIVE_SECTIONS = ["提示词工作台", "角色", "动作", "画师串"];
const NEGATIVE_SECTION_NAME = "负面";
const LEGACY_NEGATIVE_NAME = "负面Prompt";
const WORKBENCH_NAME = "提示词工作台";
const LEGACY_OTHER_NAME = "其他";

function makeSection(name: string, locked = false, blocks: Block[] = []): Section {
  return { id: uid(), name, locked, blocks: [...blocks] };
}

function sectionNameForCategory(category: string): string {
  return category.startsWith("综合") ? "综合" : category;
}

function ensureSection(sections: Section[], name: string): Section {
  const found = sections.find((s) => s.name === name);
  if (found) return found;
  const section = makeSection(name, SYSTEM_SECTIONS.includes(name as (typeof SYSTEM_SECTIONS)[number]));
  sections.push(section);
  return section;
}

function defaultPositiveZone(): Section[] {
  return DEFAULT_POSITIVE_SECTIONS.map((name) => makeSection(name, true));
}

function defaultNegativeZone(): Section[] {
  return [makeSection(NEGATIVE_SECTION_NAME, true)];
}

/**
 * 历史结构迁移：
 * - 正面"其他" → 置顶"提示词工作台"；
 * - 正面的自定义"负面"分区并入负面区，负面各分区合并为一个"负面"（旧名"负面Prompt"兼容）。
 */
function migrateWorkspace(positive: Section[], negative: Section[]): { positive: Section[]; negative: Section[] } {
  const cloneBlocks = (blocks: Block[]): Block[] =>
    blocks.map((b) =>
      b.type === "card" && b.category === LEGACY_NEGATIVE_NAME
        ? { ...b, category: NEGATIVE_SECTION_NAME }
        : { ...b }
    );
  const pos = positive.map((s) => ({ ...s, blocks: cloneBlocks(s.blocks) }));
  const idx = pos.findIndex((s) => s.name === LEGACY_OTHER_NAME);
  if (idx >= 0) {
    const [workbench] = pos.splice(idx, 1);
    pos.unshift({ ...workbench, name: WORKBENCH_NAME, locked: true });
  } else if (!pos.some((s) => s.name === WORKBENCH_NAME)) {
    pos.unshift(makeSection(WORKBENCH_NAME, true));
  }

  // 正面"负面"分区的内容移入负面区
  const posNegIdx = pos.findIndex((s) => s.name === NEGATIVE_SECTION_NAME);
  const movedBlocks = posNegIdx >= 0 ? cloneBlocks(pos[posNegIdx].blocks) : [];
  if (posNegIdx >= 0) pos.splice(posNegIdx, 1);

  let neg: Section[];
  if (negative.length === 1 && negative[0].name === NEGATIVE_SECTION_NAME) {
    neg = [{ ...negative[0], blocks: cloneBlocks(negative[0].blocks) }];
  } else {
    const blocks = negative.flatMap((s) => cloneBlocks(s.blocks));
    neg = [makeSection(NEGATIVE_SECTION_NAME, true, blocks)];
    if (negative.length === 1 && negative[0].name === LEGACY_NEGATIVE_NAME) {
      neg[0].locked = true;
    }
  }
  if (movedBlocks.length) neg[0].blocks.push(...movedBlocks);
  return { positive: pos, negative: neg };
}

function cloneZones(positive: Section[], negative: Section[]): { positive: Section[]; negative: Section[] } {
  const clone = (sections: Section[]) =>
    sections.map((sec) => ({ ...sec, blocks: [...sec.blocks] }));
  return { positive: clone(positive), negative: clone(negative) };
}

interface AppState {
  ready: boolean;
  settings: Settings | null;
  categories: Category[];
  categoryColor: Record<string, number>;
  search: string;
  expanded: Record<string, boolean>;
  zone: Zone;
  positive: Section[];
  negative: Section[];
  past: Snapshot[];
  future: Snapshot[];
  toasts: Toast[];
  detail: DetailState;
  showNewCard: boolean;
  newCardCategory: string;
  newCardContent: string;
  showNewCategory: boolean;
  showImport: boolean;
  cardRefresher: number;

  init: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  reorderCategories: (names: string[]) => void;
  setSearch: (s: string) => void;
  toggleExpanded: (name: string) => void;
  setZone: (z: Zone) => void;
  setTheme: (patch: Partial<Settings["theme"]>) => void;
  saveSettings: (patch: Partial<Settings>) => Promise<void>;

  addToast: (text: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;

  openDetail: (category: string, name: string) => void;
  closeDetail: () => void;
  setShowNewCard: (v: boolean) => void;
  setNewCardCategory: (v: string) => void;
  setShowNewCategory: (v: boolean) => void;
  setShowImport: (v: boolean) => void;

  addCardBlock: (category: string, name: string) => void;
  addPrompt: (sectionId: string, text: string) => void;
  addPrompts: (sectionId: string, texts: string[]) => void;
  adjustWeight: (sectionId: string, blockId: string, delta: number) => void;
  removeBlock: (sectionId: string, blockId: string) => void;
  updatePrompt: (sectionId: string, blockId: string, text: string) => void;
  moveBlock: (fromSectionId: string, blockId: string, toSectionId: string, index?: number) => void;
  renameSection: (sectionId: string, name: string) => void;
  deleteSection: (sectionId: string) => void;
  addSection: (name: string) => void;
  splitSectionPrompts: (sectionId: string) => void;
  composeSectionId: string | null;
  setComposeSectionId: (id: string | null) => void;
  replaceSectionWithCard: (sectionId: string, category: string, name: string) => void;
  clearZone: () => void;
  undo: () => void;
  redo: () => void;
  copyZone: () => Promise<void>;
  overwriteZonesFromPng: (prompt: string, uc: string) => void;
  setNewCardContent: (content: string) => void;

  createCategory: (name: string) => Promise<boolean>;
  renameCategory: (oldName: string, newName: string) => Promise<boolean>;
  deleteCategory: (name: string) => Promise<boolean>;
  saveCategoryColor: (name: string, hue: number) => Promise<void>;
  createCard: (category: string, name: string, content: string) => Promise<boolean>;
  saveCardDetail: (content: string, newCategory?: string, newName?: string) => Promise<boolean>;
  deleteCard: (category: string, name: string) => Promise<boolean>;
}

let toastSeq = 1;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleSave(get: () => AppState) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const s = get();
    api.saveWorkspace(s.positive, s.negative).catch(() => {});
  }, 600);
}

function applyTheme(settings: Settings | null) {
  const root = document.documentElement;
  if (!settings) return;
  root.dataset.mode = settings.theme.mode;
  root.style.setProperty("--accent", settings.theme.accent);
  root.style.setProperty("--glass", String(settings.theme.glass));
}

export const useStore = create<AppState>((set, get) => {
  const buildColorMap = (categories: Category[]) => {
    const map: Record<string, number> = {};
    for (const c of categories) {
      if (c.color != null) map[c.name] = c.color;
    }
    return map;
  };

  const snapshot = (): Snapshot => cloneZones(get().positive, get().negative);

  const commit = (mutate: (s: AppState) => void) => {
    set((s) => {
      const past = [...s.past.slice(-59), snapshot()];
      const cloned = cloneZones(s.positive, s.negative);
      const next = { ...s, ...cloned, past, future: [] };
      mutate(next);
      scheduleSave(get);
      return next;
    });
  };

  const allSections = (s: AppState): Section[] => [...s.positive, ...s.negative];
  const findSection = (s: AppState, id: string): Section | undefined =>
    allSections(s).find((x) => x.id === id);

  return {
    ready: false,
    settings: null,
    categories: [],
    categoryColor: {},
    search: "",
    expanded: {},
    zone: "positive",
    positive: [],
    negative: [],
    past: [],
    future: [],
    toasts: [],
    detail: null,
    showNewCard: false,
    newCardCategory: "",
    newCardContent: "",
    composeSectionId: null,
    showNewCategory: false,
    showImport: false,
    cardRefresher: 0,

    async init() {
      try {
        const settings = await api.settings();
        const categories = await api.categories();
        const ws = await api.workspace();
        applyTheme(settings);
        set((s) => {
          const { positive, negative } = migrateWorkspace(
            ws.positive.length ? ws.positive : defaultPositiveZone(),
            ws.negative.length ? ws.negative : defaultNegativeZone()
          );
          return {
            settings,
            categories,
            categoryColor: buildColorMap(categories),
            positive,
            negative,
            past: s.past,
            future: s.future,
            ready: true,
          };
        });
        scheduleSave(get);
      } catch (e) {
        get().addToast(`初始化失败: ${(e as Error).message}`, "err");
        set((s) => ({ ...s, ready: true }));
      }
    },

    async refreshCategories() {
      try {
        const categories = await api.categories();
        set((s) => ({ categories, categoryColor: buildColorMap(categories), cardRefresher: s.cardRefresher + 1 }));
      } catch (e) {
        get().addToast(`刷新失败: ${(e as Error).message}`, "err");
      }
    },

    reorderCategories(names) {
      set((s) => {
        const byName = new Map(s.categories.map((c) => [c.name, c]));
        const ordered = names.map((n) => byName.get(n)).filter((c): c is Category => !!c);
        const rest = s.categories.filter((c) => !names.includes(c.name));
        return { categories: [...ordered, ...rest] };
      });
      api.saveCategoryOrder(names).catch(() => {});
    },

    setSearch: (s) => set({ search: s }),
    toggleExpanded: (name) =>
      set((s) => ({ expanded: { ...s.expanded, [name]: !s.expanded[name] } })),
    setZone: (z) => set({ zone: z }),

    setTheme(patch) {
      set((s) => {
        if (!s.settings) return s;
        const settings = { ...s.settings, theme: { ...s.settings.theme, ...patch } };
        applyTheme(settings);
        api.saveSettings(settings).catch(() => {});
        return { settings };
      });
    },

    async saveSettings(patch) {
      const settings = await api.saveSettings(patch);
      applyTheme(settings);
      set({ settings });
      get().addToast("设置已保存");
    },

    addToast(text, kind = "ok") {
      const id = toastSeq++;
      set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
      setTimeout(() => get().dismissToast(id), 3000);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    openDetail: (category, name) => set({ detail: { category, name } }),
    closeDetail: () => set({ detail: null }),
    setShowNewCard: (v) => set({ showNewCard: v }),
    setNewCardCategory: (v) => set({ newCardCategory: v }),
    setNewCardContent: (content) => set({ newCardContent: content }),
    setShowNewCategory: (v) => set({ showNewCategory: v }),
    setShowImport: (v) => set({ showImport: v }),

    addCardBlock(category, name) {
      commit((s) => {
        const secName = sectionNameForCategory(category);
        // 负面分类的卡片进入负面区（系统"负面"分区），其余进入正面区
        const section =
          allSections(s).find((x) => x.name === secName) ??
          ensureSection(secName === NEGATIVE_SECTION_NAME ? s.negative : s.positive, secName);
        section.blocks.push({ id: uid(), type: "card", category, name });
      });
      get().addToast(`已添加 <${category}:${name}>`);
    },

    addPrompt(sectionId, text) {
      const t = text.trim();
      if (!t) return;
      commit((s) => {
        const section = findSection(s, sectionId);
        if (section) section.blocks.push({ id: uid(), type: "prompt", text: t });
      });
    },

    addPrompts(sectionId, texts) {
      const items = texts.map((t) => t.trim()).filter(Boolean);
      if (!items.length) return;
      commit((s) => {
        const section = findSection(s, sectionId);
        if (section) items.forEach((t) => section.blocks.push({ id: uid(), type: "prompt", text: t }));
      });
    },

    removeBlock(sectionId, blockId) {
      commit((s) => {
        const section = findSection(s, sectionId);
        if (section) section.blocks = section.blocks.filter((b) => b.id !== blockId);
      });
    },

    adjustWeight(sectionId, blockId, delta) {
      commit((s) => {
        const section = findSection(s, sectionId);
        const block = section?.blocks.find((b) => b.id === blockId && b.type === "prompt");
        if (!block || block.type !== "prompt") return;
        const current = block.weight ?? 1;
        const next = Math.min(3, Math.max(0.1, Math.round((current + delta) * 10) / 10));
        block.weight = next;
      });
    },

    updatePrompt(sectionId, blockId, text) {
      const t = text.trim();
      if (!t) return;
      commit((s) => {
        const section = findSection(s, sectionId);
        const block = section?.blocks.find((b) => b.id === blockId && b.type === "prompt");
        if (block && block.type === "prompt") block.text = t;
      });
    },

    moveBlock(fromSectionId, blockId, toSectionId, index) {
      commit((s) => {
        const from = findSection(s, fromSectionId);
        if (!from) return;
        const to = findSection(s, toSectionId) ?? from;
        const idx = from.blocks.findIndex((b) => b.id === blockId);
        if (idx < 0) return;
        const [block] = from.blocks.splice(idx, 1);
        if (from === to) {
          const insertAt = index === undefined ? to.blocks.length : Math.max(0, Math.min(index, to.blocks.length));
          to.blocks.splice(insertAt, 0, block);
        } else {
          to.blocks.push(block);
        }
      });
    },

    renameSection(sectionId, name) {
      const n = name.trim();
      if (!n) return;
      commit((s) => {
        const section = findSection(s, sectionId);
        if (section && !section.locked && !SYSTEM_SECTIONS.includes(n as (typeof SYSTEM_SECTIONS)[number]))
          section.name = n;
      });
    },

    deleteSection(sectionId) {
      commit((s) => {
        const section = findSection(s, sectionId);
        if (!section || section.locked) return;
        const workbench = s.positive.find((x) => x.name === WORKBENCH_NAME);
        if (workbench) workbench.blocks.push(...section.blocks);
        s.positive = s.positive.filter((x) => x.id !== sectionId);
        s.negative = s.negative.filter((x) => x.id !== sectionId);
      });
    },

    addSection(name) {
      const n = name.trim();
      if (!n) return;
      if (SYSTEM_SECTIONS.includes(n as (typeof SYSTEM_SECTIONS)[number])) {
        get().addToast(`「${n}」是系统默认分区，无需重复添加`, "err");
        return;
      }
      commit((s) => {
        if (allSections(s).some((x) => x.name === n)) return;
        const section = makeSection(n);
        s.positive.push(section);
      });
    },

    splitSectionPrompts(sectionId) {
      commit((s) => {
        const section = findSection(s, sectionId);
        if (!section) return;
        const next: Block[] = [];
        for (const b of section.blocks) {
          if (b.type === "card") {
            next.push(b);
            continue;
          }
          const terms = splitWeightedPrompt(b.text);
          if (terms.length === 1 && terms[0].text === b.text) {
            next.push(b);
            continue;
          }
          for (const t of terms) {
            next.push({
              id: uid(),
              type: "prompt",
              text: t.text,
              weight: t.weight !== 1 ? t.weight : undefined,
            });
          }
        }
        section.blocks = next;
      });
    },

    setComposeSectionId(id) {
      set({ composeSectionId: id });
    },

    replaceSectionWithCard(sectionId, category, name) {
      commit((s) => {
        const section = findSection(s, sectionId);
        if (!section) return;
        section.blocks = [{ id: uid(), type: "card", category, name }];
      });
    },

    clearZone() {
      commit((s) => {
        s.positive.forEach((sec) => (sec.blocks = []));
        s.negative.forEach((sec) => (sec.blocks = []));
      });
      get().addToast("已清空提示词工作区（含负面）");
    },

    undo() {
      set((s) => {
        if (s.past.length === 0) return s;
        const prev = s.past[s.past.length - 1];
        return {
          positive: prev.positive,
          negative: prev.negative,
          past: s.past.slice(0, -1),
          future: [...s.future, snapshot()],
        };
      });
      scheduleSave(get);
    },

    redo() {
      set((s) => {
        if (s.future.length === 0) return s;
        const next = s.future[s.future.length - 1];
        return {
          positive: next.positive,
          negative: next.negative,
          future: s.future.slice(0, -1),
          past: [...s.past, snapshot()],
        };
      });
      scheduleSave(get);
    },

    async copyZone() {
      const s = get();
      const raw = serializeSections(allSections(s));
      if (!raw.trim()) {
        s.addToast("工作区没有内容可复制", "err");
        return;
      }
      try {
        const { text } = await api.expand(raw);
        await copyText(text);
        s.addToast(`已复制，共 ${text.length} 字符`);
      } catch (e) {
        s.addToast(`复制失败: ${(e as Error).message}`, "err");
      }
    },

    overwriteZonesFromPng(prompt, uc) {
      commit((s) => {
        const clear = (sections: Section[]) => sections.forEach((sec) => (sec.blocks = []));
        const put = (sections: Section[], text: string, preferName: string) => {
          const t = (text ?? "").trim();
          if (!t) return;
          const section = sections.find((x) => x.name === preferName) ?? sections[0];
          if (section) section.blocks.push({ id: uid(), type: "prompt", text: t });
        };
        clear(s.positive);
        clear(s.negative);
        put(s.positive, prompt, WORKBENCH_NAME);
        put(s.negative, uc, NEGATIVE_SECTION_NAME);
      });
      get().addToast("已用图片提示词覆盖工作区（可用 Ctrl+Z 撤销）");
    },

    async createCategory(name) {
      try {
        await api.createCategory(name);
        await get().refreshCategories();
        get().addToast(`已创建分类 ${name}`);
        return true;
      } catch (e) {
        get().addToast(`创建分类失败: ${(e as Error).message}`, "err");
        return false;
      }
    },

    async renameCategory(oldName, newName) {
      try {
        await api.renameCategory(oldName, newName);
        await get().refreshCategories();
        get().addToast(`已重命名分类`);
        return true;
      } catch (e) {
        get().addToast(`重命名失败: ${(e as Error).message}`, "err");
        return false;
      }
    },

    async deleteCategory(name) {
      try {
        await api.deleteCategory(name);
        await get().refreshCategories();
        get().addToast(`已删除分类 ${name}（进入回收站）`);
        return true;
      } catch (e) {
        get().addToast(`删除失败: ${(e as Error).message}`, "err");
        return false;
      }
    },

    async createCard(category, name, content) {
      try {
        await api.createCard(category, name, content);
        await get().refreshCategories();
        set((s) => ({ expanded: { ...s.expanded, [category]: true } }));
        get().addToast(`已保存卡片 <${category}:${name}>`);
        return true;
      } catch (e) {
        get().addToast(`保存卡片失败: ${(e as Error).message}`, "err");
        return false;
      }
    },

    async saveCardDetail(content, newCategory, newName) {
      const d = get().detail;
      if (!d) return false;
      try {
        await api.updateCard(d.category, d.name, content, newCategory, newName);
        await get().refreshCategories();
        get().addToast(`已保存修改 <${newCategory || d.category}:${newName || d.name}>`);
        set({ detail: null });
        return true;
      } catch (e) {
        get().addToast(`保存失败: ${(e as Error).message}`, "err");
        return false;
      }
    },

    async deleteCard(category, name) {
      try {
        await api.deleteCard(category, name);
        await get().refreshCategories();
        get().addToast(`已删除 <${category}:${name}>（进入回收站）`);
        return true;
      } catch (e) {
        get().addToast(`删除失败: ${(e as Error).message}`, "err");
        return false;
      }
    },

    async saveCategoryColor(name, hue) {
      try {
        await api.saveCategoryColor(name, hue);
        set((s) => ({
          categories: s.categories.map((c) => (c.name === name ? { ...c, color: hue } : c)),
          categoryColor: { ...s.categoryColor, [name]: hue },
        }));
        get().addToast(`已更新分类「${name}」颜色`);
      } catch (e) {
        get().addToast(`保存颜色失败: ${(e as Error).message}`, "err");
      }
    },
  };
});
