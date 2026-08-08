import csv
import io
import json
import os
import random
import re
import shutil
import time
import zipfile
from pathlib import Path

from .config import WILDCARDS_DIR, load_settings, save_settings
from .library import resolve_image

SYSTEM_CATEGORIES = {"角色", "动作", "画师串", "负面"}

INVALID_CHARS = re.compile(r'[\\/:*?"<>|]')
WILDCARD_PATTERN = re.compile(r"<([^:<>]+):([^>]+)>")
_sequential_state: dict[str, int] = {}

CARD_IMAGES_FILE = WILDCARDS_DIR / ".card-images.json"
CARD_META_FILE = WILDCARDS_DIR / ".card-meta.json"
CARD_PINS_FILE = WILDCARDS_DIR / ".card-pins.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}


def _safe_name(name: str) -> str:
    name = (name or "").strip()
    name = INVALID_CHARS.sub("_", name)
    return name[:120]


def _category_path(category: str) -> Path:
    return WILDCARDS_DIR / _safe_name(category)


def _card_path(category: str, name: str) -> Path:
    return _category_path(category) / f"{_safe_name(name)}.txt"


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except Exception:
        return path.read_text(encoding="utf-8", errors="replace")


def _preview(content: str, limit: int = 100) -> str:
    text = content.replace("\r\n", "\n").replace("\n", " / ").strip()
    return text[:limit] + ("…" if len(text) > limit else "")


