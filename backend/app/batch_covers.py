"""独立的批量卡面任务：生成候选图，并把用户选择绑定为卡片演示图。"""

from __future__ import annotations

import json
import os
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from . import batch as batch_service
from . import cards as cards_service
from . import generation_coordinator
from . import novelai as novelai_service
from . import terminal as terminal_log
from .config import PROJECT_ROOT
from .generation_timing import COOL_MAX, COOL_MIN, RETRY_WAIT_MAX, RETRY_WAIT_MIN, cool_down
from .image_references import ImageReferenceStore

BATCH_COVER_DIR = PROJECT_ROOT / "batch_cover_runs"
RECORD_FILE = BATCH_COVER_DIR / "active.json"
DEFAULT_ESTIMATE_SEC = 30.0
MAX_RETRIES = 2

_lock = threading.RLock()
_worker: threading.Thread | None = None
_stop_event = threading.Event()
_ended = threading.Event()


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _load_record() -> dict | None:
    if not RECORD_FILE.exists():
        return None
    try:
        data = json.loads(RECORD_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def _save_record(record: dict) -> None:
    if _ended.is_set():
        return
    BATCH_COVER_DIR.mkdir(parents=True, exist_ok=True)
    record["updated_at"] = _now()
    tmp = RECORD_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, RECORD_FILE)


def _card_key(card: dict) -> str:
    return f"{str(card.get('category') or '').strip()}:{str(card.get('name') or '').strip()}"


def _dedupe_cards(cards: list[dict]) -> list[dict]:
    result: list[dict] = []
    seen: set[str] = set()
    for raw in cards:
        card = {
            "category": str((raw or {}).get("category") or "").strip(),
            "name": str((raw or {}).get("name") or "").strip(),
        }
        key = _card_key(card)
        if not card["category"] or not card["name"] or key in seen:
            continue
        seen.add(key)
        result.append(card)
    return result


def _assert_normal_batch_idle() -> None:
    if batch_service.status().get("active"):
        raise ValueError("已有未结束的普通批量生成任务，请先结束该任务")


def _candidate_items(record: dict, target_key: str) -> list[dict]:
    result: list[dict] = []
    for item in record.get("items") or []:
        if item.get("status") != "done" or not item.get("path"):
            continue
        if target_key not in item.get("participant_keys", []):
            continue
        result.append(item)
    return result


def _target_summaries(record: dict) -> list[dict]:
    current_images = cards_service.list_cards_images()
    summaries: list[dict] = []
    for target in record.get("targets") or []:
        key = _card_key(target)
        candidates = _candidate_items(record, key)
        assigned = current_images.get(key)
        summaries.append(
            {
                **target,
                "candidate_count": len(candidates),
                "default_path": candidates[0].get("path") if candidates else None,
                "assigned_path": assigned,
                "status": "assigned"
                if assigned
                else "ready"
                if candidates
                else "waiting",
            }
        )
    return summaries


