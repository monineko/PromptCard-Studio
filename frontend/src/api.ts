import type {
  ImportResult,
  LibraryImages,
  LibrarySummary,
  MoveImagesResult,
  PngInfoResult,
  ReviewApplyResult,
  Section,
  Settings,
} from "./types";

async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(options.headers as Record<string, string>) };
  if (options.body && !(options.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = data?.detail || detail;
    } catch {
      /* ignore */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  categories: () => request<any[]>("/api/categories"),
  saveCategoryOrder: (names: string[]) =>
    request("/api/categories/order", { method: "PUT", body: JSON.stringify({ names }) }),
  saveCategoryColor: (name: string, hue: number) =>
    request("/api/categories/color", { method: "PUT", body: JSON.stringify({ name, hue }) }),
  createCategory: (name: string) =>
    request("/api/categories", { method: "POST", body: JSON.stringify({ name }) }),
  renameCategory: (old_name: string, new_name: string) =>
    request("/api/categories", { method: "PUT", body: JSON.stringify({ old_name, new_name }) }),
  deleteCategory: (name: string) =>
    request(`/api/categories?name=${encodeURIComponent(name)}`, { method: "DELETE" }),
  cardContent: (category: string, name: string) =>
    request(`/api/cards/content?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`),
  createCard: (category: string, name: string, content: string) =>
    request("/api/cards", { method: "POST", body: JSON.stringify({ category, name, content }) }),
  updateCard: (category: string, name: string, content: string, new_category?: string, new_name?: string) =>
    request("/api/cards", {
      method: "PUT",
      body: JSON.stringify({ category, name, content, new_category, new_name }),
    }),
  cardImages: () => request<Record<string, string>>("/api/cards/images"),
  setCardImage: (category: string, name: string, path: string) =>
    request("/api/cards/image", {
      method: "PUT",
      body: JSON.stringify({ category, name, path }),
    }),
  removeCardImage: (category: string, name: string) =>
    request(
      `/api/cards/image?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`,
      { method: "DELETE" }
    ),
  deleteCard: (category: string, name: string) =>
    request(`/api/cards?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  expand: (text: string) => request<{ text: string }>("/api/cards/expand", { method: "POST", body: JSON.stringify({ text }) }),
  importFile: (kind: string, file: File) => {
    const fd = new FormData();
    fd.append("kind", kind);
    fd.append("file", file);
    return fetch("/api/cards/import", { method: "POST", body: fd }).then((r) => r.json());
  },
  importAnr: (path: string) => request("/api/cards/import-anr", { method: "POST", body: JSON.stringify({ path }) }),
  exportUrl: () => "/api/cards/export",
  workspace: () => request<{ positive: Section[]; negative: Section[] }>("/api/workspace"),
  saveWorkspace: (positive: Section[], negative: Section[]) =>
    request("/api/workspace", { method: "PUT", body: JSON.stringify({ positive, negative }) }),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Partial<Settings>) =>
    request("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
  librarySummary: () => request<LibrarySummary>("/api/library/summary"),
  libraryImages: (category: string) =>
    request<LibraryImages>(`/api/library/images?category=${encodeURIComponent(category)}`),
  libraryImageUrl: (path: string) => `/api/library/image?path=${encodeURIComponent(path)}`,
  libraryPngInfo: (path: string) =>
    request<PngInfoResult>(`/api/library/png-info?path=${encodeURIComponent(path)}`),
  applyReview: (moves: { path: string; tag: string }[], recycleReject: boolean) =>
    request<ReviewApplyResult>("/api/library/review/apply", {
      method: "POST",
      body: JSON.stringify({ moves, recycle_reject: recycleReject }),
    }),
  undoReview: (token: string) =>
    request<{ ok: boolean; restored: { path: string }[]; failed: { path: string; reason: string }[] }>(
      "/api/library/review/undo",
      { method: "POST", body: JSON.stringify({ token }) }
    ),
  importLibraryFiles: (files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    return request<ImportResult>("/api/library/import", { method: "POST", body: fd });
  },
  importLibraryPath: (path: string) =>
    request<ImportResult>("/api/library/import-path", { method: "POST", body: JSON.stringify({ path }) }),
  openLibraryFolder: () =>
    request<{ ok: boolean; path: string }>("/api/library/open-folder", { method: "POST" }),
  moveImages: (paths: string[], target: string) =>
    request<MoveImagesResult>("/api/library/move", {
      method: "POST",
      body: JSON.stringify({ paths, target }),
    }),
  deleteImages: (paths: string[]) =>
    request<{ ok: boolean; deleted: { path: string; mode: string }[]; skipped: { path: string; reason: string }[]; message: string }>(
      "/api/library/delete",
      { method: "POST", body: JSON.stringify({ paths }) }
    ),
  libraryCovers: () => request<Record<string, string>>("/api/library/covers"),
  setLibraryCover: (category: string, path: string) =>
    request("/api/library/covers", {
      method: "PUT",
      body: JSON.stringify({ category, path }),
    }),
  removeLibraryCover: (category: string) =>
    request(`/api/library/covers?category=${encodeURIComponent(category)}`, { method: "DELETE" }),
  backgrounds: () =>
    request<{ images: { name: string; url: string }[]; folder: string }>("/api/backgrounds"),
  openBackgroundsFolder: () =>
    request<{ ok: boolean; path: string }>("/api/backgrounds/open-folder", { method: "POST" }),
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
