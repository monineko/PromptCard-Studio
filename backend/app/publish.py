"""发布处理（M3）：可勾选节点工作流。

节点与执行顺序（固定，前端按此展示与约束）：

    超分降噪 → 恢复原数据 → 数据抹除 → 批量重命名

设计依据（与用户确认的效果推理）：
- 超分降噪：引擎输出会抹掉 PNG 内部元数据，但图片文件名保持不变；
  NovelAI 图片文件名本身携带提示词信息，用户可能想隐藏，因此由「数据抹除/批量重命名」处理名字。
- 恢复原数据：仅在勾选超分时可勾选；实现为「超分前提取 PNG 元数据 → 超分后写回」，
  所以它在流水线中紧跟超分节点。与「数据抹除」互斥：抹除会清掉恢复回来的数据。
- 数据抹除：清除 PNG 内部元数据；未勾选重命名时，文件名同时改为随机中性名（隐藏名字里的提示词）。
- 批量重命名：最后执行，保证最终文件名是用户配置的结果。
  命名 = 日期（可选）_ 自定义段（可选）_ 随机数字段，顺序由用户拖动三部分决定，
  随机数字段避免同日多次输出重名；默认「日期_随机数字段」。

处理在独立暂存区（publish_runs/<run_id>/）进行，图库原图完全不受影响；
处理完成后用户可选择「保存到图库」把结果复制回未评分目录。
"""

import base64
import binascii
import json
import os
import random
import re
import shutil
import struct
import subprocess
import sys
import threading
import urllib.request
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path

from .config import PROJECT_ROOT, load_settings, save_settings

PUBLISH_DIR = PROJECT_ROOT / "publish_runs"
ENGINE_RUNTIME_DIR = PROJECT_ROOT / "engines" / "runtime"
MANIFEST_DIR = Path(__file__).resolve().parent / "engines"

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
# 被识别为「元数据」的 PNG 块：NovelAI 的提示词/参数、Exif、时间戳
METADATA_CHUNK_TYPES = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}

PARTS = ("date", "custom", "random")
PARTS_LABELS = {"date": "日期", "custom": "自定义段", "random": "随机数字段"}

UPSCALE_TIMEOUT_SEC = 1800

_lock = threading.Lock()
_active_run_id: str | None = None


# ---------- PNG 元数据（纯标准库，逐块处理，像素不变） ----------


def _iter_chunks(data: bytes):
    """遍历 PNG 块，产出 (chunk_type, chunk_data, crc_bytes)。"""
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError("不是有效的 PNG 文件")
    pos = len(PNG_SIGNATURE)
    while pos < len(data):
        if pos + 8 > len(data):
            raise ValueError("PNG 数据损坏（块头截断）")
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        start = pos + 8
        end = start + length
        if end + 4 > len(data):
            raise ValueError("PNG 数据损坏（块内容截断）")
        yield ctype, data[start:end], data[end : end + 4]
        pos = end + 4


def _chunk(ctype: bytes, cdata: bytes) -> bytes:
    crc = binascii.crc32(ctype + cdata) & 0xFFFFFFFF
    return struct.pack(">I", len(cdata)) + ctype + cdata + struct.pack(">I", crc)


def _rebuild(chunks, insert_before_idat: dict[bytes, list[bytes]] | None = None) -> bytes:
    """重建 PNG：可删除/插入元数据块（在第一个 IDAT 前插入）。"""
    out = bytearray(PNG_SIGNATURE)
    inserted = False
    for ctype, cdata, _crc in chunks:
        if not inserted and insert_before_idat is not None and ctype == b"IDAT":
            for c, datas in insert_before_idat.items():
                for d in datas:
                    out += _chunk(c, d)
            inserted = True
        out += _chunk(ctype, cdata)
    if insert_before_idat is not None and not inserted:
        for c, datas in insert_before_idat.items():
            for d in datas:
                out += _chunk(c, d)
    return bytes(out)


