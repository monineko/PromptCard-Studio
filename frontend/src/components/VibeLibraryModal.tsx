import { Check, CheckCircle2, FolderOpen, FolderPlus, Pencil, RefreshCw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../api";
import { cn } from "../lib";
import { useStore } from "../store";
import { useGenerateStore } from "../store/generate";
import type { GenerateParamsPayload, GenerateVibe, VibeFolder, VibeItem } from "../types";
import { Button, IconBtn, Modal } from "./UI";

export function VibeLibraryModal({ open, onClose, items, folders, onReload, title = "添加 Vibe", params: suppliedParams, vibes: suppliedVibes, onSetVibes }: {
  open: boolean;
  onClose: () => void;
  items: VibeItem[];
  folders: VibeFolder[];
  onReload: () => void;
  title?: string;
  params?: GenerateParamsPayload;
  vibes?: GenerateVibe[];
  onSetVibes?: (vibes: GenerateVibe[]) => void;
}) {
  const addToast = useStore((s) => s.addToast);
  const globalParams = useGenerateStore((s) => s.params);
  const globalVibes = useGenerateStore((s) => s.vibes);
  const setGlobalVibes = useGenerateStore((s) => s.setVibes);
  const params = suppliedParams ?? globalParams;
  const vibes = suppliedVibes ?? globalVibes;
  const setVibes = onSetVibes ?? setGlobalVibes;
  const [selectedFolder, setSelectedFolder] = useState("其他");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const currentFolder = folders.some((folder) => folder.name === selectedFolder) ? selectedFolder : folders[0]?.name || "其他";
  const visibleItems = items.filter((item) => item.folder === currentFolder);
  const currentFolderInfo = folders.find((folder) => folder.name === currentFolder);

  const openFolder = async () => {
    try {
      const r = await api.openVibesFolder();
      addToast(`已打开 Vibe 文件夹：${r.path}`);
    } catch (e) {
      addToast(`打开文件夹失败: ${(e as Error).message}`, "err");
    }
  };

  const importFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const r = await api.importVibeFile(file, currentFolder);
      addToast(`已导入 Vibe「${r.name}」到「${currentFolderInfo?.label || currentFolder}」`);
      onReload();
    } catch (err) {
      addToast(`导入失败: ${(err as Error).message}`, "err");
    } finally {
      setImporting(false);
    }
  };

  const addFolder = async () => {
    const name = window.prompt("请输入新 Vibe 文件夹名称");
    if (!name?.trim()) return;
    try {
      const folder = await api.createVibeFolder(name.trim());
      setSelectedFolder(folder.name);
      addToast(`已创建 Vibe 文件夹「${folder.name}」`);
      onReload();
    } catch (e) {
      addToast(`创建文件夹失败: ${(e as Error).message}`, "err");
    }
  };

  const renameFolder = async () => {
    if (!currentFolderInfo || currentFolderInfo.default) return;
    const name = window.prompt("请输入新的文件夹名称", currentFolder);
    if (!name?.trim() || name.trim() === currentFolder) return;
    try {
      const folder = await api.renameVibeFolder(currentFolder, name.trim());
      setSelectedFolder(folder.name);
      addToast(`已重命名文件夹为「${folder.name}」`);
      onReload();
    } catch (e) {
      addToast(`重命名文件夹失败: ${(e as Error).message}`, "err");
    }
  };

  const deleteFolder = async () => {
    if (!currentFolderInfo || currentFolderInfo.default) return;
    if (!window.confirm(`确定删除文件夹「${currentFolder}」及其中的 Vibe 吗？`)) return;
    try {
      await api.deleteVibeFolder(currentFolder);
      setSelectedFolder(folders.find((folder) => folder.default)?.name || "其他");
      addToast(`已删除文件夹「${currentFolder}」`);
      onReload();
    } catch (e) {
      addToast(`删除文件夹失败: ${(e as Error).message}`, "err");
    }
  };

  const toggle = (it: VibeItem) => {
    if (vibes.some((v) => v.id === it.id)) {
      setVibes(vibes.filter((v) => v.id !== it.id));
      addToast(`已移除 Vibe「${it.name}」`);
      return;
    }
    if (params.model === "nai-diffusion-5-full" || params.model === "nai-diffusion-5-curated") {
      addToast("NAI 5 当前不支持 Vibe，请切换到 V4/V4.5 模型后再添加", "err");
      return;
    }
    if (!it.models.includes(params.model)) {
      addToast(`Vibe「${it.name}」没有当前模型的编码，无法添加`, "err");
      return;
    }
    setVibes([...vibes, { id: it.id, name: it.name, thumbnail: it.thumbnail, strength: it.default_strength, information_extracted: it.default_information_extracted }]);
    addToast(`已添加 Vibe「${it.name}」`);
  };

  const startRename = (it: VibeItem) => {
    setRenamingId(it.id);
    setRenameValue(it.name);
  };

  const saveRename = async (it: VibeItem) => {
    const newName = renameValue.trim();
    if (!newName) return;
    try {
      const result = await api.renameVibe(it.id, newName);
      if (vibes.some((v) => v.id === it.id)) setVibes(vibes.map((v) => (v.id === it.id ? { ...v, id: result.id, name: newName } : v)));
      addToast(`已重命名为「${newName}」`);
      setRenamingId(null);
      onReload();
    } catch (e) {
      addToast(`重命名失败: ${(e as Error).message}`, "err");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={importing}><Upload size={13} /> {importing ? "导入中…" : "导入 NovelAI 生成的 Vibe"}</Button>
          <Button size="sm" variant="ghost" onClick={() => void addFolder()}><FolderPlus size={13} /> 新建文件夹</Button>
          {!currentFolderInfo?.default && <><IconBtn title="重命名文件夹" onClick={() => void renameFolder()}><Pencil size={13} /></IconBtn><IconBtn title="删除文件夹" onClick={() => void deleteFolder()}><Trash2 size={13} /></IconBtn></>}
          <Button size="sm" variant="ghost" onClick={() => void openFolder()}><FolderOpen size={13} /> 打开本地文件夹</Button>
          <IconBtn title="刷新列表" onClick={onReload}><RefreshCw size={13} /></IconBtn>
        </div>
        <span className="text-xs text-[var(--muted)]">单击添加 · 再次单击移除</span>
      </div>
      <input ref={fileRef} type="file" accept=".naiv4vibe" className="hidden" onChange={(e) => void importFile(e)} />
      <div className="mb-3 flex flex-wrap gap-1.5 border-b border-[var(--border)] pb-2">
        {folders.map((folder) => <button key={folder.name} type="button" onClick={() => setSelectedFolder(folder.name)} className={cn("rounded-lg px-2.5 py-1.5 text-xs transition-colors", currentFolder === folder.name ? "bg-[var(--accent)] text-white" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]")}>{folder.label}</button>)}
      </div>
      <div className="scroll-thin max-h-[55vh] space-y-1 overflow-y-auto pr-1">
        {visibleItems.length === 0 && <p className="py-8 text-center text-xs text-[var(--muted)]">当前文件夹为空，可通过「导入 NovelAI 生成的 Vibe」选择文件，或放入项目根目录 vibes/{currentFolder} 后点刷新。</p>}
        {visibleItems.map((it) => {
          const added = vibes.some((v) => v.id === it.id);
          const compatible = it.models.includes(params.model);
          const renaming = renamingId === it.id;
          return <div key={it.id} className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-2 transition-colors", added ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--input)]/40 hover:bg-[var(--hover)]")}>
            {renaming ? <><input autoFocus value={renameValue} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveRename(it); if (e.key === "Escape") setRenamingId(null); }} className="min-w-0 flex-1 rounded-lg border border-[var(--accent)] bg-[var(--input)] px-2.5 py-1.5 text-sm outline-none" /><IconBtn title="保存" onClick={() => void saveRename(it)}><Check size={14} className="text-green-400" /></IconBtn><IconBtn title="取消" onClick={() => setRenamingId(null)}><X size={14} /></IconBtn></> : <><button type="button" onClick={() => toggle(it)} className="flex min-w-0 flex-1 items-center gap-2 text-left" title={added ? `从参数设置移除 ${it.name}` : `添加到参数设置 ${it.name}`}>
              {it.thumbnail ? <img src={it.thumbnail} alt="" className="h-9 w-9 shrink-0 rounded-lg border border-[var(--border)] object-cover" /> : <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--hover)]"><Sparkles size={15} className="text-[var(--muted)]" /></div>}
              <span className="truncate text-sm">{it.name}</span>{added && <CheckCircle2 size={13} className="shrink-0 text-[var(--accent)]" />}{!compatible && <span className="shrink-0 text-[10px] text-amber-400" title="当前模型无该 Vibe 的编码">当前模型不可用</span>}
            </button><IconBtn title="重命名" onClick={() => startRename(it)}><Pencil size={13} /></IconBtn></>}
          </div>;
        })}
      </div>
    </Modal>
  );
}
