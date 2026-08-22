import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { VibeLibraryModal } from "../components/VibeLibraryModal";
import { useStore } from "../store";
import type { VibeFolder, VibeItem } from "../types";

export function VibeManager() {
  const navigate = useNavigate();
  const addToast = useStore((s) => s.addToast);
  const [items, setItems] = useState<VibeItem[]>([]);
  const [folders, setFolders] = useState<VibeFolder[]>([]);

  const reload = () => {
    Promise.all([api.vibes(), api.vibeFolders()])
      .then(([nextItems, nextFolders]) => {
        setItems(nextItems);
        setFolders(nextFolders);
      })
      .catch((e) => addToast(`读取 Vibe 库失败: ${(e as Error).message}`, "err"));
  };

  useEffect(() => {
    reload();
  }, []);

  return (
    <VibeLibraryModal
      open
      onClose={() => navigate("/")}
      items={items}
      folders={folders}
      onReload={reload}
      title="Vibe 管理"
    />
  );
}
