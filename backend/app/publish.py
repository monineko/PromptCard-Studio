"""发布处理（M3）：独立暂存区 + 可勾选节点工作流。

流程：
1. 图库快捷选取 →「发布处理」：图片以硬链接复制进独立暂存区 publish_staging/
   （同卷秒级，硬链接失败自动退回普通复制），与图库互不影响。
2. /publish 页面浏览暂存区：可预览、删除不想要的图片、继续「添加图片」回到图库。
3. 勾选节点后「开始处理」：从暂存区硬链接到本次运行输入（原地写操作前自动断开链接），
   输出保存到 outputs/<时间戳>-<随机>/，每次处理独立文件夹，图库与暂存区原图都不受影响。
4. 完成后可「打开输出文件」直接查看本次输出的文件夹。

节点与固定顺序（设计推理见 docs/ROADMAP.md §M3）：
    超分降噪 → 恢复原数据 → 数据抹除 → 批量重命名
- 超分：引擎输出抹掉 PNG 元数据，文件名不变。
- 恢复原数据：仅勾选超分后可用，超分前提取 PNG 元数据、超分后写回；与抹除互斥。
- 数据抹除：清除 PNG 内部元数据；未勾选重命名时文件名改为随机中性名（隐藏名字里的提示词）。
- 批量重命名：最后执行；日期（可选）_ 自定义段（可选）_ 随机数字段（6 位），三部分可拖动换序。

超分引擎插件化：内置 Real-ESRGAN（ncnn-Vulkan，可自动下载）与 waifu2x-caffe（本地路径），
按可执行文件名自动识别引擎，参数面板按对应引擎清单渲染。
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
import time
import urllib.request
import urllib.parse
import uuid
import zipfile
from datetime import date, datetime
from pathlib import Path

from .config import PROJECT_ROOT, load_settings, save_settings

PUBLISH_DIR = PROJECT_ROOT / "publish_runs"        # 运行内部暂存（input/meta/.tmp），可清理
STAGING_DIR = PROJECT_ROOT / "publish_staging"     # 用户发布暂存区（与图库隔离）
STAGING_INDEX = STAGING_DIR / "items.json"
OUTPUTS_DIR = PROJECT_ROOT / "outputs"             # 处理结果输出（按时间-随机命名独立文件夹）
ENGINE_RUNTIME_DIR = Path(__file__).resolve().parent / "engines" / "runtime"
MANIFEST_DIR = Path(__file__).resolve().parent / "engines"

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
METADATA_CHUNK_TYPES = {b"tEXt", b"zTXt", b"iTXt", b"eXIf", b"tIME"}
# 用 null 覆写时写入的占位 JSON（兼容按字段读取的元数据读取器，如 NovelAI 官网）
NULL_METADATA_JSON = (
    b'{"prompt": null, "uc": null, "negative_prompt": null, '
    b'"v4_prompt": null, "v4_negative_prompt": null, '
    b'"width": null, "height": null, "seed": null, '
    b'"sampler": null, "steps": null, "scale": null}'
)

PARTS = ("date", "custom", "random")
UPSCALE_TIMEOUT_SEC = 1800
DEFAULT_RENAME = {"parts": ["date", "random"], "custom": ""}
RUN_STATUS_LABELS = {"pending": "等待", "running": "处理中", "done": "完成", "failed": "失败"}

_lock = threading.Lock()
_active_run_id: str | None = None
_install_running = False  # 下载中状态以进程内存为准，避免残留 install.json 造成“假下载”
_install_state: dict = {"running": False, "progress": 0.0, "message": ""}


# ---------- 通用工具 ----------


def _hardlink_or_copy(src: Path, dest: Path) -> None:
    """优先硬链接（同卷秒级、不占额外空间）；失败退回普通复制。"""
    try:
        os.link(str(src), str(dest))
        return
    except OSError:
        pass
    shutil.copy2(str(src), str(dest))


def _new_run_file(staged: str, staged_copy: str) -> dict:
    """发布任务的文件条目构造器（Data Clumps：统一字段，避免各处分写）。"""
    return {
        "staged": staged,
        "staged_copy": staged_copy,
        "output": None,
        "status": "pending",
        "message": "",
    }


def _atomic_write_json(path: Path, data) -> None:
    """写 JSON 状态文件：临时文件+原子替换；并发读句柄阻塞替换时重试，最终直接写兜底。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    for attempt in range(6):
        try:
            tmp.write_text(payload, encoding="utf-8")
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(0.05 * (attempt + 1))
    path.write_text(payload, encoding="utf-8")


