import csv
import io
import json
import os
import random
import re
import shutil
import time
import uuid
import zipfile
from datetime import date
from pathlib import Path

from .config import LIBRARY_DIR, PROJECT_ROOT, PROMPTCARDS_DIR, load_settings, save_settings
from .library import resolve_image

SYSTEM_CATEGORIES = {"角色", "动作", "画师串", "负面"}

# 项目初始化时预填的默认卡包分类（顺序即展示顺序）。
DEFAULT_CATEGORIES = ("角色", "动作", "画师串", "负面", "质量", "场景", "表情", "服装")
DEFAULT_CATEGORY_COLORS = {
    "角色": 0,
    "动作": 249,
    "画师串": 120,
    "质量": 300,
    "场景": 170,
    "表情": 330,
    "服装": 45,
}
_DEFAULTS_MARKER = "default_categories_initialized"

INVALID_CHARS = re.compile(r'[\\/:*?"<>|]')
WILDCARD_PATTERN = re.compile(r"<([^:<>]+):([^>]+)>")
_sequential_state: dict[str, int] = {}
_CARD_PREVIEW_CACHE: dict[str, tuple[int, int, str]] = {}
_CARD_PREVIEW_CACHE_MAX_ENTRIES = 20_000

CARD_IMAGES_FILE = PROMPTCARDS_DIR / ".card-images.json"
CARD_META_FILE = PROMPTCARDS_DIR / ".card-meta.json"
CARD_PINS_FILE = PROMPTCARDS_DIR / ".card-pins.json"
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"}
TEMPLATE_FILE = Path(__file__).resolve().parent / "assets" / "卡片导入模板.xlsx"
_SHEET_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_SPREADSHEET_DRAWING_NS = "{http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing}"
_DRAWING_NS = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


def _safe_name(name: str) -> str:
    name = (name or "").strip()
    name = INVALID_CHARS.sub("_", name)
    return name[:120]


def _category_path(category: str) -> Path:
    return PROMPTCARDS_DIR / _safe_name(category)


def ensure_default_categories() -> None:
    """项目初始化：补齐默认卡包分类的文件夹、颜色与展示顺序。

    仅在首次初始化时执行（以 settings 中的标记位判断），之后不覆盖用户的排序/颜色/删除操作。
    """
    settings = load_settings()
    if settings.get(_DEFAULTS_MARKER):
        return
    for name in DEFAULT_CATEGORIES:
        _category_path(name).mkdir(parents=True, exist_ok=True)
    colors = settings.get("category_colors") or {}
    changed_color = False
    for name, hue in DEFAULT_CATEGORY_COLORS.items():
        if name not in colors:
            colors[name] = hue
            changed_color = True
    if changed_color:
        save_settings({"category_colors": colors})
    order = settings.get("category_order") or []
    rest = [n for n in order if n not in DEFAULT_CATEGORIES]
    new_order = [*DEFAULT_CATEGORIES, *rest]
    if new_order != order:
        save_settings({"category_order": new_order})
    save_settings({_DEFAULTS_MARKER: True})


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


