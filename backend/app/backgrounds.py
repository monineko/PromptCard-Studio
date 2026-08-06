"""全局背景图管理：图片放在项目根目录 backgrounds/ 下，由用户自行维护。"""
import os
from pathlib import Path
from urllib.parse import quote

from .config import BACKGROUNDS_DIR

BACKGROUND_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}


def _is_background(file: Path) -> bool:
    return file.is_file() and file.suffix.lower() in BACKGROUND_EXTENSIONS


def list_backgrounds() -> dict:
    BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
    images = []
    for file in sorted(BACKGROUNDS_DIR.iterdir(), key=lambda p: p.name.lower()):
        if not _is_background(file):
            continue
        images.append(
            {
                "name": file.name,
                "url": f"/api/backgrounds/image?name={quote(file.name)}",
            }
        )
    return {"images": images, "folder": str(BACKGROUNDS_DIR)}


def resolve_background(name: str) -> Path:
    """把背景图文件名解析为 backgrounds/ 内的绝对路径，防目录穿越。"""
    if not name:
        raise ValueError("名称不能为空")
    root = BACKGROUNDS_DIR.resolve()
    target = (root / name).resolve()
    if not target.is_relative_to(root):
        raise ValueError("非法路径")
    return target


def open_backgrounds_folder() -> dict:
    """用系统资源管理器打开背景图目录。"""
    BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        if os.name == "nt":
            os.startfile(str(BACKGROUNDS_DIR))  # type: ignore[attr-defined]
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(BACKGROUNDS_DIR)])
    except Exception as e:
        raise RuntimeError(f"无法打开文件夹: {e}")
    return {"ok": True, "path": str(BACKGROUNDS_DIR)}
