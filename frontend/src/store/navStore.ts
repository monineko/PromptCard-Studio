import { create } from "zustand";

export type LibraryTarget = {
  category: string;
  date?: string;
};

interface NavState {
  /** 每次点击顶部"图片库"标签递增：图库页据此回到分类首页 */
  libraryHomeTick: number;
  goLibraryHome: () => void;
  clearLibraryHome: () => void;
  /** 从首页「去图库」跳转：进入指定分类并滚动到对应日期分组 */
  libraryTarget: LibraryTarget | null;
  setLibraryTarget: (target: LibraryTarget) => void;
  consumeLibraryTarget: () => void;
}

export const useNavStore = create<NavState>((set) => ({
  libraryHomeTick: 0,
  goLibraryHome: () => set((s) => ({ libraryHomeTick: s.libraryHomeTick + 1 })),
  clearLibraryHome: () => set({ libraryHomeTick: 0 }),
  libraryTarget: null,
  setLibraryTarget: (target) => set({ libraryTarget: target }),
  consumeLibraryTarget: () => set({ libraryTarget: null }),
}));
