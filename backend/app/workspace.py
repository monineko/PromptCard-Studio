import json
import uuid

from .config import WORKSPACE_FILE

DEFAULT_SECTIONS = [
    {"name": "角色", "locked": True},
    {"name": "动作", "locked": True},
    {"name": "画师串", "locked": True},
    {"name": "其他", "locked": True},
]


def _section(name: str, locked: bool = False) -> dict:
    return {"id": uuid.uuid4().hex[:8], "name": name, "locked": locked, "blocks": []}


def _default_zone() -> list[dict]:
    return [_section(s["name"], s["locked"]) for s in DEFAULT_SECTIONS]


def _map_category_section(category: str) -> str:
    """卡片分类到工作区分区的映射：综合* → 综合，其余同名。"""
    if category.startswith("综合"):
        return "综合"
    return category


def _ensure_section(sections: list[dict], name: str) -> dict:
    for s in sections:
        if s["name"] == name:
            return s
    section = _section(name)
    sections.insert(len(sections) - 1, section)  # 插在“其他”之前
    return section


def _migrate_legacy(blocks: list) -> list[dict]:
    """旧格式（平铺块）迁移到分区模型：card 块按分类归区，文本块归“其他”。"""
    sections = _default_zone()
    for block in blocks:
        if not isinstance(block, dict) or "id" not in block:
            continue
        if block.get("type") == "card":
            section = _ensure_section(sections, _map_category_section(block.get("category", "")))
            section["blocks"].append(block)
        else:
            section = next(s for s in sections if s["name"] == "其他")
            section["blocks"].append({"id": block["id"], "type": "prompt", "text": block.get("text", "")})
    return sections


def load_workspace() -> dict:
    if WORKSPACE_FILE.exists():
        try:
            data = json.loads(WORKSPACE_FILE.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                positive = data.get("positive") or []
                negative = data.get("negative") or []
                if positive and isinstance(positive[0], dict) and "blocks" in positive[0]:
                    return {"positive": positive, "negative": negative}
                return {
                    "positive": _migrate_legacy(positive),
                    "negative": _migrate_legacy(negative),
                }
        except Exception:
            pass
    return {"positive": _default_zone(), "negative": _default_zone()}


def save_workspace(positive: list, negative: list) -> dict:
    data = {"positive": positive, "negative": negative}
    WORKSPACE_FILE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return data
