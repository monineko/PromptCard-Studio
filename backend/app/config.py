import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WILDCARDS_DIR = PROJECT_ROOT / "wildcards"
LIBRARY_DIR = PROJECT_ROOT / "library"
BACKGROUNDS_DIR = PROJECT_ROOT / "backgrounds"
CONFIG_FILE = PROJECT_ROOT / "config.json"
WORKSPACE_FILE = PROJECT_ROOT / "workspace.json"

DEFAULT_SETTINGS = {
    "theme": {
        "mode": "dark",          # light | dark
        "accent": "#8b5cf6",     # 主色
        "glass": 0.6,            # 玻璃强度 0-1
    },
    "library_path": str(LIBRARY_DIR),
    "recycle_reject": True,        # 筛选结束时 Reject 图片移入回收站（False = 永久删除）
    "format_input": True,        # 复制时是否做格式规范化
    "port": 11451,
    "category_order": [],        # 分类的拖拽排序（名称列表）
    "category_colors": {},       # 分类的自定义颜色（名称 → 色相值）
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def load_settings() -> dict:
    data = {}
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    return _deep_merge(DEFAULT_SETTINGS, data)


def save_settings(settings: dict) -> dict:
    merged = _deep_merge(load_settings(), settings)
    CONFIG_FILE.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return merged


def ensure_dirs():
    WILDCARDS_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
