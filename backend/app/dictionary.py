"""提示词中文标注词典：本地查词 + 用户词典。

- 内置词典（可选）：dictionary/tags.json，只读，由用户自行放入（例如从标签库转换而来）。
  格式：{"term": "中文名,同义词1,别名2"} 或 {"term": {"cn": "中文名", "category": "角色"}}。
  category 为词典标签映射到本项目卡包分类后的名称（角色/动作/画师串/负面/质量/场景/表情/服装）。
- 用户词典：dictionary/custom.json，应用内“保存到词典”写入，格式同上（term -> 中文名）。
  查词优先级：用户词典 > 内置词典；用户词典条目不携带分类。
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from .config import DICTIONARY_DIR

BUILTIN_FILE = DICTIONARY_DIR / "tags.json"
CUSTOM_FILE = DICTIONARY_DIR / "custom.json"

_builtin_cache: dict[str, Any] | None = None
_builtin_mtime: float | None = None
_custom_cache: dict[str, Any] | None = None
_custom_mtime: float | None = None


def normalize_term(value: str) -> str:
    """与参考实现的标签名归一化一致：小写、空白/连字符 -> 下划线。"""
    text = str(value or "").strip().lower()
    text = re.sub(r"[\s\-]+", "_", text)
    return re.sub(r"_+", "_", text).strip("_")


def _load_json(file: Path) -> dict[str, Any]:
    if not file.exists() or file.stat().st_size == 0:
        return {}
    try:
        data = json.loads(file.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _load_builtin() -> dict[str, Any]:
    global _builtin_cache, _builtin_mtime
    if not BUILTIN_FILE.exists():
        _builtin_cache = None
        return {}
    mtime = BUILTIN_FILE.stat().st_mtime
    if _builtin_cache is None or _builtin_mtime != mtime:
        _builtin_cache = _load_json(BUILTIN_FILE)
        _builtin_mtime = mtime
    return _builtin_cache or {}


def _load_custom() -> dict[str, Any]:
    global _custom_cache, _custom_mtime
    if not CUSTOM_FILE.exists():
        _custom_cache = None
        return {}
    mtime = CUSTOM_FILE.stat().st_mtime
    if _custom_cache is None or _custom_mtime != mtime:
        _custom_cache = _load_json(CUSTOM_FILE)
        _custom_mtime = mtime
    return _custom_cache or {}


def _cn_of(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("cn") or "").strip()
    return str(entry or "").strip()


def _category_of(entry: Any) -> str:
    if isinstance(entry, dict):
        return str(entry.get("category") or "").strip()
    return ""


def lookup_one(term: str) -> tuple[str, str, str]:
    """返回 (cn, source, category)。source: custom / builtin / ""。"""
    raw = str(term or "").strip()
    if not raw:
        return "", "", ""
    normalized = normalize_term(raw)
    for source, table in (("custom", _load_custom()), ("builtin", _load_builtin())):
        for key in (raw, normalized):
            if not key:
                continue
            entry = table.get(key)
            if entry is None:
                continue
            cn = _cn_of(entry)
            if cn:
                return cn, source, _category_of(entry)
    return "", "", ""


def lookup_batch(terms: list[str]) -> dict[str, dict[str, str]]:
    results: dict[str, dict[str, str]] = {}
    for term in terms:
        cn, source, category = lookup_one(term)
        results[str(term)] = {"cn": cn, "source": source, "category": category}
    return results


def save_custom(term: str, cn: str) -> dict[str, Any]:
    raw = str(term or "").strip()
    text = str(cn or "").strip()
    if not raw:
        raise ValueError("标签名不能为空")
    if not text:
        raise ValueError("中文翻译不能为空")
    table = _load_custom()
    table[normalize_term(raw)] = text
    CUSTOM_FILE.write_text(
        json.dumps(table, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    global _custom_cache, _custom_mtime
    _custom_cache = table
    _custom_mtime = CUSTOM_FILE.stat().st_mtime if CUSTOM_FILE.exists() else None
    return {"ok": True, "count": len(table)}


def status() -> dict[str, Any]:
    builtin = _load_builtin()
    custom = _load_custom()
    return {
        "builtin_count": len(builtin),
        "custom_count": len(custom),
        "folder": str(DICTIONARY_DIR),
        "builtin_file": str(BUILTIN_FILE),
        "custom_file": str(CUSTOM_FILE),
    }


def open_dictionary_folder() -> dict[str, Any]:
    """用系统资源管理器打开词典目录。"""
    DICTIONARY_DIR.mkdir(parents=True, exist_ok=True)
    try:
        if os.name == "nt":
            os.startfile(str(DICTIONARY_DIR))  # type: ignore[attr-defined]
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(DICTIONARY_DIR)])
    except Exception as e:
        raise RuntimeError(f"无法打开词典文件夹：{e}") from e
    return {"ok": True, "path": str(DICTIONARY_DIR)}
