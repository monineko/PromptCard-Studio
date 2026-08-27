import { ImagePlus } from "lucide-react";
import { DismissibleNotice } from "../DismissibleNotice";

const DISMISSED_KEY = "promptcard:library-drag-import-notice-dismissed";

export function LibraryDragImportNotice({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <DismissibleNotice
      storageKey={DISMISSED_KEY}
      title="现在可以直接拖图导入"
      icon={<ImagePlus size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" />}
      topClassName="top-36"
    >
      将桌面、资源管理器、聊天软件或网页中的图片拖到图片库；拖到相册卡片可直接导入对应分类。
    </DismissibleNotice>
  );
}
