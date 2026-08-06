import json
import os
import random
import re
import shutil
import uuid
from datetime import date
from pathlib import Path

from .config import load_settings

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


# 大分类：key -> 图库内文件夹名（"收藏" 对应 Like/收藏夹）
CATEGORY_FOLDERS = {
    "treasure": "Treasure",
    "fine": "Fine",
    "reject": "Reject",
    "favorites": "收藏",
}

CATEGORY_ORDER = ["all", "treasure", "fine", "reject", "favorites", "unrated"]
CATEGORY_LABELS = {
    "all": "全部",
    "treasure": "Treasure",
    "fine": "Fine",
    "reject": "Reject",
    "favorites": "收藏",
    "unrated": "未评分",
}

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}

# 撤销记录（内存，仅本次运行期间有效；键为 token）
_UNDO_STORE: dict[str, list[dict]] = {}
# 图片尺寸缓存（path -> (width, height, mtime_ns)）
_SIZE_CACHE: dict[str, tuple[int, int, int]] = {}


def _library_root() -> Path:
    """图库根目录（设置页可改，默认项目内 library/）。"""
    settings = load_settings()
    root = Path(settings.get("library_path") or "").expanduser()
    if not root.is_absolute():
        from .config import LIBRARY_DIR

        root = LIBRARY_DIR / root
    root.mkdir(parents=True, exist_ok=True)
    return root


def resolve_image(rel_path: str) -> Path:
    """把相对路径解析为图库内的绝对路径，防目录穿越。"""
    if not rel_path:
        raise ValueError("路径不能为空")
    root = _library_root().resolve()
    target = (root / rel_path).resolve()
    if not target.is_relative_to(root):
        raise ValueError("非法路径")
    return target


def _is_image(file: Path) -> bool:
    return file.is_file() and file.suffix.lower() in IMAGE_EXTENSIONS


def _image_size(file: Path) -> tuple[int, int]:
    """读取图片宽高（仅解析头部，速度快），失败时退回 1x1。"""
    try:
        mtime_ns = file.stat().st_mtime_ns
    except OSError:
        return (1, 1)
    cached = _SIZE_CACHE.get(str(file))
    if cached and cached[2] == mtime_ns:
        return cached[0], cached[1]
    size = (1, 1)
    if Image is not None:
        try:
            with Image.open(file) as im:
                size = im.size
        except Exception:
            size = (1, 1)
    if len(_SIZE_CACHE) > 800:
        _SIZE_CACHE.clear()
    _SIZE_CACHE[str(file)] = (size[0], size[1], mtime_ns)
    return size


def _category_of(parts: tuple[str, ...]) -> tuple[str, str]:
    """根据相对路径判断大分类与日期分组。返回 (category_key, date_group)。"""
    if not parts:
        return "unrated", ""
    head = parts[0]
    for key, folder in CATEGORY_FOLDERS.items():
        if head.lower() == folder.lower():
            date_group = parts[1] if len(parts) > 1 else ""
            return key, date_group
    # 不在任何已知分类目录下 -> 未评分；日期分组取一层父目录名（根目录为空）
    date_group = parts[0] if len(parts) > 1 else ""
    return "unrated", date_group


def _scan_items() -> list[dict]:
    root = _library_root()
    items: list[dict] = []
    if not root.exists():
        return items
    for file in sorted(root.rglob("*"), key=lambda p: str(p).lower()):
        if not _is_image(file):
            continue
        rel = file.relative_to(root)
        if any(part.startswith(".") for part in rel.parts):
            continue  # 跳过隐藏目录（如 .trash）
        category, date_group = _category_of(rel.parts)
        try:
            stat = file.stat()
        except OSError:
            continue
        width, height = _image_size(file)
        items.append(
            {
                "path": rel.as_posix(),
                "name": file.name,
                "category": category,
                "date": date_group,
                "size": stat.st_size,
                "mtime": int(stat.st_mtime * 1000),
                "width": width,
                "height": height,
            }
        )
    return items


def summary() -> dict:
    items = _scan_items()
    counts = {key: 0 for key in CATEGORY_ORDER}
    for item in items:
        counts[item["category"]] += 1
        counts["all"] += 1
    return {
        "categories": [
            {
                "key": key,
                "label": CATEGORY_LABELS[key],
                "count": counts[key],
                "folder": CATEGORY_FOLDERS.get(key),
            }
            for key in CATEGORY_ORDER
        ],
        "library_path": str(_library_root()),
    }


def list_images(category: str) -> dict:
    if category not in CATEGORY_ORDER:
        raise ValueError(f"未知分类: {category}")
    items = [item for item in _scan_items() if category == "all" or item["category"] == category]
    return {"category": category, "items": items, "total": len(items)}


