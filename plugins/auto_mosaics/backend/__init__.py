"""自动打码插件后端入口。

发布处理流水线通过插件注册表（backend/app/plugins.py）调用 process_image()，
模型路径取自插件自己的运行时安装状态（models/runtime/installed.json）。
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image

from . import mosaics
from .detector import CensorDetector, NAMES

PLUGIN_DIR = Path(__file__).resolve().parents[1]
RUNTIME_DIR = PLUGIN_DIR / "models" / "runtime"
INSTALLED_FILE = RUNTIME_DIR / "installed.json"

_detector_cache: dict[tuple[str, float], CensorDetector] = {}


def clear_cache() -> None:
    """释放已加载的检测器会话（卸载插件前调用，避免模型文件被占用）。"""
    _detector_cache.clear()


def _model_path() -> Path:
    if not INSTALLED_FILE.exists():
        raise RuntimeError("自动打码插件未启用：请先在发布页面下载并启用插件")
    installed = json.loads(INSTALLED_FILE.read_text(encoding="utf-8"))
    return RUNTIME_DIR / installed["model"]


def _get_detector() -> CensorDetector:
    model = _model_path()
    stat = model.stat()
    key = (str(model), stat.st_mtime)
    detector = _detector_cache.get(key)
    if detector is None:
        detector = CensorDetector(str(model))
        _detector_cache.clear()
        _detector_cache[key] = detector
    return detector


def _method_fn(method: str):
    return {
        "pixel": mosaics.pixel_mosaic,
        "blur": mosaics.blur_mosaic,
        "line": mosaics.line_mosaic,
        "solid": mosaics.solid_color_mosaic,
    }.get(method, mosaics.pixel_mosaic)


def _params_of(raw: dict) -> dict:
    params = raw or {}
    parts = [p for p in (params.get("parts") or []) if p in {"欧金金", "欧芒果", "欧派派"}]
    labels = {
        "欧金金": "penis",
        "欧芒果": "pussy",
        "欧派派": "nipple_f",
    }
    selected = [labels[p] for p in parts] or list(NAMES)
    return {
        "labels": selected,
        "method": params.get("method") or "pixel",
        "pixel_size": int(params.get("pixel_size") or 15),
        "blur_radius": int(params.get("blur_radius") or 12),
        "line_width_range": (
            int(params.get("line_width_min") or 3),
            int(params.get("line_width_max") or 10),
        ),
        "line_spacing_range": (
            int(params.get("line_spacing_min") or 10),
            int(params.get("line_spacing_max") or 15),
        ),
        "color": str(params.get("color") or "#808080"),
    }


def process_image(image_path, out_path, params: dict) -> dict:
    """检测并打码单张图片，返回处理结果；未检测到目标时返回 skipped=True 且不写输出。"""
    p = _params_of(params)
    image = Image.open(image_path)
    detections = _get_detector().detect(image, p["labels"])
    if not detections:
        return {"path": None, "detected": 0, "skipped": True, "message": "未检测到目标部位，已跳过"}
    boxes = [d.box for d in detections]
    method = p["method"]
    if method == "pixel":
        result = mosaics.pixel_mosaic(image, boxes, p["pixel_size"])
    elif method == "blur":
        result = mosaics.blur_mosaic(image, boxes, p["blur_radius"])
    elif method == "line":
        result = mosaics.line_mosaic(image, boxes, p["line_width_range"], p["line_spacing_range"])
    elif method == "solid":
        result = mosaics.solid_color_mosaic(image, boxes, p["color"])
    else:
        result = mosaics.pixel_mosaic(image, boxes, p["pixel_size"])
    result.save(out_path)
    return {
        "path": str(out_path),
        "detected": len(detections),
        "skipped": False,
        "message": f"已检测并打码 {len(detections)} 处",
    }
