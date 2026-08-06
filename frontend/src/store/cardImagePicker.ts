import { create } from "zustand";

export type PendingCard = { category: string; name: string } | null;

interface CardImagePickerState {
  /** 正在等待选择演示图片的卡片（跳转到图库"全部"后点击图片选择） */
  pendingCard: PendingCard;
  startPick: (category: string, name: string) => void;
  cancelPick: () => void;
}

export const useCardImagePicker = create<CardImagePickerState>((set) => ({
  pendingCard: null,
  startPick: (category, name) => set({ pendingCard: { category, name } }),
  cancelPick: () => set({ pendingCard: null }),
}));
