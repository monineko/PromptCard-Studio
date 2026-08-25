import json
import ipaddress
import os
import random
import re
import shutil
import socket
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import date
from pathlib import Path

from .config import load_settings

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None


# 大分类：key -> 文件夹名前缀列表（目录结构：<前缀>-<筛选日期>/图片，
# 如 Treasure-2026-08-06、like-2026-08-06；"收藏" 为旧式收藏夹名兼容）
CATEGORY_PREFIXES = {
    "treasure": ["Treasure"],
    "fine": ["Fine"],
    "reject": ["Reject"],
    "favorites": ["like", "收藏"],
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
COVERS_FILE_NAME = ".covers.json"
MAX_UPLOAD_IMAGE_BYTES = 100 * 1024 * 1024
MAX_REMOTE_IMAGE_BYTES = 25 * 1024 * 1024
MAX_REMOTE_IMAGE_COUNT = 20
REMOTE_DOWNLOAD_TIMEOUT_SECONDS = 15

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


def list_covers() -> dict:
    """分类封面映射：{"<category_key>": 图库相对路径}，未设置则返回空。"""
    f = _library_root() / COVERS_FILE_NAME
    if not f.exists():
        return {}
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_covers(covers: dict) -> None:
    f = _library_root() / COVERS_FILE_NAME
    f.write_text(json.dumps(covers, ensure_ascii=False, indent=2), encoding="utf-8")


def set_cover(category: str, path: str) -> dict:
    """把图库内一张图片设为指定分类的封面。"""
    if category not in CATEGORY_ORDER:
        raise ValueError(f"未知分类: {category}")
    file = resolve_image(path)
    if not file.exists() or not file.is_file():
        raise FileNotFoundError("图片不存在")
    covers = list_covers()
    covers[category] = path
    _save_covers(covers)
    return {"ok": True, "category": category, "path": path}


def remove_cover(category: str) -> dict:
    """清除指定分类的封面（恢复默认逻辑）。"""
    if category not in CATEGORY_ORDER:
        raise ValueError(f"未知分类: {category}")
    covers = list_covers()
    if category in covers:
        covers.pop(category)
        _save_covers(covers)
    return {"ok": True}


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
    """根据相对路径判断大分类与日期分组。返回 (category_key, date_group)。

    当前目录结构：<前缀>/<前缀>-<日期>/图片（如 Treasure/Treasure-2026-08-06/a.png）；
    兼容旧结构：根目录 <前缀>-<日期>/图片、<分类名>/<日期>/图片；
    其余顶层目录视为未评分/自定义。
    """
    if not parts:
        return "unrated", ""
    head = parts[0]
    for key, prefixes in CATEGORY_PREFIXES.items():
        for prefix in prefixes:
            if head.lower() == prefix.lower():
                if len(parts) > 1:
                    second = parts[1]
                    if second.lower().startswith(prefix.lower() + "-"):
                        return key, second[len(prefix) + 1 :]
                    return key, second
                return key, ""
            if head.lower().startswith(prefix.lower() + "-"):
                return key, head[len(prefix) + 1 :]
    # 不在任何已知分类目录下 -> 未评分；日期分组取一层父目录名（根目录为空）
    date_group = parts[0] if len(parts) > 1 else ""
    return "unrated", date_group


def _item_for_file(file: Path, root: Path) -> dict | None:
    """将图库内已保存的图片转换为前端可直接显示的条目。"""
    try:
        rel = file.relative_to(root)
        stat = file.stat()
    except (OSError, ValueError):
        return None
    category, date_group = _category_of(rel.parts)
    width, height = _image_size(file)
    return {
        "path": rel.as_posix(),
        "name": file.name,
        "category": category,
        "date": date_group,
        "size": stat.st_size,
        "mtime": int(stat.st_mtime * 1000),
        "width": width,
        "height": height,
    }


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
        item = _item_for_file(file, root)
        if item:
            items.append(item)
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
                "folder": (CATEGORY_PREFIXES.get(key) or [None])[0],
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


def _import_target_folder(target: str, root: Path) -> Path:
    """拖放/上传导入的落点：未评分写根目录，其余分类写入当天的分类目录。"""
    if target == "unrated":
        return root
    prefixes = CATEGORY_PREFIXES.get(target)
    if not prefixes:
        raise ValueError(f"未知导入目标: {target}")
    prefix = prefixes[0]
    folder = root / prefix / f"{prefix}-{date.today().isoformat()}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def _import_result(imported: int, skipped: int, errors: list[str], items: list[dict]) -> dict:
    return {"imported": imported, "skipped": skipped, "errors": errors, "items": items}


def import_uploaded_files(files: list[tuple[str, bytes]], target: str = "unrated") -> dict:
    """内存中的上传文件导入图库；测试和旧调用可继续使用。"""
    root = _library_root()
    dest_folder = _import_target_folder(target, root)
    imported, skipped = 0, 0
    errors: list[str] = []
    items: list[dict] = []
    for name, data in files:
        if not data:
            skipped += 1
            continue
        safe = _safe_filename(name)
        if Path(safe).suffix.lower() not in IMAGE_EXTENSIONS:
            skipped += 1
            errors.append(f"{name}: 非图片文件")
            continue
        dest = _unique_dest(dest_folder, safe)
        try:
            dest.write_bytes(data)
            imported += 1
            item = _item_for_file(dest, root)
            if item:
                items.append(item)
        except OSError as e:
            skipped += 1
            errors.append(f"{name}: {e}")
    return _import_result(imported, skipped, errors, items)


async def import_uploaded_streams(files, target: str = "unrated") -> dict:
    """浏览器文件拖放/多选上传：逐块写入临时文件，避免整张大图占用内存。"""
    root = _library_root()
    dest_folder = _import_target_folder(target, root)
    temp_folder = root / ".importing"
    temp_folder.mkdir(parents=True, exist_ok=True)
    imported, skipped = 0, 0
    errors: list[str] = []
    items: list[dict] = []
    for index, upload in enumerate(files):
        name = str(getattr(upload, "filename", "") or "image.png")
        if index >= 100:
            skipped += 1
            errors.append(f"{name}: 单次最多导入 100 张图片")
            continue
        safe = _safe_filename(name)
        if Path(safe).suffix.lower() not in IMAGE_EXTENSIONS:
            skipped += 1
            errors.append(f"{name}: 非图片文件")
            continue
        temp_path: Path | None = None
        try:
            fd, raw_temp_path = tempfile.mkstemp(prefix="upload_", suffix=Path(safe).suffix, dir=temp_folder)
            temp_path = Path(raw_temp_path)
            total = 0
            with os.fdopen(fd, "wb") as output:
                while chunk := await upload.read(1024 * 1024):
                    total += len(chunk)
                    if total > MAX_UPLOAD_IMAGE_BYTES:
                        raise ValueError("图片超过 100 MB 上限")
                    output.write(chunk)
            if not total:
                raise ValueError("空文件")
            dest = _unique_dest(dest_folder, safe)
            os.replace(temp_path, dest)
            temp_path = None
            imported += 1
            item = _item_for_file(dest, root)
            if item:
                items.append(item)
        except (OSError, ValueError) as e:
            skipped += 1
            errors.append(f"{name}: {e}")
        finally:
            if temp_path:
                temp_path.unlink(missing_ok=True)
    return _import_result(imported, skipped, errors, items)


def _is_public_address(address: str) -> bool:
    value = ipaddress.ip_address(address)
    return not (
        value.is_private
        or value.is_loopback
        or value.is_link_local
        or value.is_multicast
        or value.is_reserved
        or value.is_unspecified
    )


def _validate_remote_url(value: str) -> urllib.parse.SplitResult:
    parsed = urllib.parse.urlsplit((value or "").strip())
    if parsed.scheme not in {"http", "https"}:
        raise ValueError("仅支持 http 或 https 图片链接")
    if not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("图片链接格式不安全")
    host = parsed.hostname.rstrip(".").lower()
    if host == "localhost" or host.endswith(".localhost"):
        raise ValueError("不允许下载本机地址")
    try:
        direct_address = ipaddress.ip_address(host)
        if direct_address.is_loopback:
            raise ValueError("不允许下载本机地址")
        if not _is_public_address(str(direct_address)):
            raise ValueError("不允许下载内网地址")
    except ValueError as error:
        if str(error).startswith("不允许"):
            raise
        try:
            addresses = {entry[4][0] for entry in socket.getaddrinfo(host, parsed.port or 443, type=socket.SOCK_STREAM)}
        except OSError as e:
            raise ValueError(f"无法解析图片地址: {e}") from e
        if not addresses or any(not _is_public_address(address) for address in addresses):
            raise ValueError("不允许下载内网地址")
    return parsed


class _SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        _validate_remote_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _extension_from_remote_file(temp_path: Path, source_url: str, content_type: str) -> str:
    extension = Path(urllib.parse.urlsplit(source_url).path).suffix.lower()
    mime_extensions = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/avif": ".avif",
    }
    if Image is None:
        return extension if extension in IMAGE_EXTENSIONS else mime_extensions.get(content_type, "")
    try:
        with Image.open(temp_path) as image:
            image.verify()
            detected = image.format
    except Exception as e:
        raise ValueError("链接内容不是可识别的图片") from e
    detected_extensions = {"JPEG": ".jpg", "PNG": ".png", "WEBP": ".webp", "GIF": ".gif", "BMP": ".bmp", "AVIF": ".avif"}
    return extension if extension in IMAGE_EXTENSIONS else detected_extensions.get(str(detected).upper(), mime_extensions.get(content_type, ""))


