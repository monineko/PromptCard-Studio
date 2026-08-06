import { ChevronDown, FileJson, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { useLightboxState } from "yet-another-react-lightbox";
import { api } from "../../api";
import type { LibraryImageItem, PngInfoResult } from "../../types";

/**
 * 灯箱 caption 详情面板：点“读取 PNG 信息”才解析，展示完整 JSON，
 * 并提供“发送到工作区”（覆盖前由页面做确认）。
 */
export function PngPanel({
  slides,
  onSendToWorkspace,
}: {
  slides: LibraryImageItem[];
  onSendToWorkspace: (prompt: string, uc: string) => void;
}) {
  const { currentIndex } = useLightboxState();
  const slide = slides[currentIndex];
  const [info, setInfo] = useState<PngInfoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    setInfo(null);
    setError("");
    setShowRaw(false);
  }, [currentIndex, slide?.path]);

  if (!slide) return null;

  const readInfo = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api.libraryPngInfo(slide.path);
      setInfo(result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const summary = info?.summary;

  return (
    <div className="max-w-xl text-left text-sm text-[var(--text)]">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="truncate font-medium">{slide.name}</span>
        {!info && (
          <button
            onClick={readInfo}
            disabled={loading}
            className="flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-xs text-white transition-opacity hover:opacity-85 disabled:opacity-50"
            style={{ background: "var(--accent)" }}
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <FileJson size={13} />}
            读取 PNG 信息
          </button>
        )}
      </div>

      {error && <p className="mb-1 text-xs text-red-400">{error}</p>}

      {info && !error && (
        <div className="space-y-2">
          {summary?.prompt && (
            <div>
              <div className="mb-0.5 text-xs font-semibold text-[var(--accent)]">正面提示词</div>
              <div className="max-h-28 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs leading-relaxed">
                {summary.prompt}
              </div>
            </div>
          )}
          {summary?.uc && (
            <div>
              <div className="mb-0.5 text-xs font-semibold text-red-300">负面提示词</div>
              <div className="max-h-24 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs leading-relaxed">
                {summary.uc}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
            {summary?.width != null && <span>宽 {summary.width}</span>}
            {summary?.height != null && <span>高 {summary.height}</span>}
            {summary?.seed != null && <span>种子 {summary.seed}</span>}
            {summary?.sampler && <span>采样器 {summary.sampler}</span>}
            {summary?.steps != null && <span>步数 {summary.steps}</span>}
            {summary?.scale != null && <span>CFG {summary.scale}</span>}
            {info.source && <span>来源 {info.source}</span>}
            {info.generation_time && <span>生成时间 {info.generation_time}</span>}
          </div>

          <button
            onClick={() => setShowRaw((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-[var(--muted)] hover:text-[var(--text)]"
          >
            <ChevronDown size={12} className={showRaw ? "rotate-180" : ""} />
            {showRaw ? "收起" : "查看"}完整 JSON
          </button>
          {showRaw && (
            <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
              {JSON.stringify(info.parsed ?? info.raw, null, 2)}
            </pre>
          )}

          {summary?.prompt && (
            <button
              onClick={() => onSendToWorkspace(summary.prompt ?? "", summary.uc ?? "")}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs text-white transition-opacity hover:opacity-85"
              style={{ background: "var(--accent)" }}
            >
              <Send size={13} />
              发送到工作区（覆盖正面/负面）
            </button>
          )}
        </div>
      )}
    </div>
  );
}
