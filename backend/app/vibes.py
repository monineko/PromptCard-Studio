"""Vibe（.naiv4vibe 文件）解析与编码选择。

文件为 JSON，结构：identifier/type/image/id/encodings/name/thumbnail/importInfo。
- encodings: {模型键: {哈希: {encoding: base64, params: {information_extracted: float}}}}
- importInfo: {model, information_extracted, strength}
同一文件可保存多个 information_extracted 变体（不同哈希），官网按滑块值选择最接近的编码。
"""

import json
import hashlib
import os
from datetime import datetime
from pathlib import Path, PurePosixPath

from .config import VIBES_DIR

# ANR model_vibe_map：模型 ID → .naiv4vibe 内 encodings 的键
MODEL_VIBE_KEYS = {
    "nai-diffusion-4-5-full": "v4-5full",
    "nai-diffusion-4-5-curated": "v4-5curated",
    "nai-diffusion-4-full": "v4full",
    "nai-diffusion-4-curated-preview": "v4curated",
}

DEFAULT_VIBE_FOLDERS = ["nai4.5", "nai4", "其他", "nai5"]
VIBE_FOLDER_LABELS = {"nai4.5": "NAI 4.5", "nai4": "NAI 4", "其他": "其他", "nai5": "NAI 5（占位）"}

_THUMB_PREFIX = "data:image/jpeg;base64,"


def _load(file: Path) -> dict | None:
    try:
        data = json.loads(file.read_bytes())
    except Exception:
        return None
    if not isinstance(data, dict) or data.get("type") != "image":
        return None
    return data


def _safe_id(vibe_id: str) -> str:
    """防路径穿越：允许 vibes 目录下的相对路径，统一使用 /。"""
    cleaned = str(vibe_id or "").strip().replace("\\", "/")
    path = PurePosixPath(cleaned)
    if (
        not cleaned
        or path.is_absolute()
        or any(part in ("", ".", "..") for part in path.parts)
        or ":" in cleaned
    ):
        raise ValueError(f"非法的 vibe id: {vibe_id!r}")
    return cleaned


def _safe_folder(folder: str, allow_empty: bool = True) -> str:
    cleaned = str(folder or "").strip().replace("\\", "/").strip("/")
    if not cleaned and allow_empty:
        return ""
    path = PurePosixPath(cleaned)
    if not cleaned or path.is_absolute() or any(part in ("", ".", "..") for part in path.parts) or ":" in cleaned:
        raise ValueError(f"非法的 Vibe 文件夹: {folder!r}")
    return "/".join(path.parts)


def _file_for_id(vibe_id: str) -> Path:
    safe = _safe_id(vibe_id)
    file = (VIBES_DIR / Path(*PurePosixPath(safe).parts)).with_suffix(".naiv4vibe")
    try:
        file.relative_to(VIBES_DIR)
    except ValueError as e:
        raise ValueError(f"非法的 vibe id: {vibe_id!r}") from e
    return file


def ensure_vibe_folders() -> None:
    VIBES_DIR.mkdir(parents=True, exist_ok=True)
    for folder in DEFAULT_VIBE_FOLDERS:
        (VIBES_DIR / folder).mkdir(parents=True, exist_ok=True)


def list_vibe_folders() -> list[dict]:
    ensure_vibe_folders()
    folders = {folder for folder in DEFAULT_VIBE_FOLDERS}
    for path in VIBES_DIR.rglob("*"):
        if path.is_dir():
            folders.add(path.relative_to(VIBES_DIR).as_posix())
    return [
        {"name": name, "label": VIBE_FOLDER_LABELS.get(name, name), "default": name in DEFAULT_VIBE_FOLDERS}
        for name in sorted(folders, key=lambda x: (DEFAULT_VIBE_FOLDERS.index(x) if x in DEFAULT_VIBE_FOLDERS else 99, x.casefold()))
    ]


def create_vibe_folder(name: str) -> dict:
    folder = _safe_folder(name, allow_empty=False)
    target = VIBES_DIR / Path(*PurePosixPath(folder).parts)
    if target.exists():
        raise FileExistsError(f"已存在同名文件夹: {folder}")
    target.mkdir(parents=True)
    return {"ok": True, "name": folder, "label": folder}


