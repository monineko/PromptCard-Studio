import { create } from "zustand";

interface NavState {
  /** 每次点击顶部"图片库"标签递增：图库页据此回到分类首页 */
  libraryHomeTick: number;
  goLibraryHome: () => void;
  clearLibraryHome: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  libraryHomeTick: 0,
  goLibraryHome: () => set((s) => ({ libraryHomeTick: s.libraryHomeTick + 1 })),
  clearLibraryHome: () => set({ libraryHomeTick: 0 }),
}));