def _extract_comment(info: dict):
    """从 Pillow 的 info 里取 Comment 并尝试解析为 JSON。"""
    raw = info.get("Comment")
    if raw is None:
        return None, None
    if not isinstance(raw, str):
        raw = str(raw)
    try:
        return json.loads(raw), raw
    except Exception:
        return None, raw


def read_png_info(rel_path: str) -> dict:
    path = resolve_image(rel_path)
    if not path.exists() or not path.is_file():
        raise FileNotFoundError("图片不存在")
    if Image is None:  # pragma: no cover
        raise RuntimeError("Pillow 未安装，无法解析 PNG 信息")
    try:
        with Image.open(path) as img:
            info = dict(img.info)
            width, height = img.size
    except Exception as e:
        raise ValueError(f"无法读取图片: {e}")

    parsed, raw = _extract_comment(info)
    source = info.get("Source")
    software = info.get("Software")
    generation_time = info.get("Generation_time") or info.get("Generation time")
    if parsed is None and raw:
        # Comment 不是 JSON：仍作为原始文本返回
        return {
            "ok": True,
            "parsed": None,
            "raw": raw,
            "summary": None,
            "width": width,
            "height": height,
            "source": source,
            "software": software,
            "generation_time": generation_time,
        }
    summary = _summarize(parsed) if isinstance(parsed, dict) else None
    return {
        "ok": True,
        "parsed": parsed,
        "raw": raw,
        "summary": summary,
        "width": width,
        "height": height,
        "source": source,
        "software": software,
        "generation_time": generation_time,
    }


def _summarize(parsed: dict) -> dict:
    """从完整 JSON 中提取常用字段（兼容 v1/v4 字段名）。"""
    prompt = parsed.get("prompt")
    if prompt is None:
        v4 = parsed.get("v4_prompt")
        if isinstance(v4, dict):
            caption = v4.get("caption")
            if isinstance(caption, dict):
                prompt = caption.get("prompt")
    uc = parsed.get("uc") or parsed.get("negative_prompt")
    if uc is None:
        v4n = parsed.get("v4_negative_prompt")
        if isinstance(v4n, dict):
            caption = v4n.get("caption")
            if isinstance(caption, dict):
                uc = caption.get("prompt")
    return {
        "prompt": prompt,
        "uc": uc,
        "width": parsed.get("width"),
        "height": parsed.get("height"),
        "seed": parsed.get("seed"),
        "sampler": parsed.get("sampler"),
        "steps": parsed.get("steps"),
        "scale": parsed.get("scale"),
        "sm": parsed.get("sm"),
        "sm_dyn": parsed.get("sm_dyn"),
        "noise_schedule": parsed.get("noise_schedule"),
        "legacy_uc": parsed.get("legacy_uc"),
    }


def _unique_dest(folder: Path, name: str) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    candidate = folder / name
    if not candidate.exists():
        return candidate
    stem, suffix = os.path.splitext(name)
    n = 1
    while True:
        candidate = folder / f"{stem} ({n}){suffix}"
        if not candidate.exists():
            return candidate
        n += 1


def _safe_filename(name: str) -> str:
    """清洗上传文件名：去路径部分 + 去掉 Windows 非法字符。"""
    name = Path(name or "image.png").name
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", name)
    return (name or "image.png")[:200]


def import_uploaded_files(files: list[tuple[str, bytes]]) -> dict:
    """浏览器上传（选文件夹/多选图片）→ 复制进图库根目录（未评分），重名自动加后缀。"""
    root = _library_root()
    imported, skipped = 0, 0
    errors: list[str] = []
    for name, data in files:
        if not data:
            skipped += 1
            continue
        safe = _safe_filename(name)
        if Path(safe).suffix.lower() not in IMAGE_EXTENSIONS:
            skipped += 1
            errors.append(f"{name}: 非图片文件")
            continue
        dest = _unique_dest(root, safe)
        try:
            dest.write_bytes(data)
            imported += 1
        except OSError as e:
            skipped += 1
            errors.append(f"{name}: {e}")
    return {"imported": imported, "skipped": skipped, "errors": errors}


def import_from_path(path_str: str) -> dict:
    """从本地路径导入：目录递归复制（保留相对子目录），或单个图片文件。"""
    source = Path(path_str).expanduser()
    if not source.exists():
        raise FileNotFoundError(f"路径不存在: {path_str}")
    root = _library_root()
    imported, skipped = 0, 0
    errors: list[str] = []

    if source.is_file():
        candidates = [source]
    else:
        candidates = [
            p
            for p in sorted(source.rglob("*"))
            if _is_image(p) and not any(part.startswith(".") for part in p.relative_to(source).parts)
        ]

    for file in candidates:
        rel = file.relative_to(source) if source.is_dir() else Path(file.name)
        parent = rel.parent
        dest_folder = root if str(parent) == "." else root / parent
        try:
            dest_folder.mkdir(parents=True, exist_ok=True)
            dest = _unique_dest(dest_folder, file.name)
            shutil.copy2(str(file), str(dest))
            imported += 1
        except OSError as e:
            skipped += 1
            errors.append(f"{file.name}: {e}")
    return {"imported": imported, "skipped": skipped, "errors": errors}


