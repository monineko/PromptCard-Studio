"""PNG 元数据 → 工作区与生成参数 的完整还原（发送到工作区）。"""

import re
import hashlib

from .novelai import QUALITY_PRESETS, UNDESIRED_PRESETS


def _unescape(text) -> str:
    """还原官方元数据中字符槽的转义（括号/逗号前的反斜杠）。"""
    return (
        str(text or "")
        .replace(r"\(", "(")
        .replace(r"\)", ")")
        .replace(r"\,", ",")
    )


def _norm(text: str) -> str:
    """官方元数据的 uc 会把逗号去掉，比较前先归一化（去逗号、折叠空白）。"""
    return " ".join(re.sub(r"\s*,\s*", " ", text or "").split())


def build_send_payload(parsed: dict, model: str) -> dict:
    """从完整 PNG Comment JSON 还原工作区内容与全部可恢复的生成参数。"""
    if not isinstance(parsed, dict):
        raise ValueError("PNG 元数据不是有效的 JSON")
    if not (parsed.get("prompt") or parsed.get("v4_prompt") or parsed.get("uc") or parsed.get("negative_prompt")):
        raise ValueError("该图片不含完整元数据（提示词/参数/Vibe 未知），无法发送到工作区")

    v4p = parsed.get("v4_prompt") if isinstance(parsed.get("v4_prompt"), dict) else None
    v4n = parsed.get("v4_negative_prompt") if isinstance(parsed.get("v4_negative_prompt"), dict) else None

    # ---------- 正面基础（角色词已由前端/后端分离进角色槽） ----------
    base = None
    if v4p is not None:
        cap = v4p.get("caption") if isinstance(v4p.get("caption"), dict) else None
        if cap is not None:
            base = cap.get("base_caption")
    if base is None:
        base = parsed.get("prompt")
    base = _unescape(base).strip()

    furry = base.startswith("fur dataset, ")
    if furry:
        base = base[len("fur dataset, ") :].strip()

    # 质量词：识别 Standard/Light 后缀；未命中则保留原文并关闭自动追加，避免重复
    quality_preset = "none"
    for preset, raw_tags in QUALITY_PRESETS.get(model, {}).items():
        tags = raw_tags.strip()
        if tags and base.endswith(tags):
            base = base[: -len(tags)].rstrip().rstrip(",").strip()
            quality_preset = preset
            break
    quality_on = quality_preset != "none"

    transparent_bg = False
    transparent_tag = "transparent background"
    if base == transparent_tag:
        base = ""
        transparent_bg = True
    elif base.endswith(", " + transparent_tag):
        base = base[: -(len(transparent_tag) + 2)].rstrip()
        transparent_bg = True

    # ---------- 角色 ----------
    characters: list[dict] = []
    if v4p is not None:
        cap = v4p.get("caption") or {}
        for c in cap.get("char_captions") or []:
            characters.append(
                {"positive": _unescape(c.get("char_caption") or "").strip(), "negative": ""}
            )
    if v4n is not None:
        ncap = v4n.get("caption") or {}
        nchars = ncap.get("char_captions") or []
        for i, c in enumerate(nchars):
            neg = _unescape(c.get("char_caption") or "").strip()
            if i < len(characters):
                characters[i]["negative"] = neg
            elif neg:
                characters.append({"positive": "", "negative": neg})

    # ---------- 负面（合并了 UC 预设词，需推断预设） ----------
    combined = None
    if v4n is not None:
        ncap = v4n.get("caption") or {}
        combined = ncap.get("base_caption")
    if combined is None:
        combined = parsed.get("uc") or parsed.get("negative_prompt")
    combined = _unescape(combined).strip()

    uc_preset, user_neg = "None", combined
    n_combined = _norm(combined)
    for name, words in (UNDESIRED_PRESETS.get(model) or {}).items():
        words = (words or "").strip()
        if not words:
            continue
        n_words = _norm(words)
        if n_combined == n_words:
            uc_preset, user_neg = name, ""
            break
        if n_combined.startswith(n_words + " "):
            tokens = n_combined.split()
            uc_preset, user_neg = name, " ".join(tokens[len(n_words.split()) :])
            break

    # ---------- 参数 ----------
    params: dict = {}
    for k in ("steps", "width", "height", "scale", "cfg_rescale", "sampler", "noise_schedule", "seed"):
        if parsed.get(k) is not None:
            params[k] = parsed[k]
    params["sm"] = bool(parsed.get("sm"))
    params["sm_dyn"] = bool(parsed.get("sm_dyn"))
    params["decrisp"] = bool(parsed.get("dynamic_thresholding"))
    legacy = parsed.get("legacy_uc")
    if legacy is None and v4n is not None:
        legacy = v4n.get("legacy_uc")
    params["legacy_uc"] = bool(legacy)
    params["variety"] = "skip_cfg_above_sigma" in parsed
    params["quality_toggle"] = quality_on
    params["quality_preset"] = quality_preset
    params["furry_mode"] = furry
    params["transparent_bg"] = transparent_bg
    params["uc_preset"] = uc_preset

    # ---------- Vibe（临时使用，不入库；用户可手动存入库） ----------
    refs = parsed.get("reference_image_multiple") or []
    strengths = parsed.get("reference_strength_multiple") or []
    infos = parsed.get("reference_information_extracted_multiple") or []
    vibes: list[dict] = []
    for i, enc in enumerate(refs or []):
        enc = str(enc or "").strip()
        if enc.startswith("data:") and ";base64," in enc:
            enc = enc.split(";base64,", 1)[1]
        if not enc:
            continue
        try:
            strength = max(0.0, min(1.0, float(strengths[i]) if i < len(strengths) and strengths[i] is not None else 0.7))
            info = float(infos[i]) if i < len(infos) and infos[i] is not None else 0.7
        except (TypeError, ValueError):
            strength, info = 0.7, 0.7
        digest = hashlib.md5(enc.encode("utf-8")).hexdigest()[:10]
        vibes.append(
            {
                "id": f"png-{digest}",
                "name": f"来自图片 {i + 1}",
                "thumbnail": "data:image/jpeg;base64," + enc,
                "strength": strength,
                "information_extracted": info,
                "encoding": enc,
            }
        )

    return {
        "positive": base,
        "negative": user_neg,
        "uc_preset": uc_preset,
        "characters": characters,
        "params": params,
        "vibes": vibes,
    }
