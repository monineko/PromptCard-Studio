import csv
import io
import json
import os
import random
import re
import shutil
import zipfile
from pathlib import Path

from .config import WILDCARDS_DIR

INVALID_CHARS = re.compile(r'[\\/:*?"<>|]')
WILDCARD_PATTERN = re.compile(r"<([^:<>]+):([^>]+)>")
_sequential_state: dict[str, int] = {}


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


def list_categories() -> list[dict]:
    result = []
    if not WILDCARDS_DIR.exists():
        return result
    for folder in sorted(p for p in WILDCARDS_DIR.iterdir() if p.is_dir()):
        cards = []
        for file in sorted(p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".txt"):
            content = _read_text(file)
            cards.append(
                {
                    "name": file.stem,
                    "preview": _preview(content),
                    "updated": file.stat().st_mtime,
                }
            )
        result.append({"name": folder.name, "count": len(cards), "cards": cards})
    return result


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
    return {"category": dest_cat, "name": dest_name, "content": content or ""}


def delete_card(category: str, name: str) -> None:
    path = _card_path(category, name)
    if not path.exists():
        raise FileNotFoundError(f"卡片不存在: <{category}:{name}>")
    _trash(path)


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
    return {"name": dst.name}


def delete_category(name: str) -> None:
    folder = _category_path(name)
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"分类不存在: {name}")
    _trash(folder)


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