def _ensure_detached(path: Path) -> Path:
    """原地写操作前断开与图库的硬链接，避免污染原图。"""
    try:
        if path.stat().st_nlink > 1:
            tmp = path.with_name(path.name + f".{uuid.uuid4().hex[:6]}.tmp")
            shutil.copy2(str(path), str(tmp))
            os.replace(str(tmp), str(path))
    except OSError:
        pass
    return path


# ---------- 发布暂存区 ----------


def _load_staging_index() -> list[dict]:
    if not STAGING_INDEX.exists():
        return []
    try:
        data = json.loads(STAGING_INDEX.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_staging_index(items: list[dict]) -> None:
    _atomic_write_json(STAGING_INDEX, items)


def _unique_staged_name(name: str, existing: set[str]) -> str:
    if name not in existing:
        return name
    stem, suffix = os.path.splitext(name)
    n = 1
    while f"{stem} ({n}){suffix}" in existing:
        n += 1
    return f"{stem} ({n}){suffix}"


def stage_images(paths: list[str]) -> dict:
    """图库勾选 → 复制（硬链接）进发布暂存区，与图库互不影响。"""
    from .library import resolve_image

    paths = [p for p in (paths or []) if p]
    if not paths:
        raise ValueError("请先选择要处理的图片")
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    items = _load_staging_index()
    existing = {i["name"] for i in items}
    added, skipped = 0, 0
    errors: list[str] = []
    for rel in paths:
        try:
            src = resolve_image(rel)
        except ValueError as e:
            skipped += 1
            errors.append(f"{rel}: {e}")
            continue
        if not src.exists() or not src.is_file():
            skipped += 1
            errors.append(f"{rel}: 文件不存在")
            continue
        name = _unique_staged_name(src.name, existing)
        dest = STAGING_DIR / name
        try:
            _hardlink_or_copy(src, dest)
        except OSError as e:
            skipped += 1
            errors.append(f"{src.name}: {e}")
            continue
        items.append(
            {
                "name": name,
                "library_path": rel,
                "added_at": datetime.now().isoformat(timespec="seconds"),
            }
        )
        existing.add(name)
        added += 1
    _save_staging_index(items)
    return {"added": added, "skipped": skipped, "errors": errors, "count": len(items)}


def list_staging() -> dict:
    items = _load_staging_index()
    result = []
    for i in items:
        f = STAGING_DIR / i["name"]
        if not f.exists():
            continue
        try:
            stat = f.stat()
        except OSError:
            continue
        result.append(
            {
                **i,
                "size": stat.st_size,
                "mtime": int(stat.st_mtime * 1000),
            }
        )
    return {"items": result, "count": len(result)}


def remove_staged(name: str) -> dict:
    if not name or os.path.basename(name) != name:
        raise ValueError("非法文件名")
    items = _load_staging_index()
    items = [i for i in items if i["name"] != name]
    _save_staging_index(items)
    try:
        (STAGING_DIR / name).unlink(missing_ok=True)
    except OSError:
        pass
    return {"ok": True, "count": len(items)}


def clear_staging() -> dict:
    removed = len(_load_staging_index())
    for f in STAGING_DIR.glob("*"):
        if f.is_file() and f.name != "items.json":
            try:
                f.unlink()
            except OSError:
                pass
    _save_staging_index([])
    return {"ok": True, "removed": removed}


def resolve_staged_file(name: str) -> Path:
    if not name or os.path.basename(name) != name:
        raise ValueError("非法文件名")
    file = (STAGING_DIR / name).resolve()
    if not file.is_relative_to(STAGING_DIR.resolve()) or not file.exists():
        raise FileNotFoundError("暂存文件不存在")
    return file


# ---------- PNG 元数据（纯标准库，逐块处理，像素不变） ----------


def _iter_chunks(data: bytes):
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


def wipe_png_metadata(file: Path, overwrite_null: bool = False) -> Path:
    """抹除 PNG 内部元数据（tEXt/zTXt/iTXt/eXIf/tIME），像素不变。

    overwrite_null=True 时改为写入一个全 null 的 Comment 占位，
    用于兼容“按字段读取”的元数据读取器（如 NovelAI 官网）。
    """
    file = Path(file)
    data = file.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        return file
    chunks = [(c, d, crc) for c, d, crc in _iter_chunks(data) if c not in METADATA_CHUNK_TYPES]
    insert = None
    if overwrite_null:
        insert = {b"tEXt": [b"Comment\x00" + NULL_METADATA_JSON]}
    file.write_bytes(_rebuild(chunks, insert_before_idat=insert))
    return file


def _wipe_jpeg_metadata(file: Path) -> Path:
    """抹除 JPEG 的 EXIF/XMP 段（APP1/APP2），像素不变；SOS 之后的熵编码数据原样保留。"""
    file = Path(file)
    data = file.read_bytes()
    if data[:2] != b"\xff\xd8":
        return file
    sos = data.find(b"\xff\xda")
    if sos == -1:
        return file  # 结构异常的 JPEG 不动，避免损坏
    (seg_len,) = struct.unpack(">H", data[sos + 2 : sos + 4])
    seg_end = sos + 2 + seg_len
    header = data[:seg_end]
    out = bytearray(header[:2])  # SOI
    pos = 2
    while pos < seg_end:
        if data[pos] != 0xFF:
            break
        marker = data[pos + 1]
        if marker == 0xD9:
            break
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            out += data[pos : pos + 2]
            pos += 2
            continue
        if pos + 4 > seg_end:
            break
        (length,) = struct.unpack(">H", data[pos + 2 : pos + 4])
        if length < 2:
            break
        # APP1(EXIF/XMP)、APP2(ICC/XMP) 属于元数据段，丢弃
        if marker not in (0xE1, 0xE2):
            out += data[pos : pos + 2 + length]
        pos += 2 + length
    tail = data[seg_end:]
    if tail.endswith(b"\xff\xd9"):
        tail = tail[:-2]
    file.write_bytes(bytes(out) + tail + b"\xff\xd9")
    return file


def _metadata_chunk_types(file: Path) -> list[str]:
    """检查文件残留的元数据块类型（PNG tEXt/zTXt/iTXt/eXIf/tIME；JPEG APP1/APP2）。"""
    file = Path(file)
    data = file.read_bytes()
    if data.startswith(PNG_SIGNATURE):
        return [
            c.decode("ascii", "replace")
            for c, _, _ in _iter_chunks(data)
            if c in METADATA_CHUNK_TYPES
        ]
    if data[:2] == b"\xff\xd8":
        sos = data.find(b"\xff\xda")
        head = data[: sos + 2 + struct.unpack(">H", data[sos + 2 : sos + 4])[0]] if sos != -1 else data
        found = []
        pos = 2
        while pos + 4 <= len(head):
            if head[pos] != 0xFF:
                break
            marker = head[pos + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7 or marker == 0xD9:
                pos += 2
                continue
            (length,) = struct.unpack(">H", head[pos + 2 : pos + 4])
            if length < 2:
                break
            if marker in (0xE1, 0xE2):
                found.append({0xE1: "APP1(EXIF/XMP)", 0xE2: "APP2(ICC/XMP)"}[marker])
            pos += 2 + length
        return found
    return []


# ---------- 批量重命名 ----------


def _safe_custom(text: str) -> str:
    text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", str(text or "")).strip(" _")
    return text[:60]


def build_rename_name(rename: dict, today: date, random_digits: str) -> str:
    parts = rename.get("parts") or DEFAULT_RENAME["parts"]
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


# ---------- 超分引擎插件（多引擎清单，按文件名识别） ----------


def _all_manifests() -> list[dict]:
    manifests = []
    for f in sorted(MANIFEST_DIR.glob("*.json")):
        try:
            manifests.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            continue
    if not manifests:
        raise RuntimeError("超分引擎清单缺失，无法使用超分功能")
    return manifests


def _default_manifest() -> dict:
    for m in _all_manifests():
        if m.get("id") == "realesrgan-ncnn-vulkan":
            return m
    return _all_manifests()[0]


def _manifest_for_binary(binary: Path) -> dict | None:
    name = binary.name.lower()
    for m in _all_manifests():
        for match in m.get("match_binary") or []:
            if match.lower() in name:
                return m
    return None


def _engine_binary() -> Path | None:
    settings = load_settings()
    custom = (settings.get("publish") or {}).get("engine_path") or ""
    if custom:
        p = Path(custom).expanduser()
        return p if p.exists() else None
    manifest = _default_manifest()
    marker = ENGINE_RUNTIME_DIR / manifest["id"] / "installed.json"
    if not marker.exists():
        return None
    try:
        info = json.loads(marker.read_text(encoding="utf-8-sig"))
    except Exception:
        return None
    binary = Path(str(info.get("binary") or "")).expanduser()
    if binary.exists():
        return binary
    # 标记里的路径可能因目录调整失效：在引擎目录内按二进制名搜索兜底
    binary_name = info.get("binary_name") or (manifest.get("install") or {}).get("binary") or ""
    if binary_name:
        for p in (ENGINE_RUNTIME_DIR / manifest["id"]).rglob("*"):
            if p.is_file() and p.name.lower() == binary_name.lower():
                return p
    return None


def _active_manifest() -> dict:
    binary = _engine_binary()
    if binary is not None:
        matched = _manifest_for_binary(binary)
        if matched is not None:
            return matched
    return _default_manifest()


def _engine_params(engine_id: str) -> dict:
    return _merged_engine_params(engine_id)


def _merged_engine_params(engine_id: str, override: dict | None = None) -> dict:
    """引擎参数默认值 + 已保存值 + 本次覆写的合并（Data Clumps：统一合并逻辑）。"""
    manifest = next((m for m in _all_manifests() if m.get("id") == engine_id), {})
    defaults = {
        p["key"]: p.get("default")
        for p in manifest.get("params", [])
        if p.get("type") in ("select", "number", "bool")
    }
    saved = (load_settings().get("publish") or {}).get("engine_params") or {}
    merged = {**defaults, **(saved.get(engine_id) or {})}
    if override:
        merged.update({k: v for k, v in override.items() if v is not None})
    return merged


def engine_status() -> dict:
    binary = _engine_binary()
    manifest = _active_manifest()
    settings = load_settings()
    return {
        "engines": [
            {
                "id": m.get("id"),
                "name": m.get("name"),
                "version": m.get("version"),
                "downloadable": bool(m.get("install")),
            }
            for m in _all_manifests()
        ],
        "engine": manifest["id"],
        "engine_name": manifest["name"],
        "manifest": manifest,
        "installed": binary is not None,
        "installing": bool(_install_state.get("running")),
        "progress": round(float(_install_state.get("progress") or 0), 2),
        "message": str(_install_state.get("message") or ""),
        "binary": str(binary) if binary else None,
        "custom_path": (settings.get("publish") or {}).get("engine_path") or "",
        "params": _engine_params(manifest["id"]),
    }


def _write_install_state(state: dict) -> None:
    """下载进度写入进程内存（不做文件 IO，避免与轮询读取竞争导致 WinError 5）。"""
    global _install_state
    _install_state = dict(state)


def _safe_extract(zf: zipfile.ZipFile, target: Path) -> None:
    base = target.resolve()
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        dest = (target / name).resolve()
        if not dest.is_relative_to(base):
            continue
        if info.is_dir():
            dest.mkdir(parents=True, exist_ok=True)
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info) as src, open(dest, "wb") as out:
                shutil.copyfileobj(src, out)


def _find_binary(root: Path, name: str) -> Path | None:
    for p in root.rglob("*"):
        if p.is_file() and p.name.lower() == name.lower():
            return p
    return None


def _resolve_download(url: str) -> tuple[str, int]:
    """跟随重定向拿到最终下载地址与总大小（HEAD 不可用时退化为 0）。"""
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "PromptCard-Studio/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        total = int(resp.headers.get("Content-Length") or 0)
        return resp.geturl(), total


def _http_download(url: str, dest: Path, total: int, on_progress) -> None:
    """可断点续传的单次下载；传输停滞/超时抛异常，由调用方重试。"""
    import http.client

    parsed = urllib.parse.urlsplit(url)
    path = parsed.path + (("?" + parsed.query) if parsed.query else "")
    existing = dest.stat().st_size if dest.exists() else 0
    headers = {"User-Agent": "PromptCard-Studio/0.1", "Accept-Encoding": "identity"}
    if existing:
        headers["Range"] = f"bytes={existing}-"
    conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80), timeout=30)
    try:
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        try:
            if resp.status == 206:
                mode = "ab"
            elif resp.status == 200:
                mode = "wb"
                existing = 0
            else:
                raise RuntimeError(f"下载失败 HTTP {resp.status}")
            with open(dest, mode) as f:
                while True:
                    chunk = resp.read(1 << 16)
                    if not chunk:
                        break
                    f.write(chunk)
                    existing += len(chunk)
                    on_progress(existing, total)
        finally:
            resp.close()
    finally:
        conn.close()


