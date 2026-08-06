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
  workspace: () => request<{ positive: Block[]; negative: Block[] }>("/api/workspace"),
  saveWorkspace: (positive: Block[], negative: Block[]) =>
    request("/api/workspace", { method: "PUT", body: JSON.stringify({ positive, negative }) }),
  settings: () => request<Settings>("/api/settings"),
  saveSettings: (settings: Partial<Settings>) =>
    request("/api/settings", { method: "PUT", body: JSON.stringify(settings) }),
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
