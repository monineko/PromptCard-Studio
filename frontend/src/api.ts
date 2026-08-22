import type {
  ImportResult,
  GenerateMeta,
  GenerateStatus,
  BatchRun,
  BatchStartPayload,
  BatchStatusResponse,
  PngSendResult,
  LibraryImages,
  LibrarySummary,
  MoveImagesResult,
  PngInfoResult,
  PublishEngineStatus,
  PublishPlugin,
  PublishNodes,
  PublishStagedItem,
  PublishRunStatus,
  ReviewApplyResult,
  Section,
  Settings,
  Text2ImageResult,
  VibeItem,
  VibeFolder,
  WorkspaceData,
  DictionaryStatus,
  DictionaryEntry,
  StyleExplorePool,
  StyleExplorePoolSummary,
  StyleExploreRun,
  StyleExploreRunCreatePayload,
  StyleExploreRunSummary,
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
  pinCard: (category: string, name: string) =>
    request<{ ok: boolean }>("/api/cards/pin", {
      method: "POST",
      body: JSON.stringify({ category, name }),
    }),
  deleteCard: (category: string, name: string) =>
    request(`/api/cards?category=${encodeURIComponent(category)}&name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  expand: (text: string) => request<{ text: string }>("/api/cards/expand", { method: "POST", body: JSON.stringify({ text }) }),
  importFile: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<ImportResult>("/api/cards/import", { method: "POST", body: fd });
  },
  importTemplateUrl: () => "/api/cards/import-template",
  exportUrl: () => "/api/cards/export",
  workspace: () => request<WorkspaceData>("/api/workspace"),
  saveWorkspace: (positive: Section[], negative: Section[], back_note = "") =>
    request("/api/workspace", {
      method: "PUT",
      body: JSON.stringify({ positive, negative, back_note }),
    }),
  dictBatch: (terms: string[]) =>
    request<Record<string, DictionaryEntry>>("/api/dictionary/batch", {
      method: "POST",
      body: JSON.stringify({ terms }),
    }),
  dictSave: (term: string, cn: string) =>
    request<{ ok: boolean; count: number }>("/api/dictionary/save", {
      method: "POST",
      body: JSON.stringify({ term, cn }),
    }),
  dictStatus: () => request<DictionaryStatus>("/api/dictionary/status"),
  openDictionaryFolder: () =>
    request<{ ok: boolean; path: string }>("/api/dictionary/open-folder", { method: "POST" }),
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
  generateMeta: () => request<GenerateMeta>("/api/generate/meta"),
  vibes: () => request<VibeItem[]>("/api/vibes"),
  vibeFolders: () => request<VibeFolder[]>("/api/vibes/folders"),
  createVibeFolder: (name: string) =>
    request<VibeFolder>("/api/vibes/folders", { method: "POST", body: JSON.stringify({ name }) }),
  renameVibeFolder: (name: string, new_name: string) =>
    request<VibeFolder>("/api/vibes/folders/rename", {
      method: "POST",
      body: JSON.stringify({ name, new_name }),
    }),
  deleteVibeFolder: (name: string) =>
    request<{ ok: boolean; name: string }>(`/api/vibes/folders?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  renameVibe: (id: string, name: string) =>
    request<{ ok: boolean; id: string; name: string }>("/api/vibes/rename", {
      method: "POST",
      body: JSON.stringify({ id, name }),
    }),
  openVibesFolder: () =>
    request<{ ok: boolean; path: string }>("/api/vibes/open-folder", { method: "POST" }),
  generateStatus: () => request<GenerateStatus>("/api/generate/status"),
  generateAnlas: () => request<{ anlas: number | null; error: string | null }>("/api/generate/anlas"),
  saveGenerateToken: (token: string) =>
    request<{ ok: boolean; configured: boolean }>("/api/generate/token", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  text2image: (prompt: string, negative_prompt: string, params: Record<string, unknown>) =>
    request<Text2ImageResult>("/api/generate/text2image", {
      method: "POST",
      body: JSON.stringify({ prompt, negative_prompt, params }),
    }),
  batchStatus: () => request<BatchStatusResponse>("/api/generate/batch"),
  batchStart: (payload: BatchStartPayload) =>
    request<BatchRun>("/api/generate/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  batchPause: () =>
    request<{ ok: boolean; message: string }>("/api/generate/batch/pause", { method: "POST" }),
  batchResume: () => request<BatchRun>("/api/generate/batch/resume", { method: "POST" }),
  batchEnd: () =>
    request<{ ok: boolean; message: string; summary: { total: number; done: number } }>(
      "/api/generate/batch/end",
      { method: "POST" }
    ),
  styleExplorePools: () => request<StyleExplorePoolSummary[]>("/api/style-explore/pools"),
  styleExplorePool: (poolId: string) => request<StyleExplorePool>(`/api/style-explore/pools/${encodeURIComponent(poolId)}`),
  styleExploreCreatePool: (name: string, content: string) =>
    request<StyleExplorePoolSummary>("/api/style-explore/pools", {
      method: "POST",
      body: JSON.stringify({ name, content }),
    }),
  styleExploreImportPool: (file: File, name = "") => {
    const fd = new FormData();
    fd.append("file", file);
    if (name.trim()) fd.append("name", name.trim());
    return request<StyleExplorePoolSummary>("/api/style-explore/pools/import", { method: "POST", body: fd });
  },
  styleExploreUpdatePool: (poolId: string, content: string, name?: string) =>
    request<StyleExplorePoolSummary>(`/api/style-explore/pools/${encodeURIComponent(poolId)}`, {
      method: "PUT",
      body: JSON.stringify({ content, ...(name === undefined ? {} : { name }) }),
    }),
  styleExploreRuns: () => request<StyleExploreRunSummary[]>("/api/style-explore/runs"),
  styleExploreRun: (runId: string) => request<StyleExploreRun>(`/api/style-explore/runs/${encodeURIComponent(runId)}`),
  styleExploreCreateRun: (payload: StyleExploreRunCreatePayload) =>
    request<StyleExploreRun>("/api/style-explore/runs", { method: "POST", body: JSON.stringify(payload) }),
  styleExploreStartRun: (runId: string) =>
    request<StyleExploreRun>(`/api/style-explore/runs/${encodeURIComponent(runId)}/start`, { method: "POST" }),
  styleExplorePauseRun: (runId: string) =>
    request<StyleExploreRun>(`/api/style-explore/runs/${encodeURIComponent(runId)}/pause`, { method: "POST" }),
  styleExploreResumeRun: (runId: string) =>
    request<StyleExploreRun>(`/api/style-explore/runs/${encodeURIComponent(runId)}/resume`, { method: "POST" }),
  styleExploreCancelRun: (runId: string) =>
    request<StyleExploreRun>(`/api/style-explore/runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  styleExploreUpdateCandidate: (runId: string, candidateId: string, patch: { generation?: Record<string, unknown>; review?: Record<string, unknown> }) =>
    request<StyleExploreRun["candidates"][number]>(`/api/style-explore/runs/${encodeURIComponent(runId)}/candidates/${encodeURIComponent(candidateId)}`, {
      method: "PATCH", body: JSON.stringify(patch),
    }),
  styleExploreCandidateImageUrl: (runId: string, candidateId: string) =>
    `/api/style-explore/runs/${encodeURIComponent(runId)}/image?candidate_id=${encodeURIComponent(candidateId)}`,
  pngSend: (png: unknown, model: string) =>
    request<PngSendResult>("/api/generate/from-png", {
      method: "POST",
      body: JSON.stringify({ png, model }),
    }),
  vibeImport: (payload: {
    name?: string;
    encoding: string;
    strength: number;
    information_extracted?: number | null;
    model: string;
    folder?: string;
  }) =>
    request<{ ok: boolean; id: string; name: string }>("/api/vibes/import", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importVibeFile: (file: File, folder = "") => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    return request<{ ok: boolean; id: string; name: string }>("/api/vibes/import-file", {
      method: "POST",
      body: fd,
    });
  },
  migrateUserData: (files: File[], paths: string[]) => {
    const fd = new FormData();
    files.forEach((file) => fd.append("files", file));
    fd.append("paths", JSON.stringify(paths));
    return request<{
      copied: number;
      overwritten: number;
      skipped: number;
      ignored: number;
      errors: string[];
      backup: string | null;
    }>("/api/migration/user-data", { method: "POST", body: fd });
  },
  systemShutdown: () =>
    request<{ ok: boolean; message: string }>("/api/system/shutdown", { method: "POST" }),
  systemRestart: () =>
    request<{ ok: boolean; message: string }>("/api/system/restart", { method: "POST" }),
  publishEngine: () => request<PublishEngineStatus>("/api/publish/engine"),
  publishEngineInstall: () =>
    request<{ ok: boolean; installing: boolean; message: string }>("/api/publish/engine/install", {
      method: "POST",
    }),
  publishEngineLocalPath: (path: string) =>
    request<{ ok: boolean; custom_path: string }>("/api/publish/engine/local-path", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  publishEngineParams: (engine: string, params: Record<string, string | number | boolean>) =>
    request<{ ok: boolean; engine: string; params: Record<string, string | number | boolean> }>(
      "/api/publish/engine/params",
      { method: "POST", body: JSON.stringify({ engine, params }) }
    ),
  publishRenamePreview: (rename: { parts: string[]; custom?: string; random_length?: number }) =>
    request<{ samples: string[] }>("/api/publish/rename-preview", {
      method: "POST",
      body: JSON.stringify({ rename }),
    }),
  publishRun: (payload: {
    staged: string[];
    nodes: PublishNodes;
    rename: { parts: string[]; custom?: string; random_length?: number };
    engine_params: Record<string, string | number | boolean>;
    mosaic_params: Record<string, string | number | boolean | string[]>;
  }) =>
    request<{ id: string; total: number }>("/api/publish/run", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  publishRunStatus: (id: string) => request<PublishRunStatus>(`/api/publish/run/${id}`),
  publishRunOpen: (id: string) =>
    request<{ ok: boolean; path: string }>(`/api/publish/run/${id}/open-folder`, { method: "POST" }),
  publishRunFileUrl: (id: string, name: string) =>
    `/api/publish/run/${id}/file?name=${encodeURIComponent(name)}`,
  publishRunDelete: (id: string) =>
    request<{ ok: boolean }>(`/api/publish/run/${id}`, { method: "DELETE" }),
  publishStage: (paths: string[]) =>
    request<{ added: number; skipped: number; count: number; errors: string[] }>(
      "/api/publish/staging",
      { method: "POST", body: JSON.stringify({ paths }) }
    ),
  publishStaging: () => request<{ items: PublishStagedItem[]; count: number }>("/api/publish/staging"),
  publishStagingFileUrl: (name: string) =>
    `/api/publish/staging/file?name=${encodeURIComponent(name)}`,
  publishStagedDelete: (name: string) =>
    request<{ ok: boolean; count: number }>(`/api/publish/staging?name=${encodeURIComponent(name)}`, {
      method: "DELETE",
    }),
  publishStagingClear: () =>
    request<{ ok: boolean; removed: number }>("/api/publish/staging/clear", { method: "POST" }),
  plugins: () => request<{ plugins: PublishPlugin[] }>("/api/plugins"),
  pluginInstall: (id: string) =>
    request<{ ok: boolean; installing: boolean; message: string }>(`/api/plugins/${id}/install`, {
      method: "POST",
    }),
  pluginUninstall: (id: string) =>
    request<{ ok: boolean; removed: boolean }>(`/api/plugins/${id}/uninstall`, { method: "POST" }),
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