def _install_engine_worker(manifest: dict) -> None:
    global _install_running
    DOWNLOAD_RETRIES = 3
    target_dir = ENGINE_RUNTIME_DIR / manifest["id"] / str(manifest.get("version") or "latest")
    part_path = ENGINE_RUNTIME_DIR / f"{manifest['id']}.part"
    install = manifest.get("install") or {}
    urls = install.get("urls") or ([install["url"]] if install.get("url") else [])
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
        _write_install_state({"running": True, "progress": 0, "message": "开始下载…"})

        downloaded_ok = False
        last_error: Exception | None = None
        for source_index, url in enumerate(urls, start=1):
            part_path.unlink(missing_ok=True)  # 换源时从头开始，避免不同源内容不一致
            final_url, total = url, 0
            try:
                final_url, total = _resolve_download(url)
            except Exception as e:
                last_error = e
            for attempt in range(1, DOWNLOAD_RETRIES + 1):
                try:
                    def on_progress(done: int, size: int, _si=source_index, _a=attempt, _total=total):
                        progress = done / size if size else 0
                        msg = f"下载中（源 {_si}/{len(urls)}·第 {_a} 次）{done // 1024} KB"
                        if size:
                            msg += f" / {size // 1024} KB"
                        _write_install_state({"running": True, "progress": progress, "message": msg})

                    _http_download(final_url, part_path, total, on_progress)
                    downloaded_ok = True
                    break
                except Exception as e:
                    last_error = e
                    _write_install_state(
                        {
                            "running": True,
                            "progress": 0,
                            "message": f"下载中断（源 {source_index}/{len(urls)}·第 {attempt} 次），自动重试…",
                        }
                    )
            if downloaded_ok:
                break
        if not downloaded_ok:
            raise RuntimeError(f"引擎下载失败（已尝试全部下载源）: {last_error}")

        expected = install.get("sha256")
        if expected:
            import hashlib

            digest = hashlib.sha256(part_path.read_bytes()).hexdigest()
            if digest.lower() != str(expected).lower():
                raise RuntimeError("下载文件校验失败，请重试或改用本地引擎路径")

        _write_install_state({"running": True, "progress": 1.0, "message": "正在解压…"})
        with zipfile.ZipFile(part_path) as zf:
            bad = zf.testzip()
            if bad is not None:
                raise RuntimeError(f"下载的压缩包损坏: {bad}")
            _safe_extract(zf, target_dir)

        binary = _find_binary(target_dir, install.get("binary") or "")
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
        _install_running = False
        try:
            part_path.unlink(missing_ok=True)
        except OSError:
            pass


