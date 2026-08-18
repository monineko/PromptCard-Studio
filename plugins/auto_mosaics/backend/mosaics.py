"""打码方法（仅依赖 Pillow）：像素、模糊、线条、纯色。

打码算法参考 Auto-NovelAI-Refactor 的 anr_plugin_auto_mosaics 插件（GPL-3.0）。
"""

from __future__ import annotations

import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


def _hex_to_rgb(color: str) -> tuple[int, int, int]:
    text = (color or "").strip().lstrip("#")
    try:
        return tuple(int(text[i : i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    except (ValueError, IndexError):
        return (128, 128, 128)


def _clamp_box(box, width: int, height: int):
    x1, y1, x2, y2 = box
    return max(0, x1), max(0, y1), min(width, x2), min(height, y2)


def pixel_mosaic(image: Image.Image, boxes, pixel_size: int = 15) -> Image.Image:
    """把检测区域按 pixel_size 块做块平均（马赛克）。"""
    img = image.convert("RGB")
    arr = np.array(img)
    height, width = arr.shape[:2]
    result = arr.copy()
    size = max(1, int(pixel_size))
    for box in boxes:
        x1, y1, x2, y2 = _clamp_box(box, width, height)
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue
        for y in range(y1, y2, size):
            for x in range(x1, x2, size):
                y_end, x_end = min(y + size, y2), min(x + size, x2)
                block = arr[y:y_end, x:x_end]
                result[y:y_end, x:x_end] = block.reshape(-1, 3).mean(axis=0).astype(np.uint8)
    return Image.fromarray(result)


def blur_mosaic(image: Image.Image, boxes, blur_radius: int = 12) -> Image.Image:
    """对检测区域做高斯模糊。"""
    radius = max(1, int(blur_radius))
    blurred = image.convert("RGB").filter(ImageFilter.GaussianBlur(radius))
    result = image.convert("RGB").copy()
    for box in boxes:
        x1, y1, x2, y2 = _clamp_box(box, result.width, result.height)
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue
        region = blurred.crop((x1, y1, x2, y2))
        result.paste(region, (x1, y1))
    return result


def _draw_bars(draw, box, width_range, spacing_range, color, width: int, height: int):
    x1, y1, x2, y2 = _clamp_box(box, width, height)
    if x2 - x1 < 1 or y2 - y1 < 1:
        return
    min_w, max_w = max(1, int(width_range[0])), max(1, int(width_range[1]))
    min_sp, max_sp = max(1, int(spacing_range[0])), max(1, int(spacing_range[1]))
    horizontal = (x2 - x1) > (y2 - y1)  # 宽区域画竖条，高区域画横条（垂直于长边）
    if horizontal:
        x = x1
        while x < x2:
            w = random.randint(min_w, max_w)
            draw.rectangle([x, y1, min(x + w, x2), y2], fill=color)
            x += w + random.randint(min_sp, max_sp)
    else:
        y = y1
        while y < y2:
            h = random.randint(min_w, max_w)
            draw.rectangle([x1, y, x2, min(y + h, y2)], fill=color)
            y += h + random.randint(min_sp, max_sp)


def line_mosaic(image: Image.Image, boxes, width_range=(3, 10), spacing_range=(10, 15)) -> Image.Image:
    """线条遮挡：颜色按图片整体亮度自动选黑/白。"""
    result = image.convert("RGB")
    gray = np.asarray(result.convert("L"), dtype=np.float32)
    color = "white" if gray.mean() < 128 else "black"
    draw = ImageDraw.Draw(result)
    for box in boxes:
        _draw_bars(draw, box, width_range, spacing_range, color, result.width, result.height)
    return result


def solid_color_mosaic(image: Image.Image, boxes, color: str = "#808080") -> Image.Image:
    """用指定颜色整块覆盖检测区域。"""
    result = image.convert("RGB")
    draw = ImageDraw.Draw(result)
    fill = _hex_to_rgb(color)
    for box in boxes:
        x1, y1, x2, y2 = _clamp_box(box, result.width, result.height)
        if x2 - x1 < 1 or y2 - y1 < 1:
            continue
        draw.rectangle([x1, y1, x2, y2], fill=fill)
    return result