def rename_vibe_folder(folder: str, new_name: str) -> dict:
    old = _safe_folder(folder, allow_empty=False)
    new = _safe_folder(new_name, allow_empty=False)
    if old in DEFAULT_VIBE_FOLDERS:
        raise ValueError("默认 Vibe 文件夹不能重命名")
    old_path = VIBES_DIR / Path(*PurePosixPath(old).parts)
    new_path = VIBES_DIR / Path(*PurePosixPath(new).parts)
    if not old_path.is_dir():
        raise FileNotFoundError(f"Vibe 文件夹不存在: {old}")
    if new_path.exists():
        raise FileExistsError(f"已存在同名文件夹: {new}")
    new_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.rename(new_path)
    return {"ok": True, "name": new, "label": new}


def delete_vibe_folder(folder: str) -> dict:
    import shutil

    name = _safe_folder(folder, allow_empty=False)
    if name in DEFAULT_VIBE_FOLDERS:
        raise ValueError("默认 Vibe 文件夹不能删除")
    target = VIBES_DIR / Path(*PurePosixPath(name).parts)
    if not target.is_dir():
        raise FileNotFoundError(f"Vibe 文件夹不存在: {name}")
    shutil.rmtree(target)
    return {"ok": True, "name": name}


def _safe_new_name(name: str) -> str:
    n = str(name or "").strip()
    bad = set('<>:"/\\|?*')
    if not n:
        raise ValueError("名称不能为空")
    if len(n) > 120:
        raise ValueError("名称过长（最多 120 字符）")
    if any(ch in bad for ch in n) or n in (".", "..") or n.endswith((".", " ")):
        raise ValueError("名称包含非法字符")
    return n


def open_vibes_folder() -> dict:
    """用系统资源管理器打开 Vibe 目录。"""
    VIBES_DIR.mkdir(parents=True, exist_ok=True)
    try:
        if os.name == "nt":
            os.startfile(str(VIBES_DIR))  # type: ignore[attr-defined]
        else:
            import subprocess

            subprocess.Popen(["xdg-open", str(VIBES_DIR)])
    except OSError as e:
        raise RuntimeError(f"打开文件夹失败: {e}") from e
    return {"ok": True, "path": str(VIBES_DIR)}


def import_vibe_file_upload(filename: str, content: bytes, folder: str = "") -> dict:
    """把用户选择的 .naiv4vibe 文件复制进 Vibe 目录（重名自动加序号）。"""
    if not str(filename or "").lower().endswith(".naiv4vibe"):
        raise ValueError("仅支持 .naiv4vibe 文件")
    try:
        data = json.loads(content.decode("utf-8-sig"))
    except Exception:
        raise ValueError("文件不是有效的 Vibe JSON")
    if not isinstance(data, dict) or data.get("type") != "image":
        raise ValueError("文件不是有效的 Vibe（缺少 type=image 字段）")

    ensure_vibe_folders()
    target_folder = _safe_folder(folder)
    folder_path = VIBES_DIR / Path(*PurePosixPath(target_folder).parts) if target_folder else VIBES_DIR
    folder_path.mkdir(parents=True, exist_ok=True)
    stem = Path(filename).stem.strip() or "vibe"
    base = _safe_new_name(stem)
    name, n = base, 1
    while (folder_path / f"{name}.naiv4vibe").exists():
        n += 1
        name = f"{base}_{n}"
    (folder_path / f"{name}.naiv4vibe").write_bytes(content)
    return {"ok": True, "id": f"{target_folder}/{name}" if target_folder else name, "name": name, "folder": target_folder or "其他"}


def rename_vibe(vibe_id: str, new_name: str) -> dict:
    """重命名 .naiv4vibe 文件（文件名即显示名）。"""
    old = _safe_id(vibe_id)
    new = _safe_new_name(new_name)
    if new == old:
        return {"ok": True, "id": old, "name": new}
    old_file = _file_for_id(old)
    if not old_file.exists():
        raise FileNotFoundError(f"Vibe 不存在: {old}")
    new_file = old_file.with_name(f"{new}.naiv4vibe")
    if new_file.exists():
        raise FileExistsError(f"已存在同名 Vibe: {new}")
    old_file.rename(new_file)
    return {"ok": True, "id": f"{PurePosixPath(old).parent}/{new}" if str(PurePosixPath(old).parent) != "." else new, "name": new}


