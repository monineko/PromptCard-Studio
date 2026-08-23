"""画风探索的首轮持久化基础设施。

本模块只管理 ArtistPool、任务快照和候选状态；候选算法与实际生图线程会在
后续里程碑接入。所有用户可见状态都保存在项目内 ``style_explore/``，以便
项目整体迁移和任务中断后的恢复。
"""

from __future__ import annotations

import json
import os
import random
import re
import shutil
import threading
import uuid
from datetime import datetime
from pathlib import Path

from . import generation_coordinator
from . import cards as cards_service
from . import library as library_service
from . import novelai as novelai_service
from . import style_explore_algorithm
from .config import PROJECT_ROOT


STYLE_EXPLORE_DIR = PROJECT_ROOT / "style_explore"
POOLS_DIR = STYLE_EXPLORE_DIR / "pools"
POOL_BACKUPS_DIR = STYLE_EXPLORE_DIR / "pool_backups"
RUNS_DIR = STYLE_EXPLORE_DIR / "runs"
POOLS_INDEX_FILE = POOLS_DIR / "index.json"
DEFAULT_POOL_ID = "artists_backup"
DEFAULT_POOL_FILE = POOLS_DIR / f"{DEFAULT_POOL_ID}.txt"
IMPORT_ORIGINAL_BACKUP = "import-original.txt"
POOL_REPORT_PREVIEW_LIMIT = 20

_lock = threading.RLock()
_VALID_RUN_STATES = {"draft", "running", "paused", "generated", "reviewing", "completed", "cancelled"}
_VALID_CANDIDATE_STATES = {"pending", "generating", "done", "failed", "skipped"}
_VALID_REVIEW_LABELS = {None, "treasure", "reject", "special"}
_VALID_PRELIMINARY_LABELS = {None, "treasure", "reject", "special"}
_workers: dict[str, threading.Thread] = {}


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def ensure_storage() -> None:
    POOLS_DIR.mkdir(parents=True, exist_ok=True)
    POOL_BACKUPS_DIR.mkdir(parents=True, exist_ok=True)
    RUNS_DIR.mkdir(parents=True, exist_ok=True)
    if DEFAULT_POOL_FILE.is_file():
        index = _read_json(POOLS_INDEX_FILE, [])
        if not isinstance(index, list):
            index = []
        if not any(item.get("id") == DEFAULT_POOL_ID for item in index if isinstance(item, dict)):
            ids, _ = _normalize_ids(DEFAULT_POOL_FILE.read_text(encoding="utf-8"))
            if ids:
                now = _now()
                index.append(
                    {
                        "id": DEFAULT_POOL_ID,
                        "name": "artists_backup",
                        "source_name": "artists_backup.txt",
                        "created_at": now,
                        "updated_at": now,
                    }
                )
                _save_pool_index(index)


def _write_json(path: Path, value: dict | list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temp, path)


def _read_json(path: Path, fallback):
    if not path.exists():
        return fallback
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data
    except (OSError, json.JSONDecodeError):
        return fallback


def _split_pool_entries(content: str) -> list[str]:
    """按未转义英文逗号或换行分隔，同时保留 ``\\,`` 等提示词转义。"""
    raw = (content or "").lstrip("\ufeff")
    parts: list[str] = []
    current: list[str] = []
    escaped = False
    for char in raw:
        if char in {"\r", "\n", ","} and not escaped:
            parts.append("".join(current))
            current = []
            continue
        current.append(char)
        if char == "\\" and not escaped:
            escaped = True
        else:
            escaped = False
    parts.append("".join(current))
    return parts


def _normalize_ids(content: str) -> tuple[list[str], dict]:
    """兼容两种池子格式，保序去重并返回可展示的导入统计。"""
    seen: set[str] = set()
    ids: list[str] = []
    duplicate_entries: list[str] = []
    skipped_entries: list[dict[str, str]] = []
    report = {"input_count": 0, "duplicate_count": 0, "skipped_count": 0}
    for part in _split_pool_entries(content):
        value = part.strip()
        if not value:
            continue
        report["input_count"] += 1
        if value.startswith("#"):
            report["skipped_count"] += 1
            skipped_entries.append({"value": value, "reason": "comment"})
            continue
        if value in seen:
            report["duplicate_count"] += 1
            duplicate_entries.append(value)
            continue
        seen.add(value)
        ids.append(value)
    raw = (content or "").lstrip("\ufeff")
    has_line_break = "\n" in raw or "\r" in raw
    escaped = False
    has_unescaped_comma = False
    for char in raw:
        if char == "," and not escaped:
            has_unescaped_comma = True
            break
        if char == "\\" and not escaped:
            escaped = True
        else:
            escaped = False
    detected_format = (
        "mixed"
        if has_line_break and has_unescaped_comma
        else "comma_separated"
        if has_unescaped_comma
        else "one_id_per_line"
    )
    warnings = ["comment_lines_skipped"] if skipped_entries else []
    normalized_content = _pool_text(ids)
    return ids, {
        **report,
        "original_count": report["input_count"],
        "valid_count": len(ids),
        "skipped": report["duplicate_count"] + report["skipped_count"],
        "duplicate_preview": duplicate_entries[:POOL_REPORT_PREVIEW_LIMIT],
        "duplicate_preview_truncated": len(duplicate_entries) > POOL_REPORT_PREVIEW_LIMIT,
        "skipped_preview": skipped_entries[:POOL_REPORT_PREVIEW_LIMIT],
        "skipped_preview_truncated": len(skipped_entries) > POOL_REPORT_PREVIEW_LIMIT,
        "normalized_preview": ids[:POOL_REPORT_PREVIEW_LIMIT],
        "normalized_preview_truncated": len(ids) > POOL_REPORT_PREVIEW_LIMIT,
        "normalized_content": normalized_content,
        "preview_limit": POOL_REPORT_PREVIEW_LIMIT,
        "warnings": warnings,
        "format_info": {
            "detected_format": detected_format,
            "accepted_formats": ["one_id_per_line", "comma_separated"],
            "accepted_extensions": [".txt"],
            "normalized_format": "one_id_per_line",
            "literal_comma_escape": "\\,",
            "comment_prefix": "#",
        },
    }


def _pool_text(ids: list[str]) -> str:
    return "\n".join(ids) + ("\n" if ids else "")