def install_engine() -> dict:
    global _install_running
    state = engine_status()
    if state["installing"]:
        raise ValueError("引擎正在下载中，请稍候")
    if state["installed"]:
        return {"ok": True, "installed": True, "message": "引擎已就绪"}
    manifest = _active_manifest()
    if not manifest.get("install"):
        raise ValueError(f"{manifest['name']} 不支持自动下载，请指定本地引擎路径")
    # 先同步写入安装状态，再启动后台线程，前端轮询立刻可见进度
    _write_install_state({"running": True, "progress": 0.0, "message": "准备下载…"})
    _install_running = True
    thread = threading.Thread(target=_install_engine_worker, args=(manifest,), daemon=True)
    thread.start()
    return {"ok": True, "installing": True, "message": "开始下载超分引擎"}


def set_engine_local_path(path: str) -> dict:
    path = (path or "").strip()
    if path:
        p = Path(path).expanduser()
        if not p.exists() or not p.is_file():
            raise ValueError("本地引擎路径不存在")
        matched = _manifest_for_binary(p)
        if matched is None:
            raise ValueError("无法识别引擎类型：文件名需包含 realesrgan 或 waifu2x")
    settings = load_settings()
    save_settings({"publish": {**(settings.get("publish") or {}), "engine_path": path}})
    manifest = _active_manifest()
    return {"ok": True, "engine": manifest["id"], "engine_name": manifest["name"]}


