import json
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROMPTCARDS_DIR = PROJECT_ROOT / "promptcards"
LIBRARY_DIR = PROJECT_ROOT / "library"
BACKGROUNDS_DIR = PROJECT_ROOT / "frontend" / "src" / "assets" / "backgrounds"
VIBES_DIR = PROJECT_ROOT / "vibes"
DICTIONARY_DIR = PROJECT_ROOT / "dictionary"
CONFIG_FILE = PROJECT_ROOT / "config.json"
WORKSPACE_FILE = PROJECT_ROOT / "workspace.json"

DEFAULT_SETTINGS = {
    "theme": {
        "mode": "dark",          # light | dark
        "accent": "#8b5cf6",     # 主色
        "glass": 0.6,            # 玻璃强度 0-1
    },
    # "" = 项目默认图库（<项目根>/library），跟随项目文件夹移动/改名；用户可改为其他绝对路径
    "library_path": "",
    "recycle_reject": True,        # 筛选结束时 Reject 图片移入回收站（False = 永久删除）
    "format_input": True,        # 复制时是否做格式规范化
    "port": 14419,               # 首选端口；启动脚本在被占用时自动顺延
    "multi_character": True,     # 多角色：角色分区逐块作为独立角色；关闭后并入正面提示词
    "show_chinese": True,        # 显示中文翻译（词典标注）；关闭后块上不显示，备注不受影响
    "auto_note": True,           # 自动备注：查词后按分类预填块备注（负面/其他保持灰色）
    "category_order": [],        # 分类的拖拽排序（名称列表）
    "category_colors": {},       # 分类的自定义颜色（名称 → 色相值）
    "effects": {                 # 特效开关（界面个性化）
        "background_rotation": True,   # 背景图轮换（关闭后为纯静态背景，仅日/夜配色）
        "review_particles": True,      # 图片筛选粒子（烟花/爱心）
        "review_animations": True,     # 图片筛选动效（飞入出/变色/淡化）
    },
}

# 项目历史曾用文件夹名：改名后旧绝对路径会失效，加载时自动迁移回默认图库
_LEGACY_PROJECT_DIR_NAMES = ("novelai-prompt-manager",)


def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _is_legacy_library_path(value: str) -> bool:
    """判断是否指向旧项目文件夹（路径组件中包含历史项目名）。"""
    try:
        parts = Path(value).resolve().parts
    except OSError:
        return False
    return any(part.lower() in _LEGACY_PROJECT_DIR_NAMES for part in parts)


def _resolve_library_path(value: str) -> str:
    """规范化 library_path：空值或旧项目路径 → 当前项目默认图库。"""
    if not value:
        return str(LIBRARY_DIR)
    if _is_legacy_library_path(value):
        return str(LIBRARY_DIR)
    return str(value)


def load_settings() -> dict:
    data = {}
    if CONFIG_FILE.exists():
        try:
            data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    merged = _deep_merge(DEFAULT_SETTINGS, data)
    # 迁移：旧项目文件夹名写死的图库路径 → 当前项目默认（落盘，避免每次启动再走旧路径）
    stored = merged.get("library_path") or ""
    if stored and _is_legacy_library_path(stored):
        merged["library_path"] = ""
        try:
            CONFIG_FILE.write_text(
                json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
            )
        except OSError:
            pass
    # 对外（API/前端）始终返回可用的绝对路径
    merged["library_path"] = _resolve_library_path(merged.get("library_path") or "")
    return merged


def save_settings(settings: dict) -> dict:
    merged = _deep_merge(load_settings(), settings)
    # 默认图库不写绝对路径：空字符串表示"跟随项目"，项目改名/移动后不会失效
    if "library_path" in merged:
        resolved = _resolve_library_path(merged.get("library_path") or "")
        merged["library_path"] = "" if resolved == str(LIBRARY_DIR) else merged["library_path"]
    CONFIG_FILE.write_text(
        json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return merged


def ensure_dirs():
    PROMPTCARDS_DIR.mkdir(parents=True, exist_ok=True)
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    BACKGROUNDS_DIR.mkdir(parents=True, exist_ok=True)
    VIBES_DIR.mkdir(parents=True, exist_ok=True)
    DICTIONARY_DIR.mkdir(parents=True, exist_ok=True)