def _load_pool_index() -> list[dict]:
    ensure_storage()
    data = _read_json(POOLS_INDEX_FILE, [])
    return data if isinstance(data, list) else []


def _save_pool_index(items: list[dict]) -> None:
    _write_json(POOLS_INDEX_FILE, items)


def _pool_by_id(pool_id: str) -> dict:
    for pool in _load_pool_index():
        if pool.get("id") == pool_id:
            return pool
    raise FileNotFoundError(f"ArtistPool 不存在: {pool_id}")


def _pool_file(pool_id: str) -> Path:
    return POOLS_DIR / f"{pool_id}.txt"


def _public_pool(pool: dict, ids: list[str] | None = None) -> dict:
    result = dict(pool)
    if ids is None:
        ids, _ = _normalize_ids(_pool_file(pool["id"]).read_text(encoding="utf-8") if _pool_file(pool["id"]).exists() else "")
    result["count"] = len(ids)
    return result


def list_pools() -> list[dict]:
    with _lock:
        return [_public_pool(pool) for pool in _load_pool_index()]


def get_pool(pool_id: str) -> dict:
    with _lock:
        pool = _pool_by_id(pool_id)
        content = _pool_file(pool_id).read_text(encoding="utf-8") if _pool_file(pool_id).exists() else ""
        ids, report = _normalize_ids(content)
        return {**_public_pool(pool, ids), "content": _pool_text(ids), "ids": ids, **report}


def create_pool(name: str, content: str, source_name: str = "") -> dict:
    clean_name = (name or "").strip()
    if not clean_name:
        raise ValueError("ArtistPool 名称不能为空")
    ids, report = _normalize_ids(content)
    if not ids:
        raise ValueError("ArtistPool 至少需要一个有效 ID")
    with _lock:
        ensure_storage()
        pool_id = uuid.uuid4().hex[:12]
        now = _now()
        pool = {
            "id": pool_id,
            "name": clean_name[:120],
            "source_name": (source_name or "").strip()[:200],
            "created_at": now,
            "updated_at": now,
        }
        _pool_file(pool_id).write_text(_pool_text(ids), encoding="utf-8")
        if pool["source_name"]:
            backup_dir = POOL_BACKUPS_DIR / pool_id
            backup_dir.mkdir(parents=True, exist_ok=True)
            (backup_dir / IMPORT_ORIGINAL_BACKUP).write_text(content or "", encoding="utf-8")
        index = _load_pool_index()
        index.append(pool)
        _save_pool_index(index)
        return {**_public_pool(pool, ids), **report}


def _backup_pool(pool_id: str) -> Path | None:
    source = _pool_file(pool_id)
    if not source.exists():
        return None
    folder = POOL_BACKUPS_DIR / pool_id
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / f"{datetime.now():%Y%m%d_%H%M%S_%f}.txt"
    shutil.copy2(source, target)
    return target


def update_pool(pool_id: str, content: str, name: str | None = None) -> dict:
    ids, report = _normalize_ids(content)
    if not ids:
        raise ValueError("ArtistPool 至少需要一个有效 ID")
    with _lock:
        pool = _pool_by_id(pool_id)
        _backup_pool(pool_id)
        _pool_file(pool_id).write_text(_pool_text(ids), encoding="utf-8")
        index = _load_pool_index()
        for item in index:
            if item.get("id") == pool_id:
                if name is not None:
                    clean_name = name.strip()
                    if not clean_name:
                        raise ValueError("ArtistPool 名称不能为空")
                    item["name"] = clean_name[:120]
                item["updated_at"] = _now()
                pool = item
                break
        _save_pool_index(index)
        return {**_public_pool(pool, ids), **report}


def list_pool_backups(pool_id: str) -> list[dict]:
    with _lock:
        pool = _pool_by_id(pool_id)
        folder = POOL_BACKUPS_DIR / pool_id
        return [
            {
                "name": path.name,
                "created_at": datetime.fromtimestamp(path.stat().st_mtime).isoformat(timespec="seconds"),
                "count": len(_normalize_ids(path.read_text(encoding="utf-8"))[0]),
                "kind": "import_original" if path.name == IMPORT_ORIGINAL_BACKUP else "edit_backup",
                "source_name": pool.get("source_name") if path.name == IMPORT_ORIGINAL_BACKUP else "",
            }
            for path in sorted(folder.glob("*.txt"), reverse=True)
        ]


def restore_pool_backup(pool_id: str, backup_name: str) -> dict:
    with _lock:
        _pool_by_id(pool_id)
        safe_name = Path(backup_name or "").name
        if not safe_name or safe_name != backup_name or not safe_name.endswith(".txt"):
            raise ValueError("ArtistPool 备份名称非法")
        source = POOL_BACKUPS_DIR / pool_id / safe_name
        if not source.is_file():
            raise FileNotFoundError("ArtistPool 备份不存在")
        ids, _ = _normalize_ids(source.read_text(encoding="utf-8"))
        if not ids:
            raise ValueError("ArtistPool 备份不含有效 ID")
        _pool_file(pool_id).write_text(_pool_text(ids), encoding="utf-8")
        index = _load_pool_index()
        for item in index:
            if item.get("id") == pool_id:
                item["updated_at"] = _now()
                break
        _save_pool_index(index)
        return get_pool(pool_id)


def delete_pool(pool_id: str) -> dict:
    with _lock:
        pool = _pool_by_id(pool_id)
        for path in RUNS_DIR.glob("*/run.json"):
            record = _read_json(path, {})
            if isinstance(record, dict) and record.get("pool", {}).get("id") == pool_id:
                raise ValueError("已有探索任务保留该 ArtistPool 快照，删除前请先删除这些任务")
        source = _pool_file(pool_id)
        if source.exists():
            source.unlink()
        backup_dir = POOL_BACKUPS_DIR / pool_id
        if backup_dir.exists():
            shutil.rmtree(backup_dir)
        _save_pool_index([item for item in _load_pool_index() if item.get("id") != pool["id"]])
        return {"ok": True, "id": pool_id}