def save_engine_params(engine: str, params: dict) -> dict:
    engine = (engine or _active_manifest()["id"]).strip()
    if engine not in {m["id"] for m in _all_manifests()}:
        raise ValueError("未知引擎")
    merged = _merged_engine_params(engine, params or {})
    settings = load_settings()
    publish = settings.get("publish") or {}
    engine_params = dict(publish.get("engine_params") or {})
    engine_params[engine] = merged
    save_settings({"publish": {**publish, "engine_params": engine_params}})
    return {"ok": True, "engine": engine, "params": merged}


def build_engine_args(manifest: dict, binary: Path, params: dict, input_path: Path, output_path: Path) -> list[str]:
    """按引擎清单生成命令行参数；不存在的占位（如 models 目录）自动跳过。"""
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
    for flag_key, flag_tokens in (manifest["cli"].get("flags") or {}).items():
        if bool(values.get(flag_key)):
            args.extend(str(t) for t in flag_tokens)
    return args


def _run_engine(binary: Path, params: dict, input_path: Path, output_path: Path) -> None:
    if not binary.exists():
        raise RuntimeError("超分引擎不可用，请先下载或指定本地路径")
    manifest = _manifest_for_binary(binary) or _default_manifest()
    # waifu2x-caffe 等引擎把 -o 当作输出文件夹，跑完后自动取出结果文件
    out_arg = output_path
    temp_out_dir: Path | None = None
    if (manifest.get("cli") or {}).get("output_is_dir"):
        temp_out_dir = output_path.parent / f"{output_path.name}.d"
        temp_out_dir.mkdir(parents=True, exist_ok=True)
        out_arg = temp_out_dir
    args = build_engine_args(manifest, binary, params, input_path, out_arg)
    if str(binary).lower().endswith(".py"):
        cmd = [sys.executable, str(binary)] + args
    else:
        cmd = [str(binary)] + args
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(binary.parent),
            capture_output=True,
            text=True,
            timeout=UPSCALE_TIMEOUT_SEC,
        )
        if proc.returncode != 0:
            detail = (proc.stderr or proc.stdout or "").strip()[-800:]
            raise RuntimeError(f"超分引擎执行失败: {detail}")
        if temp_out_dir is not None:
            produced = _find_produced_image(temp_out_dir, input_path)
            if produced is None:
                raise RuntimeError("超分引擎执行结束但未找到输出图片")
            shutil.move(str(produced), str(output_path))
        elif not output_path.exists():
            raise RuntimeError("超分引擎执行结束但未生成输出文件")
    finally:
        if temp_out_dir is not None:
            shutil.rmtree(temp_out_dir, ignore_errors=True)