def _cached_preview(path: Path, stat: os.stat_result) -> str:
    """按文件时间与大小复用卡片摘要，避免每次刷新重读所有文本。"""
    key = str(path)
    cached = _CARD_PREVIEW_CACHE.get(key)
    signature = (stat.st_mtime_ns, stat.st_size)
    if cached and cached[:2] == signature:
        return cached[2]
    preview = _preview(_read_text(path))
    if len(_CARD_PREVIEW_CACHE) >= _CARD_PREVIEW_CACHE_MAX_ENTRIES and key not in _CARD_PREVIEW_CACHE:
        _CARD_PREVIEW_CACHE.pop(next(iter(_CARD_PREVIEW_CACHE)), None)
    _CARD_PREVIEW_CACHE[key] = (*signature, preview)
    return preview


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
    PROMPTCARDS_DIR.mkdir(parents=True, exist_ok=True)
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
    PROMPTCARDS_DIR.mkdir(parents=True, exist_ok=True)
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
    PROMPTCARDS_DIR.mkdir(parents=True, exist_ok=True)
    CARD_PINS_FILE.write_text(
        json.dumps(pins, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def list_categories() -> list[dict]:
    result = []
    if not PROMPTCARDS_DIR.exists():
        return result
    images = _load_card_images()
    meta = _load_card_meta()
    pins = _load_card_pins()
    for folder in sorted(p for p in PROMPTCARDS_DIR.iterdir() if p.is_dir()):
        cards = []
        cat_pins = pins.get(folder.name) or []
        pin_index = {n: i for i, n in enumerate(cat_pins)}
        for file in sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".txt"):
            stat = file.stat()
            key = f"{folder.name}:{file.stem}"
            created = meta.get(key) or stat.st_ctime
            cards.append(
                {
                    "name": file.stem,
                    "preview": _cached_preview(file, stat),
                    "updated": stat.st_mtime,
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
        trash_dir = PROMPTCARDS_DIR.parent / ".trash"
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
        if PROMPTCARDS_DIR.exists():
            for file in PROMPTCARDS_DIR.rglob("*.txt"):
                zf.write(file, file.relative_to(PROMPTCARDS_DIR))
    return buffer.getvalue()


def template_file() -> Path:
    """内置的卡片导入模板（随仓库分发，前端可下载）。"""
    return TEMPLATE_FILE


def _library_root_dir() -> Path:
    """图库根目录（与 library.py 解析逻辑一致，支持设置页自定义路径）。"""
    settings = load_settings()
    root = Path(settings.get("library_path") or "").expanduser()
    if not root.is_absolute():
        root = LIBRARY_DIR / root
    root.mkdir(parents=True, exist_ok=True)
    return root


def _unique_card_name(category: str, name: str) -> str:
    """同名卡片自动加后缀：名称 (1)、名称 (2)…，保证模板里的每一行都能导入。"""
    if get_card(category, name) is None:
        return name
    n = 1
    while True:
        candidate = f"{name} ({n})"
        if get_card(category, candidate) is None:
            return candidate
        n += 1


def import_template_xlsx(file_bytes: bytes) -> dict:
    """从「卡片导入模板」.xlsx 导入卡片。

    列：分类 / 名称 / 提示词 / 图片（可选）。
    - 仅第 1 行表头自动跳过，从第 2 行起均为数据行；
    - 分类不存在时自动创建卡包；中文名称/提示词均支持；
      与已有卡片同名时自动创建新卡片并加后缀（1）（2）…，不会跳过；
    - 图片列支持 WPS 单元格内嵌图片（DISPIMG）、Excel/WPS 浮动图片或本地图片路径，
      图片会复制到图库未评分目录（library/<日期>/）并自动设为该卡片的演示图。
    """
    import xml.etree.ElementTree as ET

    if not file_bytes:
        raise ValueError("文件为空")
    imported, skipped, errors, renamed_count = 0, 0, [], 0

    with zipfile.ZipFile(io.BytesIO(file_bytes)) as z:
        names = z.namelist()
        shared: list[str] = []
        if "xl/sharedStrings.xml" in names:
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root:
                shared.append("".join(t.text or "" for t in si.iter(_SHEET_NS + "t")))

        # WPS 单元格内嵌图片：cNvPr 的 name 即 DISPIMG 公式里的图片 ID
        cell_images: dict[str, bytes] = {}
        if "xl/cellimages.xml" in names and "xl/_rels/cellimages.xml.rels" in names:
            rels: dict[str, str] = {}
            rel_root = ET.fromstring(z.read("xl/_rels/cellimages.xml.rels"))
            for rel in rel_root:
                rels[rel.attrib.get("Id", "")] = rel.attrib.get("Target", "")
            ci_root = ET.fromstring(z.read("xl/cellimages.xml"))
            for pic in ci_root.iter(_SPREADSHEET_DRAWING_NS + "pic"):
                name_id = ""
                for nv in pic.iter(_SPREADSHEET_DRAWING_NS + "cNvPr"):
                    name_id = nv.attrib.get("name", "")
                    break
                blip = pic.find(f".//{_DRAWING_NS}blip")
                if blip is None:
                    continue
                rid = blip.attrib.get(f"{_REL_NS}embed", "")
                media = rels.get(rid, "").replace("../", "xl/")
                if media and not media.startswith("xl/"):
                    media = "xl/" + media.lstrip("/")
                if name_id and media in names:
                    cell_images[name_id] = z.read(media)

        # 传统浮动图片（xl/drawings）：按锚点行/列关联到数据行
        row_images: dict[int, bytes] = {}
        drawing_rel_path = "xl/worksheets/_rels/sheet1.xml.rels"
        if drawing_rel_path in names:
            drels_root = ET.fromstring(z.read(drawing_rel_path))
            drawing_target = ""
            for rel in drels_root:
                if "drawing" in rel.attrib.get("Type", ""):
                    drawing_target = rel.attrib.get("Target", "")
                    break
            if drawing_target:
                drawing_path = drawing_target.replace("../", "xl/")
                if drawing_path and not drawing_path.startswith("xl/"):
                    drawing_path = "xl/" + drawing_path.lstrip("/")
                if drawing_path not in names:
                    drawing_path = "xl/" + drawing_target.lstrip("/")
                if drawing_path in names:
                    d_rels_path = drawing_path.rsplit("/", 1)[0] + "/_rels/" + drawing_path.rsplit("/", 1)[1] + ".rels"
                    media_map: dict[str, bytes] = {}
                    if d_rels_path in names:
                        dr_root = ET.fromstring(z.read(d_rels_path))
                        for rel in dr_root:
                            media = rel.attrib.get("Target", "").replace("../", "xl/")
                            if media and not media.startswith("xl/"):
                                media = "xl/" + media.lstrip("/")
                            if media in names:
                                media_map[rel.attrib.get("Id", "")] = z.read(media)
                    draw_root = ET.fromstring(z.read(drawing_path))
                    for anchor in draw_root.iter():
                        tag = anchor.tag
                        if not (tag.endswith("}twoCellAnchor") or tag.endswith("}oneCellAnchor")):
                            continue
                        frm = anchor.find(f"{_SPREADSHEET_DRAWING_NS}from")
                        to = anchor.find(f"{_SPREADSHEET_DRAWING_NS}to")
                        if frm is None:
                            continue
                        col0 = int(frm.findtext(f"{_SPREADSHEET_DRAWING_NS}col") or 0)
                        row0 = int(frm.findtext(f"{_SPREADSHEET_DRAWING_NS}row") or 0)
                        col1 = int(to.findtext(f"{_SPREADSHEET_DRAWING_NS}col") or col0) if to is not None else col0
                        blip = anchor.find(f".//{_DRAWING_NS}blip")
                        if blip is None:
                            continue
                        rid = blip.attrib.get(f"{_REL_NS}embed", "")
                        if rid not in media_map:
                            continue
                        # 图片应放在「图片（可选）」列（D，0 基列号 3）
                        if col0 <= 3 <= col1:
                            row_images.setdefault(row0 + 1, media_map[rid])

        rows: list[tuple[int, dict[str, dict]]] = []
        sheet_root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        for row in sheet_root.iter(_SHEET_NS + "row"):
            r = int(row.attrib.get("r", "0"))
            cells: dict[str, dict] = {}
            for c in row.iter(_SHEET_NS + "c"):
                ref = c.attrib.get("r", "")
                col = "".join(ch for ch in ref if ch.isalpha())
                formula = c.find(_SHEET_NS + "f")
                if formula is not None:
                    cells[col] = {"formula": formula.text or ""}
                    continue
                if c.attrib.get("t") == "inlineStr":
                    inline = c.find(_SHEET_NS + "is")
                    cells[col] = {
                        "text": "" if inline is None else "".join(
                            t.text or "" for t in inline.iter(_SHEET_NS + "t")
                        )
                    }
                    continue
                v = c.find(_SHEET_NS + "v")
                if v is None:
                    continue
                if c.attrib.get("t") == "s":
                    try:
                        cells[col] = {"text": shared[int(v.text)]}
                    except (ValueError, IndexError):
                        cells[col] = {"text": ""}
                else:
                    cells[col] = {"text": v.text or ""}
            rows.append((r, cells))
        rows.sort(key=lambda x: x[0])

    before = {p.name for p in PROMPTCARDS_DIR.iterdir() if p.is_dir()} if PROMPTCARDS_DIR.exists() else set()

    def _text(row_cells: dict[str, dict], col: str) -> str:
        return (row_cells.get(col) or {}).get("text", "").strip()

    def _formula(row_cells: dict[str, dict], col: str) -> str:
        return (row_cells.get(col) or {}).get("formula", "")

    for r, row_cells in rows:
        if r <= 1:
            continue  # 第 1 行表头
        category = _text(row_cells, "A")
        name = _text(row_cells, "B")
        content = _text(row_cells, "C")
        if not category and not name and not content and not _formula(row_cells, "D"):
            continue  # 空行
        if not category:
            errors.append(f"第 {r} 行：缺少分类")
            continue
        if not name:
            errors.append(f"第 {r} 行：缺少名称")
            continue

        image_bytes: bytes | None = None
        image_name = ""
        formula = _formula(row_cells, "D")
        m = re.search(r'DISPIMG\s*\(\s*"([^"]+)"', formula)
        if m:
            image_bytes = cell_images.get(m.group(1))
            if image_bytes is None:
                errors.append(f"第 {r} 行：内嵌图片引用无效")
        else:
            image_bytes = row_images.get(r)
            if image_bytes is None:
                img_path = _text(row_cells, "D")
                if img_path:
                    p = Path(img_path).expanduser()
                    if p.exists() and p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS:
                        image_bytes = p.read_bytes()
                        image_name = p.name
                    else:
                        errors.append(f"第 {r} 行：图片路径无效或不是图片文件")

        final_name = _unique_card_name(category, name)
        if final_name != name:
            renamed_count += 1
        try:
            create_card(category, final_name, content)
            imported += 1
        except FileExistsError:
            skipped += 1
            continue
        except Exception as e:
            errors.append(f"第 {r} 行：{e}")
            continue

        if image_bytes:
            try:
                ext = Path(image_name).suffix.lower() or ".png"
                lib_root = _library_root_dir()
                dest_dir = lib_root / date.today().isoformat()
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / f"{_safe_name(name)}_{uuid.uuid4().hex[:6]}{ext}"
                dest.write_bytes(image_bytes)
                set_card_image(category, final_name, dest.relative_to(lib_root).as_posix())
            except Exception as e:
                errors.append(f"第 {r} 行：图片保存失败 {e}")

    after = {p.name for p in PROMPTCARDS_DIR.iterdir() if p.is_dir()} if PROMPTCARDS_DIR.exists() else set()
    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
        "created_categories": sorted(after - before),
        "renamed": renamed_count,
    }