def extract_png_metadata(file: Path) -> dict[str, list[str]]:
    """提取 PNG 元数据块：{块类型: [base64 数据, ...]}。非 PNG 返回空。"""
    file = Path(file)
    data = file.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        return {}
    meta: dict[str, list[str]] = {}
    for ctype, cdata, _crc in _iter_chunks(data):
        if ctype in METADATA_CHUNK_TYPES:
            meta.setdefault(ctype.decode("ascii"), []).append(
                base64.b64encode(cdata).decode("ascii")
            )
    return meta


def apply_png_metadata(file: Path, meta: dict[str, list[str]]) -> Path:
    """把提取的元数据写回 PNG（先清除目标内同名块再插入）。"""
    file = Path(file)
    data = file.read_bytes()
    if not data.startswith(PNG_SIGNATURE) or not meta:
        return file
    chunks = []
    for ctype, cdata, crc in _iter_chunks(data):
        if ctype not in METADATA_CHUNK_TYPES:
            chunks.append((ctype, cdata, crc))
    insert = {c.encode("ascii"): [base64.b64decode(d) for d in datas] for c, datas in meta.items()}
    file.write_bytes(_rebuild(chunks, insert_before_idat=insert))
    return file


def wipe_png_metadata(file: Path) -> Path:
    """抹除 PNG 内部元数据（tEXt/zTXt/iTXt/eXIf/tIME），像素不变。"""
    file = Path(file)
    data = file.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        return file
    chunks = [(c, d, crc) for c, d, crc in _iter_chunks(data) if c not in METADATA_CHUNK_TYPES]
    file.write_bytes(_rebuild(chunks))
    return file


# ---------- 批量重命名 ----------


def _safe_custom(text: str) -> str:
    """清洗自定义命名段：去 Windows 非法字符，保留中文等。"""
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", str(text or "")).strip(" _")
    return text[:60]


def build_rename_name(rename: dict, today: date, random_digits: str) -> str:
    """按用户顺序拼接命名段，段间用下划线连接。"""
    parts = rename.get("parts") or ["date", "random"]
    custom = _safe_custom(rename.get("custom") or "")
    pieces = []
    for part in parts:
        if part not in PARTS:
            continue
        if part == "date":
            pieces.append(today.strftime("%Y%m%d"))
        elif part == "custom":
            if custom:
                pieces.append(custom)
        elif part == "random":
            pieces.append(random_digits)
    return "_".join(pieces) or random_digits


def _random_digits(length: int = 6) -> str:
    length = max(4, min(10, int(length or 6)))
    return f"{random.randint(0, 10 ** length - 1):0{length}d}"


def rename_samples(rename: dict) -> list[str]:
    """重命名实时预览样例（随机段用固定样例数字展示）。"""
    today = date.today()
    return [
        build_rename_name(rename, today, "482913"),
        build_rename_name(rename, today, "482914"),
        build_rename_name(rename, today, "482915"),
    ]


def _unique_output_name(folder: Path, stem: str, suffix: str) -> str:
    folder.mkdir(parents=True, exist_ok=True)
    candidate = folder / f"{stem}{suffix}"
    n = 1
    while candidate.exists():
        candidate = folder / f"{stem}-{n}{suffix}"
        n += 1
    return candidate.name


# ---------- 超分引擎插件（仅支持一个引擎） ----------


def _manifest() -> dict:
    path = MANIFEST_DIR / "realesrgan-ncnn-vulkan.json"
    if not path.exists():
        raise RuntimeError("超分引擎清单缺失，无法使用超分功能")
    return json.loads(path.read_text(encoding="utf-8"))


def _engine_binary() -> Path | None:
    """优先自定义路径；否则返回已安装的引擎二进制。"""
    settings = load_settings()
    custom = (settings.get("publish") or {}).get("engine_path") or ""
    if custom:
        p = Path(custom).expanduser()
        return p if p.exists() else None
    manifest = _manifest()
    marker = ENGINE_RUNTIME_DIR / manifest["id"] / "installed.json"
    if not marker.exists():
        return None
    try:
        info = json.loads(marker.read_text(encoding="utf-8"))
    except Exception:
        return None
    binary = Path(str(info.get("binary") or "")).expanduser()
    return binary if binary.exists() else None