def _find_produced_image(out_dir: Path, input_path: Path) -> Path | None:
    """在输出文件夹里定位引擎生成的结果图（优先与输入同名，否则取最新图片）。"""
    ext = {p.suffix.lower() for p in [input_path]}
    candidates = [p for p in out_dir.rglob("*") if p.is_file() and p.suffix.lower() in (".png", ".jpg", ".jpeg", ".webp", ".bmp")]
    if not candidates:
        return None
    same_stem = [p for p in candidates if p.stem == input_path.stem]
    if same_stem:
        return max(same_stem, key=lambda p: p.stat().st_mtime_ns)
    return max(candidates, key=lambda p: p.stat().st_mtime_ns)


# ---------- 发布处理运行 ----------


def _run_dir(run_id: str) -> Path:
    return PUBLISH_DIR / run_id


def _run_file(run_id: str) -> Path:
    return _run_dir(run_id) / "run.json"


def _load_run(run_id: str) -> dict:
    path = _run_file(run_id)
    if not path.exists():
        raise ValueError("发布任务不存在")
    for _ in range(3):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            time.sleep(0.05)
    raise ValueError("发布任务状态暂时无法读取，请稍后刷新")


def _save_run(state: dict) -> None:
    _atomic_write_json(_run_file(state["id"]), state)


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


