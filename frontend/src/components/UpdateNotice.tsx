import { Download, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./UI";
import { APP_VERSION, fetchLatestRelease, isNewerVersion, type LatestRelease } from "../update";

const DISMISSED_KEY = "promptcard:update-dismissed";

export function UpdateNotice() {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetchLatestRelease(controller.signal)
      .then((next) => {
        const dismissed = localStorage.getItem(DISMISSED_KEY);
        if (isNewerVersion(next.version) && dismissed !== next.version) setRelease(next);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  if (!release || closed) return null;
  const packageAsset = release.assets.find((asset) => /win64\.zip$/i.test(asset.name));
  return (
    <div className="fixed right-4 top-16 z-[90] w-[min(25rem,calc(100vw-2rem))] rounded-2xl border border-[var(--accent)]/45 bg-[var(--panel)]/95 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-start gap-3">
        <Download size={18} className="mt-0.5 shrink-0 text-[var(--accent)]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">发现新版本 {release.version}</div>
          <div className="mt-1 text-xs text-[var(--muted)]">当前版本 {APP_VERSION} · 请下载新包后迁移用户数据</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {packageAsset && <Button size="sm" onClick={() => window.open(packageAsset.url, "_blank")}>下载便携包</Button>}
            <Button size="sm" variant="ghost" onClick={() => window.open(release.htmlUrl, "_blank")}>查看更新说明</Button>
          </div>
        </div>
        <button
          className="rounded-md p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          title="忽略此版本"
          onClick={() => {
            localStorage.setItem(DISMISSED_KEY, release.version);
            setClosed(true);
          }}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