def _engine_state() -> dict:
    manifest = _manifest()
    install_file = ENGINE_RUNTIME_DIR / "install.json"
    installing = False
    progress = 0
    message = ""
    if install_file.exists():
        try:
            state = json.loads(install_file.read_text(encoding="utf-8"))
            installing = bool(state.get("running"))
            progress = float(state.get("progress") or 0)
            message = str(state.get("message") or "")
        except Exception:
            pass
    binary = _engine_binary()
    settings = load_settings()
    return {
        "manifest": manifest,
        "installed": binary is not None,
        "installing": installing,
        "progress": round(progress, 2),
        "message": message,
        "binary": str(binary) if binary else None,
        "custom_path": (settings.get("publish") or {}).get("engine_path") or "",
        "params": (settings.get("publish") or {}).get("engine_params") or {},
    }


def engine_status() -> dict:
    return _engine_state()


def _write_install_state(state: dict) -> None:
    ENGINE_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    tmp = ENGINE_RUNTIME_DIR / "install.json.tmp"
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, ENGINE_RUNTIME_DIR / "install.json")


def _safe_extract(zf: zipfile.ZipFile, target: Path) -> None:
    base = target.resolve()
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        dest = (target / name).resolve()
        if not dest.is_relative_to(base):
            continue  # 防 zip 路径穿越
        if info.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)