def start_run(staged_names: list[str], nodes: dict, rename: dict, engine_params: dict) -> dict:
    global _active_run_id
    with _lock:
        if _active_run_id is not None:
            raise ValueError("已有发布任务在运行，请先等待完成")

    nodes = _validate_nodes(nodes)
    staged_names = [n for n in (staged_names or []) if n]
    if not staged_names:
        raise ValueError("暂存区没有要处理的图片")
    if nodes["upscale"] and _engine_binary() is None:
        raise ValueError("超分引擎未安装：请在发布页面先下载引擎或指定本地路径")

    rename = rename or {}
    rename_parts = [p for p in (rename.get("parts") or DEFAULT_RENAME["parts"]) if p in PARTS]
    if not rename_parts:
        raise ValueError("重命名至少需要一个命名段")
    rename = {**rename, "parts": rename_parts}

    run_id = datetime.now().strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]
    base = _run_dir(run_id)
    input_dir = base / "input"
    meta_dir = base / "meta"
    tmp_dir = base / ".tmp"
    for d in (input_dir, meta_dir, tmp_dir):
        d.mkdir(parents=True, exist_ok=True)

    # 输出目录：outputs/<时间戳>-<随机>/，每次处理独立文件夹
    OUTPUTS_DIR.mkdir(parents=True, exist_ok=True)
    out_dir = OUTPUTS_DIR / f"{datetime.now():%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:4]}"
    out_dir.mkdir(parents=True, exist_ok=True)

    files = []
    existing = set()
    for name in staged_names:
        src = STAGING_DIR / name
        if not src.is_file():
            continue
        staged_copy = input_dir / _unique_staged_name(name, existing)
        existing.add(staged_copy.name)
        _hardlink_or_copy(src, staged_copy)
        files.append(_new_run_file(name, staged_copy.name))
    if not files:
        raise ValueError("暂存区中的图片都无效或不存在")

    state = {
        "id": run_id,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "updated_at": datetime.now().isoformat(timespec="seconds"),
        "status": "running",
        "nodes": nodes,
        "rename": rename,
        "engine_params": engine_params or {},
        "files": files,
        "output_dir": str(out_dir),
        "total": len(files),
        "done": 0,
        "failed": 0,
    }
    _save_run(state)
    with _lock:
        _active_run_id = run_id
    thread = threading.Thread(target=_run_worker, args=(run_id,), daemon=True)
    thread.start()
    return {"id": run_id, "total": len(files), "output_dir": str(out_dir)}