def import_remote_urls(urls: list[str], target: str = "unrated") -> dict:
    """从网页拖入的公开图片链接下载到图库；限制地址、体积和重定向以保护本机。"""
    root = _library_root()
    dest_folder = _import_target_folder(target, root)
    temp_folder = root / ".importing"
    temp_folder.mkdir(parents=True, exist_ok=True)
    imported, skipped = 0, 0
    errors: list[str] = []
    items: list[dict] = []
    opener = urllib.request.build_opener(_SafeRedirectHandler())
    for index, url in enumerate(dict.fromkeys(urls)):
        if index >= MAX_REMOTE_IMAGE_COUNT:
            skipped += 1
            errors.append("单次最多下载 20 张网页图片")
            continue
        temp_path: Path | None = None
        name = "网页图片"
        try:
            parsed = _validate_remote_url(url)
            name = _safe_filename(Path(urllib.parse.unquote(parsed.path)).name or name)
            request = urllib.request.Request(url, headers={"User-Agent": "PromptCard-Studio/1.2"})
            with opener.open(request, timeout=REMOTE_DOWNLOAD_TIMEOUT_SECONDS) as response:
                _validate_remote_url(response.geturl())
                content_type = response.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                length = response.headers.get("Content-Length")
                if length and int(length) > MAX_REMOTE_IMAGE_BYTES:
                    raise ValueError("图片超过 25 MB 上限")
                fd, raw_temp_path = tempfile.mkstemp(prefix="remote_", dir=temp_folder)
                temp_path = Path(raw_temp_path)
                total = 0
                with os.fdopen(fd, "wb") as output:
                    while chunk := response.read(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_REMOTE_IMAGE_BYTES:
                            raise ValueError("图片超过 25 MB 上限")
                        output.write(chunk)
            if not temp_path or not temp_path.stat().st_size:
                raise ValueError("下载到的图片为空")
            extension = _extension_from_remote_file(temp_path, url, content_type)
            if extension not in IMAGE_EXTENSIONS:
                raise ValueError("链接内容不是受支持的图片格式")
            filename = _safe_filename(f"{Path(name).stem or 'image'}{extension}")
            dest = _unique_dest(dest_folder, filename)
            os.replace(temp_path, dest)
            temp_path = None
            imported += 1
            item = _item_for_file(dest, root)
            if item:
                items.append(item)
        except (OSError, ValueError, urllib.error.URLError) as e:
            skipped += 1
            errors.append(f"{name}: {e}")
        finally:
            if temp_path:
                temp_path.unlink(missing_ok=True)
    return _import_result(imported, skipped, errors, items)


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


def copy_image_from_source(source: Path) -> dict:
    """供项目内模块安全地复制一张已验证图片到普通图库的未评分区域。"""
    source = source.resolve()
    if not _is_image(source):
        raise ValueError("只能复制存在的图片文件")
    destination = _unique_dest(_library_root(), _safe_filename(source.name))
    shutil.copy2(str(source), str(destination))
    return {"path": str(destination.relative_to(_library_root())), "name": destination.name}


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


def _send_to_trash(path: Path) -> tuple[str, Path | None]:
    """送系统回收站；失败则移入项目内 .trash/library。返回 (mode, 内部新位置)。"""
    try:
        import send2trash

        send2trash.send2trash(str(path))
        return "recycle", None
    except Exception:
        trash_dir = _library_root().parent / ".trash" / "library"
        trash_dir.mkdir(parents=True, exist_ok=True)
        target = trash_dir / f"{date.today():%Y%m%d}_{random.randint(10000, 99999)}_{path.name}"
        shutil.move(str(path), str(target))
        return "internal", target


def _target_folder(tag: str, today: str) -> Path:
    """筛选/移动目标目录：library/<前缀>/<前缀>-<日期>（分类大文件夹内部按日期归档）。"""
    prefixes = CATEGORY_PREFIXES.get(tag)
    prefix = prefixes[0] if prefixes else None
    if not prefix:
        raise ValueError(f"未知目标分类: {tag}")
    return _library_root() / prefix / f"{prefix}-{today}"


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
        if tag not in CATEGORY_PREFIXES:
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

        # Reject 作为图库内回收站：同样移动到 Reject-<日期> 文件夹，不删除
        dest_folder = _target_folder(tag, today)
        if src.parent == dest_folder:
            skipped.append({"path": rel, "tag": tag, "reason": "已在目标位置"})
            continue
        dest = _unique_dest(dest_folder, src.name)
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


def move_images(paths: list[str], target: str) -> dict:
    """快捷选取：把图片移动到目标文件夹（Treasure/Fine/Reject/收藏/未评分）。"""
    if target not in CATEGORY_PREFIXES and target != "unrated":
        raise ValueError(f"未知目标: {target}")
    root = _library_root()
    today = date.today().isoformat()
    applied: list[dict] = []
    skipped: list[dict] = []
    undo_ops: list[dict] = []

    for rel in paths:
        try:
            src = resolve_image(rel)
        except ValueError as e:
            skipped.append({"path": rel, "reason": str(e)})
            continue
        if not src.exists() or not src.is_file():
            skipped.append({"path": rel, "reason": "文件不存在"})
            continue
        dest_folder = root if target == "unrated" else _target_folder(target, today)
        if src.parent == dest_folder:
            skipped.append({"path": rel, "reason": "已在目标位置"})
            continue
        dest = _unique_dest(dest_folder, src.name)
        try:
            src.rename(dest)
        except OSError as e:
            skipped.append({"path": rel, "reason": str(e)})
            continue
        undo_ops.append({"undoable": True, "src": str(src), "dest": str(dest)})
        applied.append({"path": rel, "dest": dest.relative_to(root).as_posix()})

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
        "message": f"已移动 {len(applied)} 张，跳过 {len(skipped)} 张",
    }


def delete_images(paths: list[str]) -> dict:
    """删除图库内图片（Reject 回收站的一键删除）：按设置决定进系统回收站或永久删除。"""
    settings = load_settings()
    recycle = bool(settings.get("recycle_reject", True))
    deleted: list[dict] = []
    skipped: list[dict] = []

    for rel in paths:
        try:
            path = resolve_image(rel)
        except ValueError as e:
            skipped.append({"path": rel, "reason": str(e)})
            continue
        if not path.exists() or not path.is_file():
            skipped.append({"path": rel, "reason": "文件不存在"})
            continue
        if recycle:
            mode, _ = _send_to_trash(path)
            deleted.append({"path": rel, "mode": mode})
        else:
            try:
                path.unlink()
                deleted.append({"path": rel, "mode": "permanent"})
            except OSError as e:
                skipped.append({"path": rel, "reason": str(e)})

    return {
        "ok": True,
        "deleted": deleted,
        "skipped": skipped,
        "message": f"已删除 {len(deleted)} 张，跳过 {len(skipped)} 张",
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