def _run_file(run_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{12}", run_id or ""):
        raise ValueError("探索任务 ID 非法")
    return RUNS_DIR / run_id / "run.json"


def _active_dir(run_id: str) -> Path:
    return _run_file(run_id).parent / "active"


def _label_dir(run_id: str, label: str | None) -> Path:
    return _run_file(run_id).parent / (label or "active")


def _load_run(run_id: str) -> dict:
    path = _run_file(run_id)
    record = _read_json(path, None)
    if not isinstance(record, dict):
        raise FileNotFoundError(f"探索任务不存在: {run_id}")
    return record


def _save_run(record: dict) -> None:
    record["updated_at"] = _now()
    _write_json(_run_file(record["id"]), record)


def _recover_interrupted_record(record: dict) -> bool:
    """把没有存活 worker 的中断任务恢复为可继续的持久化状态。"""
    run_id = str(record.get("id") or "")
    worker = _workers.get(run_id)
    worker_alive = bool(worker and worker.is_alive())
    reservation = generation_coordinator.status().get("reservation")
    owns_reservation = bool(
        reservation
        and reservation.get("owner") == "style_explore"
        and reservation.get("task_id") == run_id
    )
    # 用户点击暂停时，当前请求可能仍在收尾；只要线程还活着，就不能把它
    # 当成进程重启遗留，否则快速暂停/继续可能重复发起同一候选。
    if worker_alive:
        return False

    changed = False
    recovered_candidates = 0
    if record.get("status") in {"running", "paused"}:
        for candidate in record.get("candidates") or []:
            generation = candidate.get("generation") or {}
            if generation.get("status") != "generating":
                continue
            candidate["generation"] = {**generation, "status": "pending"}
            recovered_candidates += 1
            changed = True
    if record.get("status") == "running":
        record["status"] = "paused"
        changed = True
    if changed:
        reason = "服务重启，探索任务已暂停"
        if recovered_candidates:
            reason += f"；{recovered_candidates} 个未完成候选已恢复为待生成"
        record["status_reason"] = reason
    if owns_reservation:
        generation_coordinator.release("style_explore", run_id)
    if worker is not None and not worker_alive:
        _workers.pop(run_id, None)
    return changed


def recover_interrupted_runs() -> dict:
    """程序启动时恢复所有因进程退出而中断的探索任务。"""
    with _lock:
        ensure_storage()
        recovered_ids: list[str] = []
        for path in RUNS_DIR.glob("*/run.json"):
            record = _read_json(path, None)
            if not isinstance(record, dict) or not _recover_interrupted_record(record):
                continue
            _save_run(record)
            recovered_ids.append(str(record.get("id") or ""))
        return {"recovered_count": len(recovered_ids), "run_ids": recovered_ids}


def _public_run(record: dict) -> dict:
    candidates = record.get("candidates") or []
    return {
        "id": record.get("id"),
        "name": record.get("name"),
        "phase": record.get("phase"),
        "status": record.get("status"),
        "status_reason": record.get("status_reason"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "target_count": record.get("target_count"),
        "pool": record.get("pool"),
        "candidate_count": len(candidates),
        "done_count": sum(1 for item in candidates if item.get("generation", {}).get("status") == "done"),
        "reviewed_count": sum(1 for item in candidates if item.get("review", {}).get("label") is not None),
        "round_count": len(record.get("rounds") or []),
        "archived_at": record.get("archived_at"),
    }


def _full_run(record: dict) -> dict:
    """完整任务详情同时携带列表视图需要的统计字段。"""
    return {**record, **_public_run(record)}


def list_runs(include_archived: bool = False) -> list[dict]:
    with _lock:
        ensure_storage()
        records: list[dict] = []
        for path in RUNS_DIR.glob("*/run.json"):
            record = _read_json(path, None)
            if not isinstance(record, dict):
                continue
            if _recover_interrupted_record(record):
                _save_run(record)
            if include_archived or not record.get("archived_at"):
                records.append(_public_run(record))
        return sorted(records, key=lambda item: item.get("created_at") or "", reverse=True)


def get_run(run_id: str) -> dict:
    with _lock:
        record = _load_run(run_id)
        if _recover_interrupted_record(record):
            _save_run(record)
        return _full_run(record)


def create_run(
    pool_id: str,
    target_count: int,
    positive: str,
    negative: str,
    params: dict | None = None,
    algorithm: dict | None = None,
    phase: str = "basic",
    name: str = "",
) -> dict:
    if phase not in {"basic", "deep"}:
        raise ValueError("探索阶段必须是 basic 或 deep")
    if not 1 <= int(target_count) <= 1000:
        raise ValueError("目标生成数量需在 1~1000 之间")
    with _lock:
        pool = get_pool(pool_id)
        run_id = uuid.uuid4().hex[:12]
        now = _now()
        record = {
            "id": run_id,
            "name": (name or "").strip()[:120] or f"{pool['name']} 探索 {now[:10]}",
            "phase": phase,
            "status": "draft",
            "status_reason": None,
            "created_at": now,
            "updated_at": now,
            "target_count": int(target_count),
            "random_seed": None,
            "pool": {"id": pool["id"], "name": pool["name"], "ids": pool["ids"]},
            "prompt_snapshot": {"positive": positive or "", "negative": negative or "", "params": params or {}},
            "algorithm": algorithm or {},
            "rounds": [],
            "archived_at": None,
            "candidates": [],
        }
        _active_dir(run_id).mkdir(parents=True, exist_ok=True)
        _save_run(record)
        return _full_run(record)


def rename_run(run_id: str, name: str) -> dict:
    clean_name = (name or "").strip()
    if not clean_name:
        raise ValueError("探索任务名称不能为空")
    with _lock:
        record = _load_run(run_id)
        record["name"] = clean_name[:120]
        _save_run(record)
        return _full_run(record)


def archive_run(run_id: str, archived: bool = True) -> dict:
    with _lock:
        record = _load_run(run_id)
        if record.get("status") == "running":
            raise ValueError("请先暂停探索任务后再归档")
        record["archived_at"] = _now() if archived else None
        _save_run(record)
        return _full_run(record)


def delete_run(run_id: str) -> dict:
    """永久删除一个已停止任务及其专属图片；调用方必须先经明确确认。"""
    with _lock:
        record = _load_run(run_id)
        if record.get("status") == "running":
            raise ValueError("请先暂停探索任务后再删除")
        task_dir = _run_file(record["id"]).parent.resolve()
        runs_root = RUNS_DIR.resolve()
        if not task_dir.is_relative_to(runs_root):
            raise ValueError("探索任务目录非法")
        image_count = sum(1 for path in task_dir.rglob("*") if path.is_file() and path.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"})
        shutil.rmtree(task_dir)
        return {"ok": True, "deleted_images": image_count}


def _assert_batch_idle() -> None:
    # 延迟导入避免服务之间的初始化环；普通批量的 active 记录存在即视为占用。
    from . import batch

    if batch.status().get("active"):
        raise ValueError("已有未结束的普通批量生成任务，请先结束该任务后再开始画风探索")


def start_run(run_id: str) -> dict:
    with _lock:
        record = _load_run(run_id)
        if _recover_interrupted_record(record):
            _save_run(record)
        if record.get("status") not in {"draft", "paused"}:
            raise ValueError("只有草稿或已暂停的探索任务可以开始")
        _assert_batch_idle()
        if not novelai_service.is_configured():
            raise ValueError("尚未配置 NovelAI token，请先在「设置」中配置")
        generation_coordinator.acquire("style_explore", run_id)
        if not record.get("candidates"):
            _create_basic_candidates(record)
        record["status"] = "running"
        record["status_reason"] = None
        _save_run(record)
        worker = _workers.get(run_id)
        if worker is None or not worker.is_alive():
            worker = threading.Thread(target=_worker_loop, args=(run_id,), daemon=True)
            _workers[run_id] = worker
            worker.start()
        return _full_run(record)


def pause_run(run_id: str) -> dict:
    with _lock:
        record = _load_run(run_id)
        if record.get("status") != "running":
            raise ValueError("探索任务当前不在运行中")
        generation_coordinator.release("style_explore", run_id)
        record["status"] = "paused"
        record["status_reason"] = "用户已暂停"
        _save_run(record)
        return _full_run(record)


def resume_run(run_id: str, params: dict | None = None) -> dict:
    """以当前生图参数继续暂停任务，只改写尚未发起请求的候选快照。"""
    with _lock:
        record = _load_run(run_id)
        if _recover_interrupted_record(record):
            _save_run(record)
        if record.get("status") != "paused":
            raise ValueError("只有已暂停的探索任务可以继续")
        next_params = dict(params or {})
        for candidate in record.get("candidates") or []:
            if (candidate.get("generation") or {}).get("status") != "pending":
                continue
            snapshot = dict(candidate.get("prompt_snapshot") or record.get("prompt_snapshot") or {})
            snapshot["params"] = dict(next_params)
            candidate["prompt_snapshot"] = snapshot
        prompt_snapshot = dict(record.get("prompt_snapshot") or {})
        prompt_snapshot["params"] = dict(next_params)
        record["prompt_snapshot"] = prompt_snapshot
        record.setdefault("resume_events", []).append({"at": _now(), "params": dict(next_params)})
        _save_run(record)
        return start_run(run_id)


def cancel_run(run_id: str) -> dict:
    with _lock:
        record = _load_run(run_id)
        if record.get("status") in {"completed", "cancelled"}:
            raise ValueError("探索任务已经结束")
        generation_coordinator.release("style_explore", run_id)
        record["status"] = "cancelled"
        record["status_reason"] = "用户已结束"
        _save_run(record)
        return _full_run(record)


def append_basic_round(
    run_id: str,
    target_count: int,
    positive: str,
    negative: str,
    params: dict | None = None,
    algorithm: dict | None = None,
) -> dict:
    """在既有探索任务中追加一轮基础探索，不改写历史候选的条件快照。"""
    if not 1 <= int(target_count) <= 1000:
        raise ValueError("目标生成数量需在 1~1000 之间")
    with _lock:
        record = _load_run(run_id)
        if record.get("phase") != "basic":
            raise ValueError("当前仅支持为基础探索任务追加轮次")
        if record.get("status") == "running":
            raise ValueError("请先暂停探索任务后再追加新一轮")
        _append_basic_round_to_record(record, int(target_count), positive, negative, params or {}, algorithm or {})
        record["status"] = "draft"
        record["status_reason"] = None
        _save_run(record)
        return _full_run(record)


def _deep_state(record: dict) -> dict:
    """返回任务内唯一的深度探索状态容器，并兼容旧任务的首次访问。"""

    deep = record.setdefault("deep", {})
    deep.setdefault("active_parent_set_id", None)
    deep.setdefault("parent_sets", [])
    return deep


def set_deep_parent_set(
    run_id: str,
    candidate_ids: list[str] | None = None,
    custom_artist_strings: list[str] | None = None,
) -> dict:
    """从本任务 Treasure 与自定义串建立一份不可变父本快照。"""

    with _lock:
        record = _load_run(run_id)
        if record.get("status") == "running":
            raise ValueError("请先暂停探索任务后再确认深度探索父本")
        if record.get("archived_at") or record.get("status") == "cancelled":
            raise ValueError("已归档或已结束的任务不能建立深度探索父本")

        by_id = {item.get("id"): item for item in record.get("candidates") or []}
        parents: list[dict] = []
        normalized_keys: set[tuple[tuple[str, float], ...]] = set()
        seen_candidate_ids: set[str] = set()

        def add_parent(*, parent_id: str, source: str, artist_string: str, candidate_id: str | None = None) -> None:
            parsed = style_explore_algorithm.parse_artist_string(artist_string)
            key = tuple(sorted((item.artist_id, item.weight) for item in parsed))
            if key in normalized_keys:
                return
            normalized_keys.add(key)
            parents.append(
                {
                    "id": parent_id,
                    "source": source,
                    "candidate_id": candidate_id,
                    "representative_candidate_id": candidate_id,
                    "artist_string": style_explore_algorithm.build_artist_string(parsed),
                    "preference": 1.0,
                }
            )

        for candidate_id in candidate_ids or []:
            clean_id = str(candidate_id or "").strip()
            if not clean_id or clean_id in seen_candidate_ids:
                continue
            seen_candidate_ids.add(clean_id)
            candidate = by_id.get(clean_id)
            if candidate is None:
                raise FileNotFoundError(f"候选不存在: {clean_id}")
            if (candidate.get("generation") or {}).get("status") != "done":
                raise ValueError(f"候选尚未生成完成: {clean_id}")
            if (candidate.get("review") or {}).get("label") != "treasure":
                raise ValueError("深度探索只能从本任务 Treasure 选择图片父本")
            add_parent(
                parent_id=clean_id,
                source="candidate",
                artist_string=str(candidate.get("artist_string") or ""),
                candidate_id=clean_id,
            )

        for raw in custom_artist_strings or []:
            artist_string = str(raw or "").strip()
            if not artist_string:
                continue
            add_parent(
                parent_id=f"custom-{uuid.uuid4().hex[:12]}",
                source="custom",
                artist_string=artist_string,
            )

        if not parents:
            raise ValueError("请至少选择一张 Treasure 或输入一条 Artist String")

        # 在确认阶段提前校验池成员、父本重复和权重范围，使错误不会拖到创建轮次时才出现。
        raw_algorithm = dict(record.get("algorithm") or {})
        config = style_explore_algorithm.WeightSamplingConfig(
            lower=float(raw_algorithm.get("lower", 0.1)),
            upper=float(raw_algorithm.get("upper", 2.0)),
            mode=float(raw_algorithm.get("mode", 0.8)),
            left_dispersion=float(raw_algorithm.get("left_dispersion", 0.4)),
            right_dispersion=float(raw_algorithm.get("right_dispersion", 0.4)),
            soft_balance_strength=float(raw_algorithm.get("soft_balance_strength", 0.0)),
        )
        style_explore_algorithm.generate_deep_candidates(
            [
                style_explore_algorithm.DeepParent.from_artist_string(
                    item["id"], item["artist_string"], item["preference"]
                )
                for item in parents
            ],
            (record.get("pool") or {}).get("ids") or [],
            len(parents) + 1,
            config,
            random.Random(0),
        )

        deep = _deep_state(record)
        now = _now()
        for existing in deep["parent_sets"]:
            if existing.get("status") == "active":
                existing["status"] = "used"
                existing["updated_at"] = now
        parent_set = {
            "id": uuid.uuid4().hex[:12],
            "number": len(deep["parent_sets"]) + 1,
            "status": "active",
            "created_at": now,
            "updated_at": now,
            "parents": parents,
            "comparisons": [],
            "suggested_target_count": style_explore_algorithm.suggest_deep_candidate_count(len(parents)),
            "used_round_ids": [],
        }
        deep["parent_sets"].append(parent_set)
        deep["active_parent_set_id"] = parent_set["id"]
        _save_run(record)
        return _full_run(record)


def record_deep_preference(
    run_id: str,
    parent_set_id: str,
    left_parent_id: str,
    right_parent_id: str,
    result: str,
) -> dict:
    """保存一次成对偏好，并把它折算为温和的抽样权重。"""

    if result not in {"left", "right", "neither", "skip"}:
        raise ValueError("深度探索偏好结果非法")
    if left_parent_id == right_parent_id:
        raise ValueError("偏好比较的两份父本不能相同")
    with _lock:
        record = _load_run(run_id)
        if record.get("status") == "running":
            raise ValueError("生成期间不能修改父本偏好")
        deep = _deep_state(record)
        parent_set = next(
            (item for item in deep["parent_sets"] if item.get("id") == parent_set_id), None
        )
        if parent_set is None:
            raise FileNotFoundError(f"父本集不存在: {parent_set_id}")
        parents = {item.get("id"): item for item in parent_set.get("parents") or []}
        if left_parent_id not in parents or right_parent_id not in parents:
            raise ValueError("偏好比较包含不属于当前父本集的项目")
        if result == "left":
            parents[left_parent_id]["preference"] = float(parents[left_parent_id].get("preference", 1.0)) + 1.0
        elif result == "right":
            parents[right_parent_id]["preference"] = float(parents[right_parent_id].get("preference", 1.0)) + 1.0
        elif result == "neither":
            for parent_id in (left_parent_id, right_parent_id):
                parents[parent_id]["preference"] = max(
                    0.25, float(parents[parent_id].get("preference", 1.0)) - 0.25
                )
        event = {
            "left_parent_id": left_parent_id,
            "right_parent_id": right_parent_id,
            "result": result,
            "created_at": _now(),
        }
        parent_set.setdefault("comparisons", []).append(event)
        parent_set["updated_at"] = event["created_at"]
        _save_run(record)
        return _full_run(record)


def append_deep_round(
    run_id: str,
    target_count: int,
    positive: str,
    negative: str,
    params: dict | None = None,
    algorithm: dict | None = None,
) -> dict:
    """用当前父本集生成一轮带谱系的候选，并复用现有串行生图 worker。"""

    if not 1 <= int(target_count) <= 1000:
        raise ValueError("目标生成数量需在 1~1000 之间")
    with _lock:
        record = _load_run(run_id)
        if record.get("status") == "running":
            raise ValueError("请先暂停探索任务后再创建深度轮次")
        if record.get("archived_at") or record.get("status") == "cancelled":
            raise ValueError("已归档或已结束的任务不能创建深度轮次")
        deep = _deep_state(record)
        parent_set = next(
            (
                item
                for item in deep["parent_sets"]
                if item.get("id") == deep.get("active_parent_set_id")
            ),
            None,
        )
        if parent_set is None:
            raise ValueError("请先确认当前深度探索父本集")
        parents = parent_set.get("parents") or []
        if int(target_count) <= len(parents):
            raise ValueError("深度候选数量必须大于父本数，以保留变异与随机注入名额")

        raw = {**dict(record.get("algorithm") or {}), **dict(algorithm or {})}
        config = style_explore_algorithm.WeightSamplingConfig(
            lower=float(raw.get("lower", 0.1)),
            upper=float(raw.get("upper", 2.0)),
            mode=float(raw.get("mode", 0.8)),
            left_dispersion=float(raw.get("left_dispersion", 0.4)),
            right_dispersion=float(raw.get("right_dispersion", 0.4)),
            soft_balance_strength=float(raw.get("soft_balance_strength", 0.0)),
        )
        seed = int(raw.get("random_seed", random.SystemRandom().randrange(1, 2**63)))
        normalized_algorithm = {
            **raw,
            "lower": config.lower,
            "upper": config.upper,
            "mode": config.mode,
            "left_dispersion": config.left_dispersion,
            "right_dispersion": config.right_dispersion,
            "soft_balance_strength": config.soft_balance_strength,
        }
        generated = style_explore_algorithm.generate_deep_candidates(
            [
                style_explore_algorithm.DeepParent.from_artist_string(
                    item["id"], item["artist_string"], float(item.get("preference", 1.0))
                )
                for item in parents
            ],
            (record.get("pool") or {}).get("ids") or [],
            int(target_count),
            config,
            random.Random(seed),
        )
        rounds = record.setdefault("rounds", [])
        round_id = uuid.uuid4().hex[:12]
        snapshot = {"positive": positive or "", "negative": negative or "", "params": dict(params or {})}
        candidates = []
        for generated_candidate in generated:
            candidate_id = uuid.uuid4().hex[:12]
            candidates.append(
                {
                    "id": candidate_id,
                    "round_id": round_id,
                    "artist_string": generated_candidate.artist_string,
                    "ids": [
                        {"id": item.artist_id, "weight": item.weight}
                        for item in generated_candidate.artist_weights
                    ],
                    "generation": {"status": "pending"},
                    "review": {"heart": False, "rating": None, "label": None, "preliminary_label": None},
                    "lineage": {
                        "parent_ids": list(generated_candidate.parent_ids),
                        "operation": generated_candidate.operation,
                        "operations": [generated_candidate.operation],
                        "weight_changes": [
                            {"artist_id": change.artist_id, "before": change.before, "after": change.after}
                            for change in generated_candidate.weight_changes
                        ],
                    },
                    "prompt_snapshot": {"positive": snapshot["positive"], "negative": snapshot["negative"], "params": dict(snapshot["params"])},
                    "algorithm_snapshot": dict(normalized_algorithm),
                }
            )
        round_record = {
            "id": round_id,
            "number": len(rounds) + 1,
            "phase": "deep",
            "status": "pending",
            "created_at": _now(),
            "target_count": int(target_count),
            "random_seed": seed,
            "parent_set_id": parent_set["id"],
            "suggested_next_parent_count": style_explore_algorithm.suggest_next_parent_count(int(target_count)),
            "prompt_snapshot": snapshot,
            "algorithm": normalized_algorithm,
            "candidate_ids": [item["id"] for item in candidates],
        }
        rounds.append(round_record)
        record.setdefault("candidates", []).extend(candidates)
        parent_set["status"] = "used"
        parent_set.setdefault("used_round_ids", []).append(round_id)
        parent_set["updated_at"] = _now()
        record["status"] = "draft"
        record["status_reason"] = None
        record["target_count"] = len(record["candidates"])
        record["random_seed"] = seed
        record["prompt_snapshot"] = snapshot
        _save_run(record)
        return _full_run(record)


def retry_failed_candidates(run_id: str) -> dict:
    with _lock:
        record = _load_run(run_id)
        if record.get("status") == "running":
            raise ValueError("探索任务正在生成中")
        failed = [item for item in record.get("candidates") or [] if item.get("generation", {}).get("status") == "failed"]
        if not failed:
            raise ValueError("当前任务没有可重试的失败候选")
        for candidate in failed:
            candidate["generation"] = {"status": "pending"}
        record["status"] = "draft"
        record["status_reason"] = None
        _save_run(record)
        return _full_run(record)


def add_candidates(run_id: str, candidates: list[dict]) -> dict:
    """供后续算法层写入候选；首轮可由测试或前端预览调用。"""
    with _lock:
        record = _load_run(run_id)
        if record.get("status") not in {"draft", "running", "paused"}:
            raise ValueError("当前任务状态不能添加候选")
        existing = {item.get("id") for item in record.get("candidates") or []}
        added: list[dict] = []
        for raw in candidates:
            artist_string = str((raw or {}).get("artist_string") or "").strip()
            if not artist_string:
                raise ValueError("候选缺少 artist_string")
            candidate_id = str((raw or {}).get("id") or uuid.uuid4().hex[:12])
            if candidate_id in existing:
                raise ValueError(f"候选 ID 重复: {candidate_id}")
            generation = dict((raw or {}).get("generation") or {})
            generation["status"] = generation.get("status") or "pending"
            if generation["status"] not in _VALID_CANDIDATE_STATES:
                raise ValueError("候选 generation.status 非法")
            item = {
                "id": candidate_id,
                "artist_string": artist_string,
                "ids": list((raw or {}).get("ids") or []),
                "generation": generation,
                "review": {"heart": False, "rating": None, "label": None, "preliminary_label": None},
                "lineage": dict((raw or {}).get("lineage") or {"parent_ids": [], "operations": []}),
            }
            record.setdefault("candidates", []).append(item)
            existing.add(candidate_id)
            added.append(item)
        _save_run(record)
        return {"ok": True, "added": added, "run": _public_run(record)}


def update_candidate(run_id: str, candidate_id: str, patch: dict) -> dict:
    with _lock:
        record = _load_run(run_id)
        candidate = next((item for item in record.get("candidates") or [] if item.get("id") == candidate_id), None)
        if candidate is None:
            raise FileNotFoundError(f"候选不存在: {candidate_id}")
        if "generation" in patch:
            generation = dict(patch.get("generation") or {})
            status = generation.get("status", candidate.get("generation", {}).get("status"))
            if status not in _VALID_CANDIDATE_STATES:
                raise ValueError("候选 generation.status 非法")
            candidate["generation"] = {**candidate.get("generation", {}), **generation, "status": status}
        if "review" in patch:
            review = dict(patch.get("review") or {})
            label = review.get("label", candidate.get("review", {}).get("label"))
            if label not in _VALID_REVIEW_LABELS:
                raise ValueError("候选 review.label 非法")
            preliminary_label = review.get(
                "preliminary_label", candidate.get("review", {}).get("preliminary_label")
            )
            if preliminary_label not in _VALID_PRELIMINARY_LABELS:
                raise ValueError("候选初步判断非法")
            if "rating" in review and review["rating"] is not None and not 0 <= float(review["rating"]) <= 5:
                raise ValueError("候选评分需在 0~5 之间")
            candidate["review"] = {
                **candidate.get("review", {}),
                **review,
                "label": label,
                "preliminary_label": preliminary_label,
            }
            if "label" in review:
                _move_candidate_for_label(run_id, candidate, label)
        _save_run(record)
        return candidate


def apply_candidate_reviews(run_id: str, moves: list[dict]) -> dict:
    """一次提交正式筛选结果，并同步移动专属图库文件。"""
    with _lock:
        record = _load_run(run_id)
        candidates = {item.get("id"): item for item in record.get("candidates") or []}
        normalized: list[tuple[dict, str]] = []
        seen: set[str] = set()
        for raw in moves or []:
            candidate_id = str((raw or {}).get("candidate_id") or "")
            tag = str((raw or {}).get("tag") or "")
            if candidate_id in seen:
                raise ValueError(f"正式筛选包含重复候选: {candidate_id}")
            candidate = candidates.get(candidate_id)
            if candidate is None:
                raise FileNotFoundError(f"候选不存在: {candidate_id}")
            if tag not in {"treasure", "special", "reject"}:
                raise ValueError(f"正式筛选标签非法: {tag}")
            if (candidate.get("generation") or {}).get("status") != "done":
                raise ValueError(f"候选尚未生成完成: {candidate_id}")
            candidate_image_file(run_id, candidate_id)
            seen.add(candidate_id)
            normalized.append((candidate, tag))

        applied: list[dict] = []
        for candidate, tag in normalized:
            candidate.setdefault("review", {})["label"] = tag
            candidate["review"]["formal_reviewed_at"] = _now()
            _move_candidate_for_label(run_id, candidate, tag)
            applied.append(
                {
                    "candidate_id": candidate["id"],
                    "path": candidate["id"],
                    "tag": tag,
                    "dest": (candidate.get("generation") or {}).get("path"),
                    "undoable": False,
                }
            )
            # 批处理中途失败时，已移动文件的索引仍与磁盘保持一致；前端可重新读取继续。
            _save_run(record)
        reviewable = [
            item
            for item in record.get("candidates") or []
            if (item.get("generation") or {}).get("status") == "done"
            and (item.get("generation") or {}).get("path")
        ]
        if normalized:
            record["status"] = (
                "completed"
                if reviewable and all((item.get("review") or {}).get("label") for item in reviewable)
                else "reviewing"
            )
            record["status_reason"] = None
        _save_run(record)
        return {
            "ok": True,
            "applied": applied,
            "skipped": [],
            "undo_token": None,
            "message": f"已完成 {len(applied)} 张探索图片的正式筛选",
            "run": _full_run(record),
        }


def _move_candidate_for_label(run_id: str, candidate: dict, label: str | None) -> None:
    """筛选状态与任务内物理目录同步；未生成候选仅记录标签。"""
    generation = candidate.get("generation") or {}
    raw_path = generation.get("path")
    if generation.get("status") != "done" or not raw_path:
        return
    source = Path(str(raw_path)).resolve()
    task_root = _run_file(run_id).parent.resolve()
    if not source.is_relative_to(task_root) or not source.is_file():
        return
    destination_dir = _label_dir(run_id, label)
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / source.name
    if source == destination:
        return
    if destination.exists():
        destination = destination_dir / f"{candidate['id']}_{source.name}"
    shutil.move(str(source), str(destination))
    generation["path"] = str(destination)


def candidate_image_file(run_id: str, candidate_id: str) -> Path:
    with _lock:
        record = _load_run(run_id)
        candidate = next((item for item in record.get("candidates") or [] if item.get("id") == candidate_id), None)
        if candidate is None:
            raise FileNotFoundError("候选不存在")
        path = Path(str((candidate.get("generation") or {}).get("path") or "")).resolve()
        task_root = _run_file(run_id).parent.resolve()
        if not path.is_relative_to(task_root) or not path.is_file():
            raise FileNotFoundError("候选图片不存在")
        return path


def copy_candidate_to_library(run_id: str, candidate_id: str) -> dict:
    """将探索图片复制到普通 Image Library，绝不移动探索原图。"""
    with _lock:
        source = candidate_image_file(run_id, candidate_id)
        copied = library_service.copy_image_from_source(source)
        return {"ok": True, **copied}


def delete_candidate_image(run_id: str, candidate_id: str) -> dict:
    """从探索图库移走 Reject 图片，并在任务内部保留可追溯的回收副本。"""
    with _lock:
        record = _load_run(run_id)
        candidate = next(
            (item for item in record.get("candidates") or [] if item.get("id") == candidate_id),
            None,
        )
        if candidate is None:
            raise FileNotFoundError("候选不存在")
        if (candidate.get("review") or {}).get("label") != "reject":
            raise ValueError("仅 Reject 牌堆中的图片可以删除")
        source = candidate_image_file(run_id, candidate_id)
        mode = "internal"
        trash_dir = _run_file(run_id).parent / ".trash"
        trash_dir.mkdir(parents=True, exist_ok=True)
        target = trash_dir / f"{uuid.uuid4().hex[:8]}_{source.name}"
        shutil.move(str(source), str(target))
        generation = candidate.setdefault("generation", {})
        generation["deleted_from"] = str(source)
        generation["deleted_at"] = _now()
        generation["deletion_mode"] = mode
        generation["path"] = None
        _save_run(record)
        return {"ok": True, "candidate_id": candidate_id, "mode": mode, "run": _full_run(record)}


def create_candidate_card(run_id: str, candidate_id: str, name: str) -> dict:
    """从候选创建画师串 Card，并把普通图库副本绑定为演示图。"""
    clean_name = (name or "").strip()
    if not clean_name:
        raise ValueError("Card 名称不能为空")
    with _lock:
        record = _load_run(run_id)
        candidate = next(
            (item for item in record.get("candidates") or [] if item.get("id") == candidate_id),
            None,
        )
        if candidate is None:
            raise FileNotFoundError("候选不存在")
        if cards_service.get_card("画师串", clean_name) is not None:
            raise FileExistsError(f"卡片已存在: <画师串:{clean_name}>")
        source = candidate_image_file(run_id, candidate_id)
        copied = library_service.copy_image_from_source(source)
        card = cards_service.create_card("画师串", clean_name, str(candidate.get("artist_string") or ""))
        cards_service.set_card_image("画师串", card["name"], copied["path"])
        return {"ok": True, "card": card, "image_path": copied["path"], "image_name": copied["name"]}


def _append_basic_round_to_record(
    record: dict,
    target_count: int,
    positive: str,
    negative: str,
    params: dict,
    algorithm: dict,
) -> dict:
    """把一轮候选和每张候选的不可变生成快照一起写入任务记录。"""
    if record.get("phase") != "basic":
        raise ValueError("深度探索候选将在深度算法接入后创建")
    raw = dict(algorithm or {})
    config = style_explore_algorithm.WeightSamplingConfig(
        lower=float(raw.get("lower", 0.1)),
        upper=float(raw.get("upper", 2.0)),
        mode=float(raw.get("mode", 0.8)),
        left_dispersion=float(raw.get("left_dispersion", 0.4)),
        right_dispersion=float(raw.get("right_dispersion", 0.4)),
        soft_balance_strength=float(raw.get("soft_balance_strength", 0.0)),
    )
    min_artist_count = int(raw.get("min_artist_count", raw.get("artist_count", 2)))
    raw.pop("artist_count", None)
    seed = int(raw.get("random_seed", random.SystemRandom().randrange(1, 2**63)))
    normalized_algorithm = {
        **raw,
        "lower": config.lower,
        "upper": config.upper,
        "mode": config.mode,
        "left_dispersion": config.left_dispersion,
        "right_dispersion": config.right_dispersion,
        "soft_balance_strength": config.soft_balance_strength,
        "min_artist_count": min_artist_count,
    }
    round_id = uuid.uuid4().hex[:12]
    rounds = record.setdefault("rounds", [])
    snapshot = {"positive": positive or "", "negative": negative or "", "params": dict(params or {})}
    round_record = {
        "id": round_id,
        "number": len(rounds) + 1,
        "phase": "basic",
        "status": "pending",
        "created_at": _now(),
        "target_count": target_count,
        "random_seed": seed,
        "prompt_snapshot": snapshot,
        "algorithm": normalized_algorithm,
        "candidate_ids": [],
    }
    generated = style_explore_algorithm.generate_basic_candidates(
        record["pool"]["ids"], min_artist_count, target_count, config, random.Random(seed)
    )
    candidates = [
        {
            "id": uuid.uuid4().hex[:12],
            "round_id": round_id,
            "artist_string": candidate.artist_string,
            "ids": [{"id": item.artist_id, "weight": item.weight} for item in candidate.artist_weights],
            "generation": {"status": "pending"},
            "review": {"heart": False, "rating": None, "label": None, "preliminary_label": None},
            "lineage": {"parent_ids": [], "operations": ["basic_split_beta"]},
            "prompt_snapshot": {"positive": snapshot["positive"], "negative": snapshot["negative"], "params": dict(snapshot["params"])},
            "algorithm_snapshot": dict(normalized_algorithm),
        }
        for candidate in generated
    ]
    round_record["candidate_ids"] = [candidate["id"] for candidate in candidates]
    rounds.append(round_record)
    record.setdefault("candidates", []).extend(candidates)
    record["target_count"] = len(record["candidates"])
    record["random_seed"] = seed
    record["prompt_snapshot"] = snapshot
    record["algorithm"] = normalized_algorithm
    return round_record


def _create_basic_candidates(record: dict) -> None:
    """兼容首轮任务：第一次开始时创建第一个基础探索轮次。"""
    _append_basic_round_to_record(
        record,
        int(record["target_count"]),
        str((record.get("prompt_snapshot") or {}).get("positive") or ""),
        str((record.get("prompt_snapshot") or {}).get("negative") or ""),
        dict((record.get("prompt_snapshot") or {}).get("params") or {}),
        dict(record.get("algorithm") or {}),
    )


def _worker_loop(run_id: str) -> None:
    """探索专属串行 worker：一张完成即写入任务记录与专属 active 目录。"""
    try:
        while True:
            with _lock:
                record = _load_run(run_id)
                if record.get("status") != "running":
                    return
                candidate = next(
                    (item for item in record.get("candidates") or [] if item.get("generation", {}).get("status") == "pending"),
                    None,
                )
                if candidate is None:
                    record["status"] = "generated"
                    record["status_reason"] = None
                    for round_record in record.get("rounds") or []:
                        if round_record.get("status") == "pending":
                            round_record["status"] = "generated"
                    _save_run(record)
                    generation_coordinator.release("style_explore", run_id)
                    return
                candidate["generation"] = {**candidate.get("generation", {}), "status": "generating"}
                _save_run(record)

            try:
                snapshot = candidate.get("prompt_snapshot") or record.get("prompt_snapshot") or {}
                prompt = ", ".join(
                    part.strip().rstrip(",")
                    for part in [str(snapshot.get("positive") or ""), str(candidate["artist_string"])]
                    if part and part.strip()
                )
                params = dict(snapshot.get("params") or {})
                base_seed = int(params.get("seed") or -1)
                if base_seed >= 0:
                    index = next(i for i, item in enumerate(record["candidates"]) if item["id"] == candidate["id"])
                    params["seed"] = base_seed + index
                else:
                    params["seed"] = -1
                saved = novelai_service.generate_text2image(
                    cards_service.expand(prompt),
                    cards_service.expand(str(snapshot.get("negative") or "")),
                    params,
                    output_dir=_active_dir(run_id),
                )
            except Exception as exc:
                with _lock:
                    latest = _load_run(run_id)
                    item = next(x for x in latest["candidates"] if x["id"] == candidate["id"])
                    item["generation"] = {**item.get("generation", {}), "status": "failed", "error": str(exc)[:500]}
                    _save_run(latest)
                continue

            with _lock:
                latest = _load_run(run_id)
                item = next(x for x in latest["candidates"] if x["id"] == candidate["id"])
                item["generation"] = {
                    **item.get("generation", {}),
                    "status": "done",
                    "path": saved.get("path"),
                    "name": saved.get("name"),
                    "seed": saved.get("seed"),
                    "width": saved.get("width"),
                    "height": saved.get("height"),
                    "elapsed_ms": saved.get("elapsed_ms"),
                    "anlas": saved.get("anlas"),
                    "error": None,
                }
                _save_run(latest)
    finally:
        with _lock:
            try:
                record = _load_run(run_id)
            except (FileNotFoundError, ValueError):
                return
            if record.get("status") != "running":
                generation_coordinator.release("style_explore", run_id)
