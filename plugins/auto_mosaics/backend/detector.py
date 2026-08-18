"""YOLOv8（ONNX Runtime）敏感部位检测。

模型：deepghs/anime_censor_detection 的 censor_detect_v1.0_s（MIT），
类别映射：0=nipple_f（欧派派）、1=penis（欧金金）、2=pussy（欧芒果）。
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import onnxruntime as ort
from PIL import Image

NAMES = ("nipple_f", "penis", "pussy")
IMGSZ = 640


@dataclass
class Detection:
    label: str
    confidence: float
    box: tuple[int, int, int, int]  # x1, y1, x2, y2（原图坐标）


def _letterbox(img: Image.Image, size: int = IMGSZ):
    w, h = img.size
    ratio = min(size / w, size / h)
    nw, nh = round(w * ratio), round(h * ratio)
    resized = img.resize((nw, nh), Image.BILINEAR)
    canvas = Image.new("RGB", (size, size), (114, 114, 114))
    canvas.paste(resized, ((size - nw) // 2, (size - nh) // 2))
    blob = np.asarray(canvas, dtype=np.float32) / 255.0
    return blob.transpose(2, 0, 1)[None], ratio, (size - nw) // 2, (size - nh) // 2


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_thr: float) -> list[int]:
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        i = int(order[0])
        keep.append(i)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[i, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[i, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[i, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[i, 3], boxes[rest, 3])
        inter = np.maximum(0, xx2 - xx1) * np.maximum(0, yy2 - yy1)
        area_i = (boxes[i, 2] - boxes[i, 0]) * (boxes[i, 3] - boxes[i, 1])
        area_r = (boxes[rest, 2] - boxes[rest, 0]) * (boxes[rest, 3] - boxes[rest, 1])
        union = area_i + area_r - inter
        order = rest[inter / np.maximum(union, 1e-9) <= iou_thr]
    return keep


class CensorDetector:
    """YOLOv8 ONNX 检测器（CPU）。"""

    def __init__(self, model_path: str, conf: float = 0.25, iou: float = 0.45):
        self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.conf = conf
        self.iou = iou

    def detect(self, image: Image.Image, labels: list[str]) -> list[Detection]:
        """检测指定类别（labels 为 NAMES 中的名称），返回原图坐标检测框。"""
        blob, ratio, padx, pady = _letterbox(image)
        out = self.session.run(None, {self.input_name: blob})[0]
        if out.shape[1] != 4 + len(NAMES):
            out = out.transpose(0, 2, 1)
        out = out[0]
        boxes_raw, scores = out[:4], out[4:]
        if scores.max() > 1.0:  # 个别导出包含 sigmoid，这里兜底
            scores = 1.0 / (1.0 + np.exp(-scores))

        results: list[Detection] = []
        for cls in range(len(NAMES)):
            if NAMES[cls] not in labels:
                continue
            cls_scores = scores[cls]
            idx = np.where(cls_scores >= self.conf)[0]
            if idx.size == 0:
                continue
            candidates = []
            for i in idx:
                cx, cy, w, h = boxes_raw[:, i]
                x1 = round((cx - w / 2 - padx) / ratio)
                y1 = round((cy - h / 2 - pady) / ratio)
                x2 = round((cx + w / 2 - padx) / ratio)
                y2 = round((cy + h / 2 - pady) / ratio)
                candidates.append((x1, y1, x2, y2, float(cls_scores[i])))
            candidates.sort(key=lambda t: t[4], reverse=True)
            arr = np.array([[c[0], c[1], c[2], c[3]] for c in candidates], dtype=float)
            sc = np.array([c[4] for c in candidates], dtype=float)
            for k in _nms(arr, sc, self.iou):
                x1, y1, x2, y2, conf = candidates[k]
                results.append(Detection(NAMES[cls], conf, (x1, y1, x2, y2)))
        return results
