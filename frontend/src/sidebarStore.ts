import { create } from "zustand";

export type SidebarGroup = {
  key: string;
  label: string;
  count: number;
  children?: SidebarGroup[];
};

const OPEN_KEY = "npm_sidebar_open";

interface SidebarState {
  open: boolean;
  groups: SidebarGroup[];
  activeGroup: string | null;
  reviewAvailable: boolean;
  scrollTo: ((key: string) => void) | null;
  startReview: (() => void) | null;
  startQuickPick: (() => void) | null;

  setOpen: (v: boolean) => void;
  setGroups: (groups: SidebarGroup[]) => void;
  setActiveGroup: (key: string | null) => void;
  setReviewAvailable: (v: boolean) => void;
  registerGallery: (h: {
    scrollTo: (key: string) => void;
    startReview: () => void;
    startQuickPick: () => void;
  }) => void;
  unregisterGallery: () => void;
}

function initialOpen(): boolean {
  try {
    const saved = localStorage.getItem(OPEN_KEY);
    if (saved !== null) return saved === "1";
  } catch {
    /* ignore */
  }
  return false;
}

export const useSidebarStore = create<SidebarState>((set) => ({
  open: initialOpen(),
  groups: [],
  activeGroup: null,
  reviewAvailable: false,
  scrollTo: null,
  startReview: null,
  startQuickPick: null,

  setOpen: (open) => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
    set({ open });
  },
  setGroups: (groups) => set({ groups }),
  setActiveGroup: (activeGroup) => set({ activeGroup }),
  setReviewAvailable: (reviewAvailable) => set({ reviewAvailable }),
  registerGallery: (h) =>
    set({ scrollTo: h.scrollTo, startReview: h.startReview, startQuickPick: h.startQuickPick }),
  unregisterGallery: () => set({ scrollTo: null, startReview: null, startQuickPick: null }),
}));
