import type { Backdrop } from "../store/galleryVisual";
import bg1 from "./backgrounds/bg-1.jpg";
import bg2 from "./backgrounds/bg-2.jpg";
import bg3 from "./backgrounds/bg-3.png";

/** 全局默认背景轮播素材（用户提供的三张插画） */
export const DEFAULT_BACKDROPS: Backdrop[] = [
  { key: "default-bg-1", url: bg1 },
  { key: "default-bg-2", url: bg2 },
  { key: "default-bg-3", url: bg3 },
];