def _run_worker(run_id: str) -> None:
    global _active_run_id
    try:
        state = _load_run(run_id)
        base = _run_dir(run_id)
        input_dir = base / "input"
        meta_dir = base / "meta"
        tmp_dir = base / ".tmp"
        out_dir = Path(state["output_dir"])
        nodes = state["nodes"]
        rename = state["rename"]
        engine_params = {**(state.get("engine_params") or {})}
        today = date.today()
        binary = _engine_binary()

        for index, f in enumerate(state["files"]):
            f["status"] = "running"
            _save_run(state)
            staged = input_dir / (f.get("staged_copy") or f["staged"])
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
                    _ensure_detached(current)  # 断开与图库/暂存区的硬链接再原地改写
                    if current.suffix.lower() == ".png":
                        # 统一使用 null 覆写：清除其余元数据，写入全 null 的 Comment 占位，
                        # 兼容 NovelAI 官网等“按字段读取”的读取器（实测官网读到为空）
                        wipe_png_metadata(current, overwrite_null=True)
                        meta = extract_png_metadata(current)
                        texts = [base64.b64decode(b) for b in meta.get("tEXt", [])]
                        if not any(b'"prompt": null' in t for t in texts):
                            raise RuntimeError("数据抹除失败：null 覆写未生效")
                    elif current.suffix.lower() in (".jpg", ".jpeg"):
                        _wipe_jpeg_metadata(current)
                        remaining = _metadata_chunk_types(current)
                        if remaining:
                            raise RuntimeError(f"数据抹除失败（残留: {', '.join(remaining)}）")
                    if not nodes["rename"]:
                        final_name = uuid.uuid4().hex[:8] + current.suffix.lower()

                # 3) 批量重命名（最后执行，保证最终名字）
                if nodes["rename"]:
                    digits = _random_digits((rename or {}).get("random_length"))
                    stem = build_rename_name(rename, today, digits)
                    final_name = _unique_output_name(out_dir, stem, current.suffix.lower())
                else:
                    if not nodes["wipe"]:
                        # 未重命名且未中性化时，用暂存原名（不暴露超分的临时文件名）
                        final_name = os.path.splitext(f["staged"])[0] + current.suffix.lower()
                    final_name = _unique_output_name(out_dir, os.path.splitext(final_name)[0], current.suffix.lower())

                dest = out_dir / final_name
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


def resolve_output_file(run_id: str, name: str) -> Path:
    """解析本次运行输出目录里的文件（仅允许单层文件名）。"""
    if not name or os.path.basename(name) != name:
        raise ValueError("非法文件名")
    state = _load_run(run_id)
    output_dir = Path(state["output_dir"]).resolve()
    file = (output_dir / name).resolve()
    if not file.is_relative_to(output_dir) or not file.exists():
        raise FileNotFoundError("输出文件不存在")
    return file


def open_output_folder(run_id: str) -> dict:
    state = _load_run(run_id)
    output_dir = Path(state["output_dir"])
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
    """清理本次运行的内部暂存（input/meta/.tmp）；outputs 输出文件夹保留给用户。"""
    base = _run_dir(run_id).resolve()
    if not base.is_relative_to(PUBLISH_DIR.resolve()):
        raise ValueError("非法任务目录")
    if base.exists():
        shutil.rmtree(base)
    return {"ok": True}