def _install_engine_worker() -> None:
    manifest = _manifest()
    target_dir = ENGINE_RUNTIME_DIR / manifest["id"] / str(manifest.get("version") or "latest")
    zip_path = ENGINE_RUNTIME_DIR / f"{manifest['id']}.zip"
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        _write_install_state({"running": True, "progress": 0, "message": "开始下载…"})

        url = manifest["install"]["url"]
        req = urllib.request.Request(url, headers={"User-Agent": "PromptCard-Studio/0.1"})
        with urllib.request.urlopen(req, timeout=120) as resp, open(zip_path, "wb") as out:
            total = int(resp.headers.get("Content-Length") or 0)
            downloaded = 0
            while True:
                chunk = resp.read(1 << 16)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                if total:
                    _write_install_state(
                        {
                            "running": True,
                            "progress": downloaded / total,
                            "message": f"正在下载 {downloaded // 1024} KB / {total // 1024} KB",
                        }
                    )

        expected = manifest["install"].get("sha256")
        if expected:
            import hashlib

            digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
            if digest.lower() != str(expected).lower():
                raise RuntimeError("下载文件校验失败，请重试或改用本地引擎路径")

        _write_install_state({"running": True, "progress": 1.0, "message": "正在解压…"})
        with zipfile.ZipFile(zip_path) as zf:
            _safe_extract(zf, target_dir)

        binary = _find_binary(target_dir, manifest["install"]["binary"])
        if binary is None:
            raise RuntimeError("解压后未找到引擎程序，请改用本地引擎路径")
        marker = ENGINE_RUNTIME_DIR / manifest["id"] / "installed.json"
        marker.write_text(
            json.dumps({"version": manifest.get("version"), "binary": str(binary)}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        _write_install_state({"running": False, "progress": 1.0, "message": "安装完成"})
    except Exception as e:
        _write_install_state({"running": False, "progress": 0, "message": f"安装失败: {e}"})
    finally:
        try:
            zip_path.unlink(missing_ok=True)
        except OSError:
            pass


def _find_binary(root: Path, name: str) -> Path | None:
    for p in root.rglob("*"):
        if p.is_file() and p.name.lower() == name.lower():
            return p
    return None


def install_engine() -> dict:
    state = _engine_state()
    if state["installing"]:
        raise ValueError("引擎正在下载中，请稍候")
    if state["installed"]:
        return {"ok": True, "installed": True, "message": "引擎已安装"}
    thread = threading.Thread(target=_install_engine_worker, daemon=True)
    thread.start()
    return {"ok": True, "installing": True, "message": "开始下载超分引擎"}


def set_engine_local_path(path: str) -> dict:
    path = (path or "").strip()
    if path:
        p = Path(path).expanduser()
        if not p.exists() or not p.is_file():
            raise ValueError("本地引擎路径不存在")
    save_settings({"publish": {**(load_settings().get("publish") or {}), "engine_path": path}})
    return {"ok": True, "custom_path": path}


def save_engine_params(params: dict) -> dict:
    saved = _default_engine_params()
    if isinstance(params, dict):
        saved.update({k: v for k, v in params.items() if v is not None})
    save_settings({"publish": {**(load_settings().get("publish") or {}), "engine_params": saved}})
    return {"ok": True, "params": saved}


def _default_engine_params() -> dict:
    manifest = _manifest()
    return {
        p["key"]: p.get("default")
        for p in manifest.get("params", [])
        if p.get("type") in ("select", "number", "bool")
    }


def build_engine_args(binary: Path, params: dict, input_path: Path, output_path: Path) -> list[str]:
    """按引擎清单生成命令行参数；不存在的占位（如 models 目录）自动跳过。"""
    manifest = _manifest()
    values = {**params, "input": str(input_path), "output": str(output_path)}
    models_dir = binary.parent / "models"
    values["models_dir"] = str(models_dir) if models_dir.is_dir() else None
    args: list[str] = []
    tokens = manifest["cli"]["args"]
    i = 0
    while i < len(tokens):
        token = tokens[i]
        if token.startswith("{") and token.endswith("}"):
            key = token[1:-1]
            value = values.get(key)
            if value is None or value == "":
                i += 1
                continue
            args.append(str(value))
            i += 1
            continue
        # 普通参数：若下一个是占位符且值为空（如无 models 目录），整对跳过
        if (
            i + 1 < len(tokens)
            and tokens[i + 1].startswith("{")
            and tokens[i + 1].endswith("}")
        ):
            key = tokens[i + 1][1:-1]
            if values.get(key) is None or values.get(key) == "":
                i += 2
                continue
        args.append(token)
        i += 1
    for flag_key, flag in (manifest["cli"].get("flags") or {}).items():
        if bool(values.get(flag_key)):
            args.append(str(flag))
    return args


def _run_engine(binary: Path, params: dict, input_path: Path, output_path: Path) -> None:
    if not binary.exists():
        raise RuntimeError("超分引擎未安装，请先在参数面板下载或指定本地路径")
    if str(binary).lower().endswith(".py"):
        cmd = [sys.executable, str(binary)] + build_engine_args(binary, params, input_path, output_path)
    else:
        cmd = [str(binary)] + build_engine_args(binary, params, input_path, output_path)
    proc = subprocess.run(
        cmd,
        cwd=str(binary.parent),
        capture_output=True,
        text=True,
        timeout=UPSCALE_TIMEOUT_SEC,
    )
    if proc.returncode != 0 or not output_path.exists():
        detail = (proc.stderr or proc.stdout or "").strip()[-800:]
        raise RuntimeError(f"超分引擎执行失败: {detail}")


# ---------- 发布处理运行 ----------


def _run_dir(run_id: str) -> Path:
    return PUBLISH_DIR / run_id


def _run_file(run_id: str) -> Path:
    return _run_dir(run_id) / "run.json"


def _load_run(run_id: str) -> dict:
    path = _run_file(run_id)
    if not path.exists():
        raise ValueError("发布任务不存在")
    return json.loads(path.read_text(encoding="utf-8"))


def _save_run(state: dict) -> None:
    path = _run_file(state["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _validate_nodes(nodes: dict) -> dict:
    upscale = bool(nodes.get("upscale"))
    restore = bool(nodes.get("restore"))
    wipe = bool(nodes.get("wipe"))
    rename = bool(nodes.get("rename"))
    if not (upscale or wipe or rename):
        raise ValueError("请至少勾选一个处理节点")
    if restore and not upscale:
        raise ValueError("恢复原数据只能在勾选超分降噪后使用（恢复的是超分抹掉的数据）")
    if restore and wipe:
        raise ValueError("恢复原数据与数据抹除互斥，请只保留一个")
    return {"upscale": upscale, "restore": restore, "wipe": wipe, "rename": rename}


def start_run(paths: list[str], nodes: dict, rename: dict, engine_params: dict) -> dict:
    global _active_run_id
    with _lock:
        if _active_run_id is not None:
            raise ValueError("已有发布任务在运行，请先等待完成")

    from .library import resolve_image

    nodes = _validate_nodes(nodes)
    paths = [p for p in (paths or []) if p]
    if not paths:
        raise ValueError("请先选择要处理的图片")
    if nodes["upscale"] and _engine_binary() is None:
        raise ValueError("超分引擎未安装：请在发布面板先下载引擎或指定本地路径")

    rename = rename or {}
    rename_parts = [p for p in (rename.get("parts") or ["date", "random"]) if p in PARTS]
    if not rename_parts:
        raise ValueError("重命名至少需要一个命名段")
    rename = {**rename, "parts": rename_parts}

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    base = _run_dir(run_id)
    input_dir = base / "input"
    output_dir = base / "output"
    meta_dir = base / "meta"
    tmp_dir = base / ".tmp"
    for d in (input_dir, output_dir, meta_dir, tmp_dir):
        d.mkdir(parents=True, exist_ok=True)

    files = []
    for rel in paths:
        try:
            src = resolve_image(rel)
        except ValueError as e:
            continue
        if not src.exists() or not src.is_file():
            continue
        stem, suffix = os.path.splitext(src.name)
        staged = input_dir / _unique_output_name(input_dir, stem, suffix)
        shutil.copy2(str(src), str(staged))
        files.append(
            {
                "input": rel,
                "staged": staged.name,
                "output": None,
                "status": "pending",
                "message": "",
            }
        )
    if not files:
        shutil.rmtree(base, ignore_errors=True)
        raise ValueError("选中的图片都无效或不存在")

    state = {
        "id": run_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "status": "running",
        "nodes": nodes,
        "rename": rename,
        "engine_params": engine_params or {},
        "files": files,
        "output_dir": str(output_dir),
        "total": len(files),
        "done": 0,
        "failed": 0,
    }
    _save_run(state)
    with _lock:
        _active_run_id = run_id
    thread = threading.Thread(target=_run_worker, args=(run_id,), daemon=True)
    thread.start()
    return {"id": run_id, "total": len(files)}


def _run_worker(run_id: str) -> None:
    global _active_run_id
    try:
        state = _load_run(run_id)
        base = _run_dir(run_id)
        input_dir = base / "input"
        output_dir = base / "output"
        meta_dir = base / "meta"
        tmp_dir = base / ".tmp"
        nodes = state["nodes"]
        rename = state["rename"]
        engine_params = {**(_default_engine_params()), **(state.get("engine_params") or {})}
        today = date.today()
        binary = _engine_binary()

        for index, f in enumerate(state["files"]):
            f["status"] = "running"
            _save_run(state)
            staged = input_dir / f["staged"]
            try:
                ext = staged.suffix.lower()
                current = staged

                # 1) 超分降噪（输出抹掉元数据，文件名不变）
                if nodes["upscale"]:
                    params = dict(engine_params)
                    if nodes["restore"]:
                        params["format"] = "png"  # 恢复原数据要求 PNG 输出
                    out_ext = ".png" if params.get("format", "png") == "png" else "." + str(params.get("format") or "png")
                    out_tmp = tmp_dir / f"{index}_upscale{out_ext}"
                    _run_engine(binary, params, current, out_tmp)
                    if nodes["restore"] and out_tmp.suffix.lower() == ".png":
                        meta = extract_png_metadata(current)
                        if meta:
                            sidecar = meta_dir / f"{index}.json"
                            sidecar.write_text(
                                json.dumps({"chunks": meta}, ensure_ascii=False), encoding="utf-8"
                            )
                            apply_png_metadata(out_tmp, meta)
                    current = out_tmp

                # 2) 数据抹除（PNG 内部元数据 + 未重命名时的文件名）
                final_name = current.name
                if nodes["wipe"]:
                    if current.suffix.lower() == ".png":
                        wipe_png_metadata(current)
                    if not nodes["rename"]:
                        final_name = uuid.uuid4().hex[:8] + current.suffix.lower()

                # 3) 批量重命名（最后执行，保证最终名字）
                if nodes["rename"]:
                    digits = _random_digits((rename or {}).get("random_length"))
                    stem = build_rename_name(rename, today, digits)
                    final_name = _unique_output_name(output_dir, stem, current.suffix.lower())
                else:
                    final_name = _unique_output_name(output_dir, os.path.splitext(final_name)[0], current.suffix.lower())

                dest = output_dir / final_name
                shutil.move(str(current), str(dest))
                f["output"] = final_name
                f["status"] = "done"
                state["done"] += 1
            except Exception as e:
                f["status"] = "failed"
                f["message"] = str(e)
                state["failed"] += 1
            state["updated_at"] = datetime.now().isoformat(timespec="seconds")
            _save_run(state)

        state["status"] = "completed" if state["failed"] < state["total"] else "failed"
        state["message"] = f"完成 {state['done']} 张，失败 {state['failed']} 张"
        _save_run(state)
    except Exception as e:
        try:
            state = _load_run(run_id)
            state["status"] = "failed"
            state["message"] = f"发布处理失败: {e}"
            _save_run(state)
        except Exception:
            pass
    finally:
        with _lock:
            if _active_run_id == run_id:
                _active_run_id = None


def run_status(run_id: str) -> dict:
    state = _load_run(run_id)
    state["active"] = _active_run_id == run_id
    return state


def save_outputs_to_library(run_id: str) -> dict:
    """把处理结果复制回图库未评分目录（library/<日期>/），原暂存文件保留。"""
    from .config import LIBRARY_DIR
    from .library import _unique_dest

    state = _load_run(run_id)
    output_dir = _run_dir(run_id) / "output"
    dest_folder = LIBRARY_DIR / date.today().isoformat()
    dest_folder.mkdir(parents=True, exist_ok=True)
    saved = []
    for f in state["files"]:
        if f.get("status") != "done" or not f.get("output"):
            continue
        src = output_dir / f["output"]
        if not src.exists():
            continue
        dest = _unique_dest(dest_folder, src.name)
        shutil.copy2(str(src), str(dest))
        saved.append({"name": src.name, "path": dest.relative_to(LIBRARY_DIR).as_posix()})
    return {"ok": True, "saved": saved, "folder": dest_folder.as_posix()}


def resolve_output_file(run_id: str, name: str) -> Path:
    """解析暂存区输出文件（仅允许输出目录内、单层文件名）。"""
    if not name or os.path.basename(name) != name:
        raise ValueError("非法文件名")
    output_dir = _run_dir(run_id) / "output"
    file = (output_dir / name).resolve()
    if not file.is_relative_to(output_dir.resolve()) or not file.exists():
        raise FileNotFoundError("输出文件不存在")
    return file


def open_output_folder(run_id: str) -> dict:
    output_dir = _run_dir(run_id) / "output"
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        if os.name == "nt":
            os.startfile(str(output_dir))  # type: ignore[attr-defined]
        else:
            subprocess.Popen(["xdg-open", str(output_dir)])
    except Exception as e:
        raise RuntimeError(f"无法打开文件夹: {e}")
    return {"ok": True, "path": str(output_dir)}


def delete_run(run_id: str) -> dict:
    base = _run_dir(run_id).resolve()
    if not base.is_relative_to(PUBLISH_DIR.resolve()):
        raise ValueError("非法任务目录")
    if base.exists():
        shutil.rmtree(base)
    return {"ok": True}
