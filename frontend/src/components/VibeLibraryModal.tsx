import { Check, CheckCircle2, FolderOpen, Pencil, RefreshCw, Sparkles, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api";
import { cn } from "../lib";
import { useStore } from "../store";
import { useGenerateStore } from "../store/generate";
import type { VibeItem } from "../types";
import { Button, IconBtn, Modal } from "./UI";

export function VibeLibraryModal({
  open,
  onClose,
  items,
  onReload,
}: {
  open: boolean;
  onClose: () => void;
  items: VibeItem[];
  onReload: () => void;
}) {
  const addToast = useStore((s) => s.addToast);
  const params = useGenerateStore((s) => s.params);
  const vibes = useGenerateStore((s) => s.vibes);
  const setVibes = useGenerateStore((s) => s.setVibes);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const openFolder = async () => {
    try {
      const r = await api.openVibesFolder();
      addToast(`已打开 Vibe 文件夹：${r.path}`);
    } catch (e) {
      addToast(`打开文件夹失败: ${(e as Error).message}`, "err");
    }
  };

  const pickFile = () => fileRef.current?.click();

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const r = await api.importVibeFile(file);
      addToast(`已导入 Vibe「${r.name}」`);
      onReload();
    } catch (err) {
      addToast(`导入失败: ${(err as Error).message}`, "err");
    } finally {
      setImporting(false);
    }
  };

  const toggle = (it: VibeItem) => {
    if (vibes.some((v) => v.id === it.id)) {
      setVibes(vibes.filter((v) => v.id !== it.id));
      addToast(`已移除 Vibe「${it.name}」`);
    } else {
      setVibes([
        ...vibes,
        {
          id: it.id,
          name: it.name,
          thumbnail: it.thumbnail,
          strength: it.default_strength,
          information_extracted: it.default_information_extracted,
        },
      ]);
      addToast(`已添加 Vibe「${it.name}」`);
    }
  };

  const startRename = (it: VibeItem) => {
    setRenamingId(it.id);
    setRenameValue(it.name);
  };

  const saveRename = async (it: VibeItem) => {
    const newName = renameValue.trim();
    if (!newName) return;
    try {
      await api.renameVibe(it.id, newName);
      // 若该 Vibe 已添加到参数区，同步更新 id 与名称
      if (vibes.some((v) => v.id === it.id)) {
        setVibes(vibes.map((v) => (v.id === it.id ? { ...v, id: newName, name: newName } : v)));
      }
      addToast(`已重命名为「${newName}」`);
      setRenamingId(null);
      onReload();
    } catch (e) {
      addToast(`重命名失败: ${(e as Error).message}`, "err");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Vibe 库" wide>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={pickFile} disabled={importing}>
            <Upload size={13} /> {importing ? "导入中…" : "导入 Vibe"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void openFolder()}>
            <FolderOpen size={13} /> 打开文件夹
          </Button>
          <IconBtn title="刷新列表" onClick={onReload}>
            <RefreshCw size={13} />
          </IconBtn>
        </div>
        <span className="text-xs text-[var(--muted)]">单击添加 · 再次单击移除</span>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".naiv4vibe"
        className="hidden"
        onChange={(e) => void importFile(e)}
      />
      <div className="scroll-thin max-h-[55vh] space-y-1 overflow-y-auto pr-1">
        {items.length === 0 && (
          <p className="py-8 text-center text-xs text-[var(--muted)]">
            Vibe 文件夹为空，可通过「导入 Vibe」选择文件，或「打开文件夹」手动放入 .naiv4vibe 后点刷新
          </p>
        )}
        {items.map((it) => {
          const added = vibes.some((v) => v.id === it.id);
          const compatible = it.models.includes(params.model);
          const renaming = renamingId === it.id;
          return (
            <div
              key={it.id}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors",
                added
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] bg-[var(--input)]/40 hover:bg-[var(--hover)]"
              )}
            >
              {renaming ? (
                <>
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRename(it);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-lg border border-[var(--accent)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none"
                  />
                  <IconBtn title="保存" onClick={() => void saveRename(it)}>
                    <Check size={14} className="text-green-400" />
                  </IconBtn>
                  <IconBtn title="取消" onClick={() => setRenamingId(null)}>
                    <X size={14} />
                  </IconBtn>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => toggle(it)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={added ? `从参数设置移除 ${it.name}` : `添加到参数设置 ${it.name}`}
                  >
                    {it.thumbnail ? (
                      <img
                        src={it.thumbnail}
                        alt=""
                        className="h-9 w-9 shrink-0 rounded-lg border border-[var(--border)] object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--hover)]">
                        <Sparkles size={15} className="text-[var(--muted)]" />
                      </div>
                    )}
                    <span className="truncate text-sm">{it.name}</span>
                    {added && <CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" />}
                    {!compatible && (
                      <span className="shrink-0 text-[10px] text-amber-400" title="当前模型无该 Vibe 的编码">
                        仅支持 V4 模型
                      </span>
                    )}
                  </button>
                  <IconBtn title="重命名" onClick={() => startRename(it)}>
                    <Pencil size={13} />
                  </IconBtn>
                </>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