def list_vibes() -> list[dict]:
    """枚举 vibes 目录下各文件夹的 .naiv4vibe，返回前端可用的摘要列表。"""
    ensure_vibe_folders()
    items = []
    for file in sorted(VIBES_DIR.rglob("*.naiv4vibe")):
        data = _load(file)
        if data is None:
            continue
        relative = file.relative_to(VIBES_DIR)
        name = file.stem
        folder = relative.parent.as_posix() if relative.parent != Path(".") else "其他"
        vibe_id = relative.with_suffix("").as_posix()
        encodings = data.get("encodings") or {}
        import_info = data.get("importInfo") or {}
        thumbnail = data.get("thumbnail") or ""
        if thumbnail and not thumbnail.startswith("data:"):
            thumbnail = _THUMB_PREFIX + thumbnail
        items.append(
            {
                "id": vibe_id,
                "name": name,
                "file": file.name,
                "folder": folder,
                "folder_label": VIBE_FOLDER_LABELS.get(folder, folder),
                "thumbnail": thumbnail,
                "models": [m for m, k in MODEL_VIBE_KEYS.items() if k in encodings],
                "default_strength": float(import_info.get("strength") or 0.7),
                "default_information_extracted": float(import_info.get("information_extracted") or 0.7),
                "encodings": {
                    key: [
                        float((entry.get("params") or {}).get("information_extracted") or 0.7)
                        for entry in enc.values()
                    ]
                    for key, enc in encodings.items()
                },
            }
        )
    return items


def resolve_vibe(
    vibe_id: str,
    model: str,
    strength: float,
    information_extracted: float | None,
) -> dict | None:
    """按模型与信息提取度选择编码，返回 {encoding, strength, information_extracted}。"""
    try:
        safe = _safe_id(vibe_id)
    except ValueError:
        return None
    file = _file_for_id(safe)
    if not file.exists():
        return None
    data = _load(file)
    if data is None:
        return None
    key = MODEL_VIBE_KEYS.get(model)
    if not key:
        return None
    encodings = (data.get("encodings") or {}).get(key)
    if not encodings:
        return None
    entries = list(encodings.values())
    if information_extracted is None:
        entry = entries[0]
    else:
        entry = min(
            entries,
            key=lambda e: abs(
                float((e.get("params") or {}).get("information_extracted") or 0.7)
                - float(information_extracted)
            ),
        )
    encoding = str(entry.get("encoding") or "")
    if not encoding:
        return None
    return {
        "encoding": encoding,
        "strength": max(0.0, min(1.0, float(strength))),
        "information_extracted": float((entry.get("params") or {}).get("information_extracted") or 0.7),
    }


def _normalize_encoding(enc: str) -> str:
    enc = str(enc or "").strip()
    if enc.startswith("data:") and ";base64," in enc:
        enc = enc.split(";base64,", 1)[1]
    return enc


def import_vibe_file(
    encoding: str,
    strength: float,
    info: float,
    model: str,
    name_hint: str = "",
    folder: str = "",
) -> dict:
    """把编码保存为新的 .naiv4vibe 文件（用户主动导入），返回 {id, name}。"""
    encoding = _normalize_encoding(encoding)
    if not encoding:
        raise ValueError("Vibe 编码为空")
    key = MODEL_VIBE_KEYS.get(model)
    if not key:
        raise ValueError(f"模型 {model} 不支持 Vibe 导入")
    ensure_vibe_folders()
    target_folder = _safe_folder(folder) or ("nai4.5" if model.startswith("nai-diffusion-4-5") else "nai4" if model.startswith("nai-diffusion-4") else "其他")
    folder_path = VIBES_DIR / Path(*PurePosixPath(target_folder).parts)
    folder_path.mkdir(parents=True, exist_ok=True)
    hint = str(name_hint or "").strip()
    base = hint or f"图片导入_{datetime.now():%Y%m%d_%H%M%S}"
    base = _safe_new_name(base)
    name, n = base, 1
    while (folder_path / f"{name}.naiv4vibe").exists():
        n += 1
        name = f"{base}_{n}"
    digest = hashlib.md5(encoding.encode("utf-8")).hexdigest()[:16]
    data = {
        "identifier": "naiv4vibe",
        "type": "image",
        "image": encoding,
        "id": digest,
        "name": name,
        "thumbnail": encoding,
        "encodings": {
            key: {digest: {"encoding": encoding, "params": {"information_extracted": info}}}
        },
        "importInfo": {"model": key, "information_extracted": info, "strength": strength},
    }
    (folder_path / f"{name}.naiv4vibe").write_text(
        json.dumps(data, ensure_ascii=False), encoding="utf-8"
    )
    return {"ok": True, "id": f"{target_folder}/{name}", "name": name, "folder": target_folder}
