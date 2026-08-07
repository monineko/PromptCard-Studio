import { AlertTriangle, Loader2, Send } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import type { PngInfoResult, PngSendResult } from "../../types";
import { Button, Modal } from "../UI";

const PARAM_LABELS: Record<string, string> = {
  width: "分辨率",
  height: "分辨率",
  steps: "采样步数",
  scale: "提示词引导",
  cfg_rescale: "重采样系数",
  seed: "种子",
  sampler: "采样器",
  noise_schedule: "调度器",
  uc_preset: "负面预设",
  sm: "SMEA",
  sm_dyn: "SMEA DYN",
  decrisp: "Decrisp",
  legacy_uc: "Legacy UC",
  variety: "Variety+",
  quality_toggle: "质量词",
  furry_mode: "Furry",
};

export function SendToWorkspaceModal({
  open,
  info,
  model,
  onClose,
  onConfirm,
}: {
  open: boolean;
  info: PngInfoResult | null;
  model: string;
  onClose: () => void;
  onConfirm: (payload: PngSendResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [payload, setPayload] = useState<PngSendResult | null>(null);

  useEffect(() => {
    if (!open || !info) return;
    if (!info.parsed || typeof info.parsed !== "object") {
      setLoading(false);
      setError("该图片不含完整元数据（提示词/参数/Vibe 未知），无法发送到工作区");
      setPayload(null);
      return;
    }
    setLoading(true);
    setError("");
    setPayload(null);
    api
      .pngSend(info.parsed, model)
      .then(setPayload)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [open, info, model]);

  const boolRows = (payload?.params ?? {});
  const kv: [string, string][] = [];
  if (boolRows.width != null && boolRows.height != null) {
    kv.push(["分辨率", `${boolRows.width} × ${boolRows.height}`]);
  }
  for (const [k, v] of Object.entries(boolRows)) {
    if (k === "width" || k === "height") continue;
    const label = PARAM_LABELS[k] ?? k;
    if (typeof v === "boolean") {
      if (v) kv.push([label, "开启"]);
    } else if (k === "seed") {
      kv.push([label, String(v)]);
    } else if (k === "steps" || k === "scale" || k === "cfg_rescale") {
      kv.push([label, String(v)]);
    } else if (typeof v === "string" || typeof v === "number") {
      kv.push([label, String(v)]);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="发送到工作区" wide zIndex={11000}>
      {loading && (
        <div className="flex items-center gap-2 py-6 text-sm text-[var(--muted)]">
          <Loader2 size={16} className="animate-spin" /> 正在解析图片参数…
        </div>
      )}
      {!loading && error && (
        <div className="py-2">
          <p className="text-sm text-red-400">解析失败：{error}</p>
          <div className="mt-4 flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>
      )}
      {!loading && !error && payload && (
        <div className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              发送会<strong>替换工作区现有全部提示词</strong>（正面基础、角色、负面），并重置下方列出的生成参数。工作区覆盖可用 Ctrl+Z 撤销。
            </span>
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5">
              <div className="mb-1 font-medium text-[var(--muted)]">正面基础（将放入工作台）</div>
              <div className="max-h-24 overflow-auto whitespace-pre-wrap leading-relaxed">
                {payload.positive.trim() || "（空）"}
              </div>
              <div className="mt-1 text-[var(--muted)]">
                角色 {payload.characters.length} 个（将填入「角色」分区）
              </div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5">
              <div className="mb-1 font-medium text-[var(--muted)]">负面提示词</div>
              <div className="max-h-24 overflow-auto whitespace-pre-wrap leading-relaxed">
                {payload.negative.trim() || "（空，将使用 UC 预设）"}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5">
            <div className="mb-1 text-xs font-medium text-[var(--muted)]">将恢复的参数</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-3">
              {kv.map(([k, v]) => (
                <div key={k} className="flex gap-1.5">
                  <span className="shrink-0 text-[var(--muted)]">{k}</span>
                  <span className="truncate">{v}</span>
                </div>
              ))}
              {kv.length === 0 && <span className="text-[var(--muted)]">（元数据中未发现可恢复参数）</span>}
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border)] bg-[var(--input)]/50 p-2.5 text-xs">
            <span className="mr-2 font-medium text-[var(--muted)]">Vibe 参考</span>
            {payload.vibes.length === 0 ? (
              <span>无</span>
            ) : (
              payload.vibes
                .map((v) => `${v.name}（强度 ${v.strength}）`)
                .join("、")
            )}
            {payload.vibes.length > 0 && (
              <div className="mt-1 text-[var(--muted)]">
                来自图片的临时 Vibe，暂存于参数区可直接使用；可在参数面板点「存入库」保存到 Vibe 库。
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
            <Button onClick={() => onConfirm(payload)}>
              <Send size={14} /> 确认发送并覆盖
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