def open_library_folder() -> dict:
    """用系统资源管理器打开图库目录。"""
    root = _library_root()
    root.mkdir(parents=True, exist_ok=True)
    try:
        if os.name == "nt":
            os.startfile(str(root))  # type: ignore[attr-defined]
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(root)])
    except Exception as e:
        raise RuntimeError(f"无法打开文件夹: {e}")
    return {"ok": True, "path": str(root)}


def _trash_file(path: Path) -> Path | None:
    """优先送系统回收站；失败则移入项目内 .trash/library，返回新位置（可撤销）。"""
    try:
        import send2trash

        send2trash.send2trash(str(path))
        return None
    except Exception:
        trash_dir = _library_root().parent / ".trash" / "library"
        trash_dir.mkdir(parents=True, exist_ok=True)
        target = trash_dir / f"{date.today():%Y%m%d}_{random.randint(10000, 99999)}_{path.name}"
        shutil.move(str(path), str(target))
        return target


def apply_review(moves: list[dict], recycle_reject: bool = True) -> dict:
    """结束筛选：按临时标签统一移动文件。reject 进回收站（可配置为永久删除）。"""
    applied: list[dict] = []
    skipped: list[dict] = []
    undo_ops: list[dict] = []
    today = date.today().isoformat()
    root = _library_root()

    for move in moves:
        rel = (move or {}).get("path", "")
        tag = (move or {}).get("tag", "")
        folder_name = CATEGORY_FOLDERS.get(tag)
        if not folder_name:
            skipped.append({"path": rel, "tag": tag, "reason": "未知标签"})
            continue
        try:
            src = resolve_image(rel)
        except Exception as e:
            skipped.append({"path": rel, "tag": tag, "reason": str(e)})
            continue
        if not src.exists() or not src.is_file():
            skipped.append({"path": rel, "tag": tag, "reason": "文件不存在"})
            continue

        if tag == "reject":
            if recycle_reject:
                moved_to = _trash_file(src)
                if moved_to is not None:
                    undo_ops.append({"undoable": True, "src": str(src), "dest": str(moved_to)})
                else:
                    undo_ops.append({"undoable": False, "src": str(src), "dest": None})
                applied.append({"path": rel, "tag": tag, "dest": None, "undoable": moved_to is not None})
            else:
                try:
                    src.unlink()
                except OSError as e:
                    skipped.append({"path": rel, "tag": tag, "reason": str(e)})
                    continue
                undo_ops.append({"undoable": False, "src": str(src), "dest": None})
                applied.append({"path": rel, "tag": tag, "dest": None, "undoable": False})
            continue

        dest = _unique_dest(root / folder_name / today, src.name)
        try:
            src.rename(dest)
        except OSError as e:
            skipped.append({"path": rel, "tag": tag, "reason": str(e)})
            continue
        undo_ops.append({"undoable": True, "src": str(src), "dest": str(dest)})
        applied.append(
            {
                "path": rel,
                "tag": tag,
                "dest": dest.relative_to(root).as_posix(),
                "undoable": True,
            }
        )

    token = uuid.uuid4().hex
    if undo_ops:
        _UNDO_STORE[token] = undo_ops
        if len(_UNDO_STORE) > 20:
            _UNDO_STORE.pop(next(iter(_UNDO_STORE)), None)
    return {
        "ok": True,
        "applied": applied,
        "skipped": skipped,
        "undo_token": token if undo_ops else None,
        "message": f"已处理 {len(applied)} 张，跳过 {len(skipped)} 张",
    }


def undo_review(token: str) -> dict:
    ops = _UNDO_STORE.pop(token, None)
    if not ops:
        raise ValueError("撤销记录不存在或已过期（服务重启后无法撤销）")
    restored: list[dict] = []
    failed: list[dict] = []
    for op in ops:
        if not op.get("undoable"):
            failed.append({"path": op.get("src"), "reason": "回收站/已删除的文件无法自动还原"})
            continue
        src, dest = Path(op["src"]), Path(op["dest"])
        if not dest.exists():
            failed.append({"path": op["src"], "reason": "目标文件不存在"})
            continue
        try:
            src.parent.mkdir(parents=True, exist_ok=True)
            dest.rename(src)
            restored.append({"path": op["src"]})
        except OSError as e:
            failed.append({"path": op["src"], "reason": str(e)})
    return {"ok": True, "restored": restored, "failed": failed}
