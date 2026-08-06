import { create } from "zustand";
import { api, uid } from "./api";
import { copyText } from "./lib";
import type { Block, Category, Section, Settings, Zone } from "./types";

type Snapshot = { positive: Section[]; negative: Section[] };

type Toast = { id: number; text: string; kind: "ok" | "err" };

type DetailState = { category: string; name: string } | null;

const DEFAULT_SECTION_NAMES = ["角色", "动作", "画师串", "其他"];

function makeSection(name: string, locked = false): Section {
  return { id: uid(), name, locked, blocks: [] };
}

function sectionNameForCategory(category: string): string {
  return category.startsWith("综合") ? "综合" : category;
}

function ensureSection(sections: Section[], name: string): Section {
  const found = sections.find((s) => s.name === name);
  if (found) return found;
  const section = makeSection(name, DEFAULT_SECTION_NAMES.includes(name));
  const last = sections[sections.length - 1];
  if (last?.name === "其他") sections.splice(sections.length - 1, 0, section);
  else sections.push(section);
  return section;
}

function defaultZone(): Section[] {
  return DEFAULT_SECTION_NAMES.map((name) => makeSection(name, true));
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
  search: string;
  expanded: Record<string, boolean>;
  zone: Zone;
  positive: Section[];
  negative: Section[];
  past: Snapshot[];
  future: Snapshot[];
  autoSplit: boolean;
  toasts: Toast[];
  detail: DetailState;
  showNewCard: boolean;
  newCardCategory: string;
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
  removeBlock: (sectionId: string, blockId: string) => void;
  moveBlock: (fromSectionId: string, blockId: string, toSectionId: string, index?: number) => void;
  renameSection: (sectionId: string, name: string) => void;
  deleteSection: (sectionId: string) => void;
  addSection: (name: string) => void;
  clearZone: () => void;
  undo: () => void;
  redo: () => void;
  copyZone: () => Promise<void>;

  createCategory: (name: string) => Promise<boolean>;
  renameCategory: (oldName: string, newName: string) => Promise<boolean>;
  deleteCategory: (name: string) => Promise<boolean>;
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

  const zoneSections = (s: AppState): Section[] => (s.zone === "positive" ? s.positive : s.negative);

  return {
    ready: false,
    settings: null,
    categories: [],
    search: "",
    expanded: {},
    zone: "positive",
    positive: [],
    negative: [],
    past: [],
    future: [],
    autoSplit: localStorage.getItem("npm_auto_split") !== "0",
    toasts: [],
    detail: null,
    showNewCard: false,
    newCardCategory: "",
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
          const positive = ws.positive.length ? ws.positive : defaultZone();
          const negative = ws.negative.length ? ws.negative : defaultZone();
          return {
            settings,
            categories,
            positive,
            negative,
            past: s.past,
            future: s.future,
            ready: true,
          };
        });
      } catch (e) {
        get().addToast(`初始化失败: ${(e as Error).message}`, "err");
        set((s) => ({ ...s, ready: true }));
      }
    },

    async refreshCategories() {
      try {
        const categories = await api.categories();
        set((s) => ({ categories, cardRefresher: s.cardRefresher + 1 }));
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
    setShowNewCategory: (v) => set({ showNewCategory: v }),
    setShowImport: (v) => set({ showImport: v }),

    addCardBlock(category, name) {
      commit((s) => {
        const sections = zoneSections(s);
        const section = ensureSection(sections, sectionNameForCategory(category));
        section.blocks.push({ id: uid(), type: "card", category, name });
      });
      get().addToast(`已添加 <${category}:${name}>`);
    },

    addPrompt(sectionId, text) {
      const t = text.trim();
      if (!t) return;
      commit((s) => {
        const sections = zoneSections(s);
        const section = sections.find((x) => x.id === sectionId);
        if (section) section.blocks.push({ id: uid(), type: "prompt", text: t });
      });
    },

    addPrompts(sectionId, texts) {
      const items = texts.map((t) => t.trim()).filter(Boolean);
      if (!items.length) return;
      commit((s) => {
        const sections = zoneSections(s);
        const section = sections.find((x) => x.id === sectionId);
        if (section) items.forEach((t) => section.blocks.push({ id: uid(), type: "prompt", text: t }));
      });
    },

    removeBlock(sectionId, blockId) {
      commit((s) => {
        const sections = zoneSections(s);
        const section = sections.find((x) => x.id === sectionId);
        if (section) section.blocks = section.blocks.filter((b) => b.id !== blockId);
      });
    },

    moveBlock(fromSectionId, blockId, toSectionId, index) {
      commit((s) => {
        const sections = zoneSections(s);
        const from = sections.find((x) => x.id === fromSectionId);
        const to = sections.find((x) => x.id === toSectionId) ?? from;
        if (!from) return;
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
        const sections = zoneSections(s);
        const section = sections.find((x) => x.id === sectionId);
        if (section && !section.locked && !DEFAULT_SECTION_NAMES.includes(n)) section.name = n;
      });
    },

    deleteSection(sectionId) {
      commit((s) => {
        const sections = zoneSections(s);
        const section = sections.find((x) => x.id === sectionId);
        if (!section || section.locked) return;
        const other = sections.find((x) => x.name === "其他");
        if (other) other.blocks.push(...section.blocks);
        s[s.zone === "positive" ? "positive" : "negative"] = sections.filter((x) => x.id !== sectionId);
      });
    },

    addSection(name) {
      const n = name.trim();
      if (!n) return;
      commit((s) => {
        const sections = zoneSections(s);
        if (sections.some((x) => x.name === n)) return;
        const section = makeSection(n);
        const last = sections[sections.length - 1];
        if (last?.name === "其他") sections.splice(sections.length - 1, 0, section);
        else sections.push(section);
      });
    },

    clearZone() {
      commit((s) => {
        zoneSections(s).forEach((sec) => (sec.blocks = []));
      });
      get().addToast(`已清空${get().zone === "positive" ? "正面" : "负面"}区域`);
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
      const sections = zoneSections(s);
      const parts: string[] = [];
      for (const section of sections) {
        const text = section.blocks
          .map((b) => (b.type === "card" ? `<${b.category}:${b.name}>` : b.text))
          .filter((t) => t.trim())
          .join(", ");
        if (text.trim()) parts.push(text);
      }
      const raw = parts.join("\n");
      if (!raw.trim()) {
        s.addToast("当前区域没有内容可复制", "err");
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
  };
});
