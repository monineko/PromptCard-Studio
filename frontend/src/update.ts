export const APP_VERSION = "1.2.3";
export const GITHUB_REPOSITORY = "monineko/PromptCard-Studio";
const RELEASE_API = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;

export type LatestRelease = {
  version: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: string | null;
  assets: { name: string; url: string; size: number }[];
};

function parseVersion(value: string): number[] | null {
  const match = value.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function isNewerVersion(remote: string, local = APP_VERSION): boolean {
  const a = parseVersion(remote);
  const b = parseVersion(local);
  if (!a || !b) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] === b[index]) continue;
    return a[index] > b[index];
  }
  return false;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<LatestRelease> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    const response = await fetch(RELEASE_API, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const data = await response.json();
    if (data.draft || data.prerelease || typeof data.tag_name !== "string") {
      throw new Error("没有可用的正式版本");
    }
    return {
      version: data.tag_name,
      name: data.name || data.tag_name,
      body: data.body || "暂无更新说明",
      htmlUrl: data.html_url,
      publishedAt: data.published_at || null,
      assets: Array.isArray(data.assets)
        ? data.assets.map((asset: any) => ({ name: asset.name, url: asset.browser_download_url, size: asset.size }))
        : [],
    };
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
