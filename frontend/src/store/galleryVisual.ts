import { create } from "zustand";
import { DEFAULT_BACKDROPS } from "../assets/backgrounds";

export type Backdrop = { key: string; url: string };
export type Burst = { id: number; x: number; y: number };

interface GalleryVisualState {
  /** 全屏模糊背景轮播的图片队列 */
  backdrops: Backdrop[];
  /** 待触发的点击烟花（坐标） */
  bursts: Burst[];
  setBackdrops: (backdrops: Backdrop[]) => void;
  resetBackdrops: () => void;
  fire: (x: number, y: number) => void;
}

let burstSeq = 1;

export const useGalleryVisual = create<GalleryVisualState>((set) => ({
  backdrops: DEFAULT_BACKDROPS,
  bursts: [],
  setBackdrops: (backdrops) => set({ backdrops }),
  resetBackdrops: () => set({ backdrops: DEFAULT_BACKDROPS }),
  fire: (x, y) => {
    const id = burstSeq++;
    set((s) => ({ bursts: [...s.bursts, { id, x, y }] }));
    // 烟花组件在绘制完成后自身会清理；这里兜底移除，防止队列无限增长
    window.setTimeout(() => {
      set((s) => ({ bursts: s.bursts.filter((b) => b.id !== id) }));
    }, 2400);
  },
}));