def _public_view(record: dict) -> dict:
    items = record.get("items") or []
    done = sum(1 for item in items if item.get("status") == "done")
    failed = sum(1 for item in items if item.get("status") == "failed")
    pending = sum(1 for item in items if item.get("status") in {"pending", "generating"})
    current = next(
        (item for item in items if item.get("status") in {"pending", "generating"}),
        None,
    )
    return {
        "id": record.get("id"),
        "status": record.get("status"),
        "stop_reason": record.get("stop_reason"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "total": len(items),
        "done": done,
        "failed": failed,
        "remaining": pending,
        "current_index": current.get("i") if current else None,
        "current_combo": current.get("combo") if current else None,
        "last_image": record.get("last_image"),
        "anlas": record.get("anlas"),
        "estimate_sec": record.get("estimate_sec", DEFAULT_ESTIMATE_SEC),
        "eta_sec": round(record.get("estimate_sec", DEFAULT_ESTIMATE_SEC) * pending, 1),
        "stop_anlas": record.get("stop_anlas"),
        "target_count": len(record.get("targets") or []),
        "targets": _target_summaries(record),
    }


def status() -> dict:
    with _lock:
        record = _load_record()
        if record is None:
            return {"active": False, "run": None}
        if record.get("status") == "running" and (
            _worker is None or not _worker.is_alive()
        ):
            record["status"] = "paused"
            record["stop_reason"] = "进程中断，已停在断点"
            for item in record.get("items") or []:
                if item.get("status") == "generating":
                    item["status"] = "pending"
            _save_record(record)
            generation_coordinator.release("batch_cover", str(record.get("id") or ""))
        return {"active": True, "run": _public_view(record)}


def start(
    base_positive: str,
    negative: str,
    dimensions: list[dict],
    shared_cards: list[dict],
    target_cards: list[dict],
    params: dict,
    stop_anlas: int,
) -> dict:
    with _lock:
        _stop_event.clear()
        _ended.clear()
        if _load_record() is not None:
            raise ValueError("已有未结束的批量卡面任务，请继续或结束该任务")
        _assert_normal_batch_idle()
        if not novelai_service.is_configured():
            raise ValueError("尚未配置 NovelAI token，请先在「设置」中配置")

        for dimension in dimensions:
            dimension_cards = dimension.get("cards") or []
            if not dimension_cards:
                raise ValueError(f"维度「{dimension.get('name')}」没有卡片，无法组合")
            for card in dimension_cards:
                if int(card.get("coefficient") or 1) < 1:
                    raise ValueError(f"卡片 {card.get('name')} 的系数必须 ≥ 1")

        participants = _dedupe_cards(
            [card for dimension in dimensions for card in dimension.get("cards") or []]
            + list(shared_cards or [])
        )
        participant_keys = {_card_key(card) for card in participants}
        if not participants:
            raise ValueError("工作区内没有可准备卡面的卡片")
        for card in participants:
            if cards_service.get_card(card["category"], card["name"]) is None:
                raise ValueError(f"卡片 <{_card_key(card)}> 不存在")

        existing_images = cards_service.list_cards_images()
        targets = []
        for card in _dedupe_cards(target_cards):
            key = _card_key(card)
            if key not in participant_keys:
                raise ValueError(f"目标卡片 <{key}> 不在本次工作区组合中")
            if key not in existing_images:
                targets.append(card)
        if not targets:
            raise ValueError("选中的卡片都已有演示图，无需准备")

        items = batch_service.build_items(dimensions)
        if not items:
            raise ValueError("组合结果为空，无法开始批量卡面")
        shared = _dedupe_cards(shared_cards)
        for item in items:
            item_participants = _dedupe_cards(list(item.get("cards") or []) + shared)
            item["participants"] = item_participants
            item["participant_keys"] = [_card_key(card) for card in item_participants]

        anlas, error = novelai_service.inquire_anlas()
        if anlas is None:
            raise RuntimeError(f"查询点数失败：{error}")
        if int(anlas) < int(stop_anlas):
            raise ValueError(f"当前点数 {anlas} 已低于停止阈值 {stop_anlas}，无法开始")

        run_id = uuid.uuid4().hex[:8]
        generation_coordinator.acquire("batch_cover", run_id)
        record = {
            "id": run_id,
            "status": "running",
            "stop_reason": None,
            "created_at": _now(),
            "updated_at": _now(),
            "params": dict(params),
            "base_positive": base_positive,
            "negative": negative,
            "dimensions": dimensions,
            "shared_cards": shared,
            "targets": targets,
            "stop_anlas": int(stop_anlas),
            "items": items,
            "last_image": None,
            "anlas": anlas,
            "estimate_sec": DEFAULT_ESTIMATE_SEC,
        }
        try:
            _save_record(record)
        except Exception:
            generation_coordinator.release("batch_cover", run_id)
            raise
        terminal_log.log(
            "卡面",
            f"批量卡面任务 {run_id} 开始 · 目标 {len(targets)} 张卡片 · 计划生成 {len(items)} 张图片 · 当前点数 {anlas}",
        )
        _start_worker()
        return _public_view(record)


def _next_pending(record: dict) -> dict | None:
    return next(
        (item for item in record.get("items") or [] if item.get("status") == "pending"),
        None,
    )


def _set_status(record: dict, status_value: str, reason: str | None = None) -> None:
    record["status"] = status_value
    record["stop_reason"] = reason
    _save_record(record)
    if status_value != "running":
        generation_coordinator.release("batch_cover", str(record.get("id") or ""))


def _cool_down(min_sec: float, max_sec: float) -> bool:
    return cool_down(
        min_sec,
        max_sec,
        lambda: _stop_event.is_set() or _ended.is_set(),
    )


def _worker_loop() -> None:
    _stop_event.clear()
    worker_run_id: str | None = None
    while True:
        with _lock:
            record = _load_record()
            if record is None or record.get("status") != "running":
                return
            if worker_run_id is None:
                worker_run_id = str(record.get("id") or "")
            elif str(record.get("id") or "") != worker_run_id:
                return
            if _stop_event.is_set():
                _set_status(record, "paused", "用户已暂停")
                terminal_log.log(
                    "卡面",
                    f"批量卡面任务 {record.get('id')} 已暂停 · 进度 [{_public_view(record)['done']}/{len(record.get('items') or [])}]",
                )
                return
            item = _next_pending(record)
            if item is None:
                _set_status(record, "completed")
                terminal_log.log(
                    "卡面",
                    f"批量卡面任务 {record.get('id')} 生成完成 · 成功 {_public_view(record)['done']} 张 · 可以挑选演示图了",
                )
                return
            if record.get("anlas") is not None and int(record["anlas"]) < int(
                record["stop_anlas"]
            ):
                _set_status(
                    record,
                    "stopped",
                    f"剩余点数 {record['anlas']} 低于停止阈值 {record['stop_anlas']}",
                )
                return
            item["status"] = "generating"
            _save_record(record)

        started = time.monotonic()
        saved = None
        error: Exception | None = None
        progress = f"{int(item['i']) + 1}/{len(record.get('items') or [])}"
        terminal_log.log(
            "生成", f"批量卡面任务 {record.get('id')} · 第 {progress} 张正在生成"
        )
        for attempt in range(MAX_RETRIES + 1):
            if attempt and not _cool_down(RETRY_WAIT_MIN, RETRY_WAIT_MAX):
                error = RuntimeError("任务已暂停")
                break
            try:
                saved = batch_service.generate_item(record, item)
                saved["elapsed_ms"] = int((time.monotonic() - started) * 1000)
                break
            except RuntimeError as exc:
                error = exc
                terminal_log.log(
                    "错误",
                    f"批量卡面任务 {record.get('id')} · 第 {progress} 张失败 · 尝试 {attempt + 1}/{MAX_RETRIES + 1} · {terminal_log.compact_error(exc)}",
                )
            except Exception as exc:
                error = exc
                break

        with _lock:
            current = _load_record()
            if (
                current is None
                or _ended.is_set()
                or str(current.get("id") or "") != worker_run_id
            ):
                return
            current_item = current["items"][int(item["i"])]
            if saved is None and _stop_event.is_set():
                current_item["status"] = "pending"
                _set_status(current, "paused", "用户已暂停")
                return
            if saved is not None:
                current_item.update(
                    {
                        "status": "done",
                        "path": saved.get("path"),
                        "seed": saved.get("seed"),
                        "elapsed_ms": saved.get("elapsed_ms"),
                        "error": None,
                    }
                )
                current["last_image"] = {
                    "path": saved.get("path"),
                    "name": saved.get("name"),
                    "seed": saved.get("seed"),
                }
                if saved.get("anlas") is not None:
                    current["anlas"] = saved.get("anlas")
                elapsed = [
                    value.get("elapsed_ms")
                    for value in current.get("items") or []
                    if value.get("elapsed_ms")
                ]
                if elapsed:
                    current["estimate_sec"] = round(
                        sum(elapsed) / len(elapsed) / 1000 + (COOL_MIN + COOL_MAX) / 2,
                        1,
                    )
                _save_record(current)
                more = _next_pending(current) is not None
            else:
                current_item["status"] = "failed"
                current_item["error"] = str(error)[:500]
                if isinstance(error, RuntimeError):
                    _set_status(current, "paused", f"网络中断：{error}")
                    return
                _save_record(current)
                more = _next_pending(current) is not None

        if saved is not None:
            terminal_log.log(
                "成功",
                f"批量卡面任务 {record.get('id')} · 第 {progress} 张完成 · {saved.get('name') or saved.get('path')} · {saved.get('elapsed_ms', 0) / 1000:.1f} 秒",
            )
        if more:
            _cool_down(COOL_MIN, COOL_MAX)


def _start_worker() -> None:
    global _worker
    _ended.clear()
    if _worker is not None and _worker.is_alive():
        return
    _worker = threading.Thread(target=_worker_loop, daemon=True)
    _worker.start()


def pause() -> dict:
    with _lock:
        record = _load_record()
        if record is None or record.get("status") != "running":
            raise ValueError("批量卡面任务当前不在运行中")
        _stop_event.set()
        return {"ok": True, "message": "正在暂停，将在当前图片完成后停下"}


def resume() -> dict:
    with _lock:
        record = _load_record()
        if record is None:
            raise ValueError("没有可继续的批量卡面任务")
        if record.get("status") not in {"paused", "stopped"}:
            raise ValueError("只有已暂停或停止的批量卡面任务可以继续")
        _assert_normal_batch_idle()
        anlas, error = novelai_service.inquire_anlas()
        if anlas is None:
            raise RuntimeError(f"查询点数失败：{error}")
        if int(anlas) < int(record.get("stop_anlas") or 0):
            raise ValueError("当前点数仍低于停止阈值，无法继续")
        generation_coordinator.acquire("batch_cover", str(record["id"]))
        for item in record.get("items") or []:
            if item.get("status") in {"failed", "generating"}:
                item["status"] = "pending"
        record["status"] = "running"
        record["stop_reason"] = None
        record["anlas"] = anlas
        _stop_event.clear()
        _ended.clear()
        _save_record(record)
        _start_worker()
        return _public_view(record)


def end() -> dict:
    global _worker
    with _lock:
        _stop_event.set()
        _ended.set()
        record = _load_record()
        summary = {"total": 0, "done": 0, "assigned": 0}
        if record is not None:
            view = _public_view(record)
            summary = {
                "total": view["total"],
                "done": view["done"],
                "assigned": sum(
                    1 for target in view["targets"] if target.get("assigned_path")
                ),
            }
            generation_coordinator.release("batch_cover", str(record.get("id") or ""))
            if RECORD_FILE.exists():
                RECORD_FILE.unlink()
            terminal_log.log(
                "卡面",
                f"批量卡面任务 {record.get('id')} 已结束 · 生成 {summary['done']}/{summary['total']} 张 · 已绑定 {summary['assigned']} 张卡片",
            )
        _worker = None
        return {"ok": True, "message": "批量卡面任务已结束", "summary": summary}


def candidates(category: str, name: str) -> dict:
    with _lock:
        record = _load_record()
        if record is None:
            raise ValueError("批量卡面任务不存在或已结束")
        key = f"{category.strip()}:{name.strip()}"
        if key not in {_card_key(target) for target in record.get("targets") or []}:
            raise ValueError("该卡片不属于本次批量卡面任务")
        items = _candidate_items(record, key)
        return {
            "category": category,
            "name": name,
            "items": [
                {
                    "path": item.get("path"),
                    "seed": item.get("seed"),
                    "index": item.get("i"),
                    "combo": item.get("combo"),
                }
                for item in items
            ],
        }


def assign(category: str, name: str, path: str) -> dict:
    with _lock:
        available = candidates(category, name)["items"]
        if path not in {item.get("path") for item in available}:
            raise ValueError("所选图片不是该卡片在本次任务中的候选图")
        result = cards_service.set_card_image(category, name, path)
        terminal_log.log("卡面", f"已设置卡片演示图 · <{category}:{name}> · {Path(path).name}")
        return result


def assign_defaults() -> dict:
    with _lock:
        record = _load_record()
        if record is None:
            raise ValueError("批量卡面任务不存在或已结束")
        existing = cards_service.list_cards_images()
        assigned: list[dict] = []
        skipped: list[dict] = []
        for target in record.get("targets") or []:
            key = _card_key(target)
            if existing.get(key):
                skipped.append({**target, "reason": "已有演示图"})
                continue
            candidates_for_card = _candidate_items(record, key)
            if not candidates_for_card:
                skipped.append({**target, "reason": "暂无成功生成的候选图"})
                continue
            path = str(candidates_for_card[0]["path"])
            cards_service.set_card_image(target["category"], target["name"], path)
            existing[key] = path
            assigned.append({**target, "path": path})
        terminal_log.log(
            "卡面",
            f"首图批量绑定完成 · 成功 {len(assigned)} 张卡片 · 跳过 {len(skipped)} 张",
        )
        return {"ok": True, "assigned": assigned, "skipped": skipped}


def _load_candidate_paths() -> dict[str, str]:
    with _lock:
        record = _load_record()
        if record is None:
            return {}
        paths = {
            str(item.get("i")): str(item["path"])
            for item in record.get("items") or []
            if item.get("path")
        }
        last_path = (record.get("last_image") or {}).get("path")
        if last_path:
            paths["__last_image__"] = str(last_path)
        return paths


def _save_candidate_paths(paths: dict[str, str]) -> None:
    with _lock:
        record = _load_record()
        if record is None:
            return
        changed = False
        for item in record.get("items") or []:
            key = str(item.get("i"))
            current = item.get("path")
            if not current:
                continue
            replacement = paths.get(key)
            if replacement != current:
                item["path"] = replacement
                changed = True
        last_image = record.get("last_image") or {}
        if last_image.get("path"):
            replacement = paths.get("__last_image__")
            if replacement != last_image.get("path"):
                if replacement:
                    last_image["path"] = replacement
                    last_image["name"] = Path(replacement).name
                    record["last_image"] = last_image
                else:
                    record["last_image"] = None
                changed = True
        if changed:
            _save_record(record)


def image_reference_store() -> ImageReferenceStore:
    return ImageReferenceStore(
        "batch_cover_candidates", _load_candidate_paths, _save_candidate_paths
    )
