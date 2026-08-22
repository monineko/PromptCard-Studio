"""把旧项目中的用户数据迁移到当前项目。"""

import json
import shutil
from datetime import datetime
from pathlib import PurePosixPath
from typing import Iterable

from fastapi import UploadFile

from .config import PROJECT_ROOT


_ROOT_FILES = {"config.json", "workspace.json"}
_ROOT_DIRS = {"promptcards", "library", "vibes"}
_ENGINE_RUNTIME = ("backend", "app", "engines", "runtime")
_BACKGROUND_DIR = ("frontend", "src", "assets", "backgrounds")
_DICTIONARY_CUSTOM = ("dictionary", "custom.json")


def _normalise(path: str) -> tuple[str, ...]:
    raw = path.replace("\\", "/").strip("/")
    parts = tuple(PurePosixPath(raw).parts)
    if not raw or not parts or any(part in {"", ".", ".."} for part in parts):
        raise ValueError("非法迁移路径")
    if any(":" in part for part in parts):
        raise ValueError("非法迁移路径")
    return parts


def destination_for(path: str):
    """Return the allowed destination for a browser-provided relative path."""
    parts = _normalise(path)
    if len(parts) == 1 and parts[0] in _ROOT_FILES:
        return PROJECT_ROOT / parts[0]
    if parts[0] in _ROOT_DIRS:
        return PROJECT_ROOT.joinpath(*parts)
    if parts == _DICTIONARY_CUSTOM:
        return PROJECT_ROOT.joinpath(*parts)
    if len(parts) >= 5 and parts[:4] == _ENGINE_RUNTIME:
        return PROJECT_ROOT.joinpath(*parts)
    if len(parts) >= 5 and parts[:4] == _BACKGROUND_DIR:
        return PROJECT_ROOT.joinpath(*parts)
    if len(parts) >= 3 and parts[0] == "plugins" and parts[2] == "installed.json":
        return PROJECT_ROOT.joinpath(*parts)
    if len(parts) >= 5 and parts[0] == "plugins" and parts[2] == "models" and parts[3] == "runtime":
        return PROJECT_ROOT.joinpath(*parts)
    return None


def _backup_path(destination):
    backup_root = PROJECT_ROOT / ".migration-backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    return backup_root / destination.relative_to(PROJECT_ROOT)


def _copy_upload(upload: UploadFile, destination) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open("wb") as output:
        shutil.copyfileobj(upload.file, output)


async def migrate_uploads(files: Iterable[UploadFile], paths: list[str]) -> dict:
    files = list(files)
    if len(files) != len(paths):
        raise ValueError("迁移文件清单与上传文件数量不一致")

    copied = overwritten = skipped = ignored = 0
    errors: list[str] = []
    backup_root = None
    seen: set[str] = set()

    for upload, raw_path in zip(files, paths):
        try:
            destination = destination_for(raw_path)
            if destination is None:
                ignored += 1
                continue
            relative = destination.relative_to(PROJECT_ROOT).as_posix()
            if relative in seen:
                errors.append(f"重复文件：{relative}")
                continue
            seen.add(relative)
            if destination.exists():
                backup = _backup_path(destination)
                backup.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(destination, backup)
                backup_root = backup.parents[len(destination.relative_to(PROJECT_ROOT).parts) - 1]
                overwritten += 1
            await upload.seek(0)
            _copy_upload(upload, destination)
            copied += 1
        except Exception as exc:
            errors.append(f"{raw_path}: {exc}")

    return {
        "copied": copied,
        "overwritten": overwritten,
        "skipped": skipped,
        "ignored": ignored,
        "errors": errors,
        "backup": str(backup_root) if backup_root else None,
    }


def parse_paths(value: str) -> list[str]:
    try:
        paths = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError("迁移文件清单格式错误") from exc
    if not isinstance(paths, list) or not all(isinstance(path, str) for path in paths):
        raise ValueError("迁移文件清单格式错误")
    return paths