def _load_card_images() -> dict[str, str]:
    """卡片演示图映射：{"<分类>:<名称>": 图库相对路径}。"""
    if not CARD_IMAGES_FILE.exists():
        return {}
    try:
        data = json.loads(CARD_IMAGES_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_card_images(images: dict[str, str]) -> None:
    WILDCARDS_DIR.mkdir(parents=True, exist_ok=True)
    CARD_IMAGES_FILE.write_text(
        json.dumps(images, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _load_card_meta() -> dict[str, float]:
    """卡片创建时间映射：{"<分类>:<名称>": 创建时间戳}。"""
    if not CARD_META_FILE.exists():
        return {}
    try:
        data = json.loads(CARD_META_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_card_meta(meta: dict[str, float]) -> None:
    WILDCARDS_DIR.mkdir(parents=True, exist_ok=True)
    CARD_META_FILE.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def _touch_card_meta(category: str, name: str, ts: float | None = None) -> None:
    meta = _load_card_meta()
    key = f"{_safe_name(category)}:{_safe_name(name)}"
    if key in meta:
        return
    meta[key] = ts if ts is not None else time.time()
    _save_card_meta(meta)


def _load_card_pins() -> dict[str, list[str]]:
    """卡片顺序：{"<分类>": [卡片名称…]}，列表首位 = 最前（新卡/置顶都插入首位）。"""
    if not CARD_PINS_FILE.exists():
        return {}
    try:
        data = json.loads(CARD_PINS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _save_card_pins(pins: dict[str, list[str]]) -> None:
    WILDCARDS_DIR.mkdir(parents=True, exist_ok=True)
    CARD_PINS_FILE.write_text(
        json.dumps(pins, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def list_categories() -> list[dict]:
    result = []
    if not WILDCARDS_DIR.exists():
        return result
    images = _load_card_images()
    meta = _load_card_meta()
    pins = _load_card_pins()
    for folder in sorted(p for p in WILDCARDS_DIR.iterdir() if p.is_dir()):
        cards = []
        cat_pins = pins.get(folder.name) or []
        pin_index = {n: i for i, n in enumerate(cat_pins)}
        for file in sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".txt"):
            content = _read_text(file)
            key = f"{folder.name}:{file.stem}"
            created = meta.get(key) or file.stat().st_ctime
            cards.append(
                {
                    "name": file.stem,
                    "preview": _preview(content),
                    "updated": file.stat().st_mtime,
                    "created": created,
                    "image": images.get(key) or None,
                }
            )
        # 顺序列表（新卡/置顶在最前）优先，未收录的卡片按创建时间倒序兜底
        cards.sort(key=lambda c: (pin_index.get(c["name"], 10**9), -c["created"], c["name"]))
        result.append({"name": folder.name, "count": len(cards), "cards": cards})
    settings = load_settings()
    order = settings.get("category_order") or []
    colors = settings.get("category_colors") or {}
    for c in result:
        c["color"] = colors.get(c["name"])
    by_name = {c["name"]: c for c in result}
    ordered = [by_name[n] for n in order if n in by_name]
    rest = [c for c in result if c["name"] not in order]
    return ordered + rest


def get_card(category: str, name: str) -> dict | None:
    path = _card_path(category, name)
    if not path.exists():
        return None
    return {"category": category, "name": path.stem, "content": _read_text(path)}


def create_card(category: str, name: str, content: str) -> dict:
    cat = _safe_name(category)
    card_name = _safe_name(name)
    if not cat or not card_name:
        raise ValueError("分类与名称不能为空")
    folder = _category_path(cat)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{card_name}.txt"
    if path.exists():
        raise FileExistsError(f"卡片已存在: <{cat}:{card_name}>")
    path.write_text(content or "", encoding="utf-8")
    _touch_card_meta(cat, card_name)
    # 新添加的卡片自动放到分类第一位
    pins = _load_card_pins()
    cat_pins = list(pins.get(cat) or [])
    if card_name in cat_pins:
        cat_pins.remove(card_name)
    cat_pins.insert(0, card_name)
    pins[cat] = cat_pins
    _save_card_pins(pins)
    return {"category": cat, "name": card_name, "content": content or ""}


def update_card(
    category: str,
    name: str,
    content: str,
    new_category: str | None = None,
    new_name: str | None = None,
) -> dict:
    path = _card_path(category, name)
    if not path.exists():
        raise FileNotFoundError(f"卡片不存在: <{category}:{name}>")
    dest_cat = _safe_name(new_category) if new_category else _safe_name(category)
    dest_name = _safe_name(new_name) if new_name else path.stem
    if not dest_cat or not dest_name:
        raise ValueError("分类与名称不能为空")
    dest_path = _category_path(dest_cat) / f"{dest_name}.txt"
    if dest_path != path:
        if dest_path.exists():
            raise FileExistsError(f"目标卡片已存在: <{dest_cat}:{dest_name}>")
        _category_path(dest_cat).mkdir(parents=True, exist_ok=True)
        path.rename(dest_path)
    dest_path.write_text(content or "", encoding="utf-8")
    images = _load_card_images()
    old_key = f"{_safe_name(category)}:{_safe_name(name)}"
    new_key = f"{dest_cat}:{dest_name}"
    if old_key != new_key and old_key in images:
        images[new_key] = images.pop(old_key)
        _save_card_images(images)
    meta = _load_card_meta()
    if old_key != new_key:
        if old_key in meta:
            meta[new_key] = meta.pop(old_key)
        else:
            meta[new_key] = time.time()
        _save_card_meta(meta)
    # 置顶记录跟随卡片改名/移动分类
    pins = _load_card_pins()
    old_cat = _safe_name(category)
    old_card = _safe_name(name)
    cat_pins = list(pins.get(old_cat) or [])
    if old_card in cat_pins:
        cat_pins[cat_pins.index(old_card)] = dest_name
        pins[dest_cat] = cat_pins
        if dest_cat != old_cat:
            pins.pop(old_cat, None)
        _save_card_pins(pins)
    return {"category": dest_cat, "name": dest_name, "content": content or ""}


def delete_card(category: str, name: str) -> None:
    path = _card_path(category, name)
    if not path.exists():
        raise FileNotFoundError(f"卡片不存在: <{category}:{name}>")
    _trash(path)
    images = _load_card_images()
    key = f"{_safe_name(category)}:{_safe_name(name)}"
    if key in images:
        images.pop(key)
        _save_card_images(images)
    meta = _load_card_meta()
    if key in meta:
        meta.pop(key)
        _save_card_meta(meta)
    pins = _load_card_pins()
    cat_pins = list(pins.get(_safe_name(category)) or [])
    card_name = _safe_name(name)
    if card_name in cat_pins:
        cat_pins.remove(card_name)
        if cat_pins:
            pins[_safe_name(category)] = cat_pins
        else:
            pins.pop(_safe_name(category), None)
        _save_card_pins(pins)


def create_category(name: str) -> dict:
    cat = _safe_name(name)
    if not cat:
        raise ValueError("分类名称不能为空")
    folder = _category_path(cat)
    folder.mkdir(parents=True, exist_ok=True)
    return {"name": cat}


def rename_category(old_name: str, new_name: str) -> dict:
    src = _category_path(old_name)
    dst = _category_path(new_name)
    if not src.exists() or not src.is_dir():
        raise FileNotFoundError(f"分类不存在: {old_name}")
    if dst.exists() and dst != src:
        raise FileExistsError(f"目标分类已存在: {new_name}")
    if dst != src:
        src.rename(dst)
    settings = load_settings()
    colors = settings.get("category_colors") or {}
    if old_name in colors:
        colors[new_name] = colors.pop(old_name)
        save_settings({"category_colors": colors})
    images = _load_card_images()
    changed = False
    prefix = f"{_safe_name(old_name)}:"
    for key in list(images):
        if key.startswith(prefix):
            images[f"{dst.name}:{key[len(prefix):]}"] = images.pop(key)
            changed = True
    if changed:
        _save_card_images(images)
    meta = _load_card_meta()
    prefix = f"{_safe_name(old_name)}:"
    changed_meta = False
    for key in list(meta):
        if key.startswith(prefix):
            meta[f"{dst.name}:{key[len(prefix):]}"] = meta.pop(key)
            changed_meta = True
    if changed_meta:
        _save_card_meta(meta)
    pins = _load_card_pins()
    old_cat = _safe_name(old_name)
    new_cat = dst.name
    if old_cat in pins and new_cat != old_cat:
        pins[new_cat] = pins.pop(old_cat)
        _save_card_pins(pins)
    return {"name": dst.name}


def delete_category(name: str) -> None:
    if name in SYSTEM_CATEGORIES:
        raise ValueError("系统默认分类不可删除")
    folder = _category_path(name)
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"分类不存在: {name}")
    _trash(folder)
    settings = load_settings()
    colors = settings.get("category_colors") or {}
    if name in colors:
        colors.pop(name)
        save_settings({"category_colors": colors})
    images = _load_card_images()
    prefix = f"{_safe_name(name)}:"
    if any(k.startswith(prefix) for k in images):
        for key in [k for k in images if k.startswith(prefix)]:
            images.pop(key)
        _save_card_images(images)
    meta = _load_card_meta()
    if any(k.startswith(prefix) for k in meta):
        for key in [k for k in meta if k.startswith(prefix)]:
            meta.pop(key)
        _save_card_meta(meta)
    pins = _load_card_pins()
    if _safe_name(name) in pins:
        del pins[_safe_name(name)]
        _save_card_pins(pins)


def pin_card_to_front(category: str, name: str) -> dict:
    """把卡片抽出来放到分类第一位（作为封面），无额外状态。"""
    cat = _safe_name(category)
    card_name = _safe_name(name)
    path = _card_path(cat, card_name)
    if not path.exists():
        raise FileNotFoundError(f"卡片不存在: <{cat}:{card_name}>")
    pins = _load_card_pins()
    cat_pins = list(pins.get(cat) or [])
    if card_name in cat_pins:
        cat_pins.remove(card_name)
    cat_pins.insert(0, card_name)
    pins[cat] = cat_pins
    _save_card_pins(pins)
    return {"ok": True}


def list_cards_images() -> dict:
    return _load_card_images()


def set_card_image(category: str, name: str, path: str) -> dict:
    """为卡片绑定一张图库内图片作为演示图。"""
    cat, card_name = _safe_name(category), _safe_name(name)
    if get_card(cat, card_name) is None:
        raise FileNotFoundError(f"卡片不存在: <{cat}:{card_name}>")
    if not path or Path(path).suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError("图片路径无效")
    file = resolve_image(path)
    if not file.exists() or not file.is_file():
        raise FileNotFoundError("图片不存在")
    images = _load_card_images()
    images[f"{cat}:{card_name}"] = path
    _save_card_images(images)
    return {"ok": True, "category": cat, "name": card_name, "path": path}


def remove_card_image(category: str, name: str) -> dict:
    images = _load_card_images()
    key = f"{_safe_name(category)}:{_safe_name(name)}"
    if key in images:
        images.pop(key)
        _save_card_images(images)
    return {"ok": True}


def _trash(path: Path) -> None:
    try:
        import send2trash

        send2trash.send2trash(str(path))
    except Exception:
        trash_dir = WILDCARDS_DIR.parent / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)
        target = trash_dir / f"{path.name}_{random.randint(1000, 9999)}"
        shutil.move(str(path), str(target))


def normalize(text: str) -> str:
    lines = text.splitlines(keepends=True)
    formatted = []
    for line in lines:
        content = line[:-1] if line.endswith("\n") else line
        content = re.sub(r"[,\s]*,[,\s]*", ", ", content)
        content = re.sub(r" +", " ", content).strip()
        formatted.append(content + ("\n" if line.endswith("\n") else ""))
    return "".join(formatted).strip()


def _resolve_card_text(category: str, name: str) -> str | None:
    folder = _category_path(category)
    if name == "随机":
        txts = sorted(p for p in folder.glob("*.txt") if p.is_file())
        if not txts:
            return None
        return _read_text(random.choice(txts))
    if name == "顺序":
        txts = sorted(p for p in folder.glob("*.txt") if p.is_file())
        if not txts:
            return None
        idx = _sequential_state.get(category, 0)
        _sequential_state[category] = idx + 1
        return _read_text(txts[idx % len(txts)])
    path = _card_path(category, name)
    if not path.exists():
        return None
    return _read_text(path)


def expand(text: str, max_depth: int = 20) -> str:
    """递归展开 <分类:名称> 引用，带循环检测；随后做格式规范化。"""
    stack: set[str] = set()

    def _expand(t: str, depth: int) -> str:
        if depth > max_depth:
            return t
        matches = WILDCARD_PATTERN.findall(t)
        if not matches:
            return t
        for category, name in matches:
            token = f"<{category}:{name}>"
            key = f"{category}:{name}"
            if key in stack:
                continue  # 循环引用：保留原样
            resolved = _resolve_card_text(category, name)
            if resolved is None:
                continue  # 卡片缺失：保留原 token
            stack.add(key)
            resolved = _expand(resolved, depth + 1)
            stack.discard(key)
            t = t.replace(token, resolved)
        return t

    return normalize(_expand(text, 0))


def export_zip() -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        if WILDCARDS_DIR.exists():
            for file in WILDCARDS_DIR.rglob("*.txt"):
                zf.write(file, file.relative_to(WILDCARDS_DIR))
    return buffer.getvalue()


def import_anr_directory(path_str: str) -> dict:
    source = Path(path_str)
    if not source.exists() or not source.is_dir():
        raise FileNotFoundError(f"目录不存在: {path_str}")
    imported, skipped = 0, 0
    for folder in sorted(p for p in source.iterdir() if p.is_dir()):
        for file in sorted(p for p in folder.iterdir() if p.suffix.lower() == ".txt"):
            try:
                create_card(folder.name, file.stem, _read_text(file))
                imported += 1
            except FileExistsError:
                skipped += 1
    for file in sorted(p for p in source.iterdir() if p.suffix.lower() == ".txt"):
        try:
            create_card("未分类", file.stem, _read_text(file))
            imported += 1
        except FileExistsError:
            skipped += 1
    return {"imported": imported, "skipped": skipped, "errors": []}


def import_csv_file(file_bytes: bytes) -> dict:
    text = file_bytes.decode("utf-8-sig")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if rows and rows[0] and rows[0][0].strip() in ("分类", "类别", "category"):
        rows = rows[1:]
    imported, skipped, errors = 0, 0, []
    for idx, row in enumerate(rows, start=1):
        if len(row) < 3:
            errors.append(f"第 {idx} 行：列数不足")
            continue
        category, name, content = row[0].strip(), row[1].strip(), ",".join(row[2:])
        try:
            create_card(category, name, content)
            imported += 1
        except FileExistsError:
            skipped += 1
        except Exception as e:
            errors.append(f"第 {idx} 行：{e}")
    return {"imported": imported, "skipped": skipped, "errors": errors}


def import_json_file(file_bytes: bytes) -> dict:
    data = json.loads(file_bytes.decode("utf-8"))
    items = []
    if isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                items.append(item)
    elif isinstance(data, dict):
        for category, cards in data.items():
            if isinstance(cards, dict):
                for name, content in cards.items():
                    items.append({"category": category, "name": name, "content": content})
    imported, skipped, errors = 0, 0, []
    for idx, item in enumerate(items, start=1):
        category = str(item.get("category", "")).strip()
        name = str(item.get("name", "")).strip()
        content = str(item.get("content", ""))
        try:
            create_card(category, name, content)
            imported += 1
        except FileExistsError:
            skipped += 1
        except Exception as e:
            errors.append(f"第 {idx} 条：{e}")
    return {"imported": imported, "skipped": skipped, "errors": errors}
