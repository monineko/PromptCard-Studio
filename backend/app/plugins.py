"""发布处理插件注册表。

负责发现 plugins/ 下的插件清单（plugin.json）、安装（下载检测模型 + 安装 Python
依赖）与卸载；发布处理流水线通过 process_file() 调用插件处理单张图片。

插件默认不启用：只有用户确认下载并安装成功后，节点才会出现在发布处理页面。
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

from .config import PROJECT_ROOT

PLUGINS_DIR = PROJECT_ROOT / "plugins"
MANIFEST_NAME = "plugin.json"

_install_lock = threading.Lock()
_active_install: str | None = None
_install_state: dict = {"running": False, "progress": 0.0, "message": ""}


# ---------- 基础读取 ----------


def _plugin_dir(plugin_id: str) -> Path:
    return PLUGINS_DIR / plugin_id


def _manifest(plugin_id: str) -> dict:
    path = _plugin_dir(plugin_id) / MANIFEST_NAME
    if not path.is_file():
        raise ValueError(f"插件不存在: {plugin_id}")
    return json.loads(path.read_text(encoding="utf-8"))


def _runtime_dir(plugin_id: str) -> Path:
    return _plugin_dir(plugin_id) / "models" / "runtime"


def _installed_file(plugin_id: str) -> Path:
    return _runtime_dir(plugin_id) / "installed.json"


def _load_installed(plugin_id: str) -> dict | None:
    path = _installed_file(plugin_id)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def is_enabled(plugin_id: str) -> bool:
    installed = _load_installed(plugin_id)
    if not installed or not installed.get("enabled"):
        return False
    model = _runtime_dir(plugin_id) / installed.get("model", "")
    return model.is_file()


def _available_plugin_ids() -> list[str]:
    if not PLUGINS_DIR.is_dir():
        return []
    ids = []
    for entry in sorted(PLUGINS_DIR.iterdir()):
        if entry.is_dir() and (entry / MANIFEST_NAME).is_file():
            ids.append(entry.name)
    return ids


# ---------- 对外状态 ----------


def list_plugins() -> dict:
    plugins = []
    for plugin_id in _available_plugin_ids():
        try:
            m = _manifest(plugin_id)
        except Exception:
            continue
        installed = _load_installed(plugin_id)
        enabled = is_enabled(plugin_id)
        installing = _active_install == plugin_id and _install_state.get("running")
        plugins.append(
            {
                "id": plugin_id,
                "name": m.get("name") or plugin_id,
                "version": m.get("version", ""),
                "description": m.get("description", ""),
                "license": m.get("license", ""),
                "node": m.get("node", {}),
                "parts": m.get("parts", []),
                "methods": m.get("methods", []),
                "model_size": (m.get("model") or {}).get("size", 0),
                "enabled": enabled,
                "installing": installing,
                "progress": _install_state.get("progress", 0.0),
                "message": _install_state.get("message", ""),
                "installed_at": (installed or {}).get("installed_at", ""),
            }
        )
    return {"plugins": plugins}


# ---------- 下载工具 ----------


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_model(plugin_id: str, manifest: dict) -> Path:
    model = manifest.get("model") or {}
    file = model.get("file")
    if not file:
        raise ValueError("插件清单缺少 model.file")
    urls = model.get("urls") or []
    if not urls:
        raise ValueError("插件清单缺少 model.urls")
    expected = (model.get("sha256") or "").lower()
    total = int(model.get("size") or 0)

    runtime_dir = _runtime_dir(plugin_id)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    target = runtime_dir / file
    partial = runtime_dir / (Path(file).name + ".part")

    last_error = ""
    for url in urls:
        partial.unlink(missing_ok=True)
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "PromptCard-Studio/1.0"})
            with urllib.request.urlopen(req, timeout=120) as resp, partial.open("wb") as out:
                length = int(resp.headers.get("Content-Length") or 0) or total
                downloaded = 0
                while True:
                    chunk = resp.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
                    downloaded += len(chunk)
                    _install_state["progress"] = downloaded / length if length else 0.0
                    _install_state["message"] = f"正在下载检测模型 {downloaded // (1 << 20)}MB / {length // (1 << 20)}MB"
            if expected and _sha256(partial) != expected:
                last_error = "模型校验失败（sha256 不匹配）"
                partial.unlink(missing_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(partial), str(target))
            return target
        except (urllib.error.URLError, OSError) as e:
            last_error = str(e)
            partial.unlink(missing_ok=True)
            continue
    raise RuntimeError(f"模型下载失败：{last_error or '所有下载地址均不可用'}")


def _ensure_python_dependency(name: str) -> None:
    """依赖缺失时用当前解释器安装（纯 wheel，不编译源码）。"""
    import importlib.util

    if importlib.util.find_spec(name) is not None:
        return
    _install_state["message"] = f"正在安装依赖 {name}（仅首次需要）"
    result = subprocess.run(
        [sys.executable, "-m", "pip", "install", name, "--only-binary", ":all:", "--disable-pip-version-check"],
        capture_output=True,
        text=True,
        timeout=900,
    )
    if result.returncode != 0 or importlib.util.find_spec(name) is None:
        tail = (result.stderr or result.stdout or "").strip().splitlines()[-3:]
        raise RuntimeError(f"依赖 {name} 安装失败：{' / '.join(tail) or '未知错误'}")


# ---------- 安装 / 卸载 ----------


def install_plugin(plugin_id: str) -> dict:
    global _active_install
    m = _manifest(plugin_id)
    with _install_lock:
        if _active_install is not None:
            raise ValueError("已有插件正在安装，请稍候")
        if is_enabled(plugin_id):
            return {"ok": True, "installing": False, "message": "插件已启用"}
        _active_install = plugin_id
        _install_state.update({"running": True, "progress": 0.0, "message": "准备下载…"})
    threading.Thread(target=_install_worker, args=(plugin_id, m), daemon=True).start()
    return {"ok": True, "installing": True, "message": "开始安装"}


def _install_worker(plugin_id: str, manifest: dict) -> None:
    global _active_install
    try:
        _download_model(plugin_id, manifest)
        for dep in manifest.get("python_dependencies") or []:
            _ensure_python_dependency(dep)
        model = (manifest.get("model") or {}).get("file", "")
        installed = {
            "plugin": plugin_id,
            "enabled": True,
            "model": model,
            "installed_at": datetime.now().isoformat(timespec="seconds"),
        }
        _installed_file(plugin_id).write_text(json.dumps(installed, ensure_ascii=False, indent=2), encoding="utf-8")
        _install_state.update({"running": False, "progress": 1.0, "message": "插件已启用"})
    except Exception as e:
        _install_state.update({"running": False, "progress": 0.0, "message": f"安装失败：{e}"})
    finally:
        with _install_lock:
            _active_install = None


def uninstall_plugin(plugin_id: str) -> dict:
    _manifest(plugin_id)
    if not is_enabled(plugin_id) and not _installed_file(plugin_id).exists():
        return {"ok": True, "removed": False}
    # 先释放检测器会话，避免模型文件被占用无法删除
    try:
        sys.path.insert(0, str(PROJECT_ROOT))
        from plugins.auto_mosaics.backend import clear_cache

        clear_cache()
    except Exception:
        pass
    runtime_dir = _runtime_dir(plugin_id).resolve()
    plugin_root = _plugin_dir(plugin_id).resolve()
    if not runtime_dir.is_relative_to(plugin_root):
        raise ValueError("非法插件运行目录")
    if runtime_dir.exists():
        shutil.rmtree(runtime_dir)
    return {"ok": True, "removed": True}


# ---------- 处理入口 ----------


def process_file(plugin_id: str, input_path, out_path, params: dict) -> dict:
    """调用插件后端处理单张图片；插件未启用时抛出错误。"""
    if not is_enabled(plugin_id):
        raise RuntimeError("自动打码插件未启用，无法处理")
    sys.path.insert(0, str(PROJECT_ROOT))
    from plugins.auto_mosaics.backend import process_image

    return process_image(str(input_path), str(out_path), params)
