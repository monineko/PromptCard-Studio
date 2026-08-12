"""批量生图：卡片组合枚举、串行生成、点数停止阈值、断点续跑。

设计要点（与用户 2026-08-08 共识一致）：
- 组合维度固定「角色 / 动作 / 画师串」，自定义分区可由前端选择是否作为维度；
- 系数为每张卡片的独立数值（前端提供「分区统一系数」快捷设置），
  总张数 = 各维度（卡片系数之和）的连乘，等价于逐组合 × 组合内系数乘积；
- 串行一张一张生成（与 ANR 一致），不做并发；
- 停止条件 = 剩余点数低于阈值（开始时固定），无最大张数上限；
- 每张图完成后立即落盘记录，中断（用户暂停 / 网络中断 / 进程中断）后可从断点继续；
- 只有用户确认「结束任务」才清理断点记录文件。
"""

import itertools
import json
import os
import random
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

from . import cards as cards_service
from . import novelai as novelai_service
from .config import PROJECT_ROOT

BATCH_DIR = PROJECT_ROOT / "batch_runs"
RECORD_FILE = BATCH_DIR / "active.json"

DEFAULT_ESTIMATE_SEC = 30.0

# 请求间隔（与 ANR sleep_for_cool 一致）：每张图片**收到之后**再随机等待 4~6 秒
# （最短 4 秒），避免连续请求过快触发 NovelAI 限流；
# 请求失败后先等待 8~15 秒再重试，同一张图连续 3 次失败才中断并暂停任务。
COOL_MIN = 4.0
COOL_MAX = 6.0
RETRY_WAIT_MIN = 8.0
RETRY_WAIT_MAX = 15.0
MAX_RETRIES = 2  # 首次 + 2 次重试 = 连续 3 次失败才暂停

_lock = threading.Lock()
_worker: threading.Thread | None = None
_stop_event = threading.Event()  # 置位 => 请求暂停/结束
_ended = threading.Event()  # 置位 => 已确认结束，worker 不再写盘


# ---------- 记录读写 ----------


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _load_record() -> dict | None:
    if not RECORD_FILE.exists():
        return None
    try:
        return json.loads(RECORD_FILE.read_text(encoding="utf-8"))
    except Exception:
        return None


def _save_record(record: dict) -> None:
    if _ended.is_set():
        return
    BATCH_DIR.mkdir(parents=True, exist_ok=True)
    record["updated_at"] = _now()
    tmp = RECORD_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, RECORD_FILE)


def _set_status(status: str, stop_reason: str | None = None) -> None:
    with _lock:
        rec = _load_record()
        if rec is None:
            return
        rec["status"] = status
        rec["stop_reason"] = stop_reason
        _save_record(rec)


# ---------- 组合枚举 ----------


def _card_ref(category: str, name: str) -> str:
    return f"<{category}:{name}>"


def _coeff(card: dict) -> int:
    raw = card.get("coefficient")
    if raw is None:
        return 1
    return int(raw)


def build_items(dimensions: list[dict]) -> list[dict]:
    """按维度卡片枚举笛卡尔积，每个组合重复「组合内各卡系数之积」次。"""
    specs: list[list[tuple[dict, int]]] = []
    for dim in dimensions:
        cards = []
        for c in dim.get("cards") or []:
            coeff = _coeff(c)
            cards.append((c, max(1, coeff)))
        specs.append(cards)

    items: list[dict] = []
    for combo_cards in itertools.product(*specs):
        repeat = 1
        for _card, coeff in combo_cards:
            repeat *= coeff
        combo = {
            dim["name"]: _card_ref(c["category"], c["name"])
            for dim, (c, _coeff) in zip(dimensions, combo_cards)
        }
        for _ in range(repeat):
            items.append(
                {
                    "i": len(items),
                    "combo": dict(combo),
                    "status": "pending",
                    "path": None,
                    "seed": None,
                    "error": None,
                    "elapsed_ms": None,
                }
            )
    return items


# ---------- 单张生成 ----------


def _generate_one(record: dict, item: dict) -> dict:
    """展开引用并调用单张生成，返回保存结果。"""
    params = dict(record["params"])
    params.pop("characters", None)

    base_seed = int(params.get("seed") or -1)
    if base_seed >= 0:
        params["seed"] = base_seed + int(item["i"])
    else:
        params["seed"] = -1

    role_ref = item["combo"].get("角色", "")
    parts = [v for k, v in item["combo"].items() if k != "角色"]
    prompt_text = ", ".join(
        x.rstrip(",").strip()
        for x in [record["base_positive"].strip(), *[p.strip() for p in parts]]
        if x.strip()
    )

    prompt = cards_service.expand(prompt_text)
    negative = cards_service.expand(record["negative"])
    if role_ref.strip():
        params["characters"] = [
            {
                "positive": cards_service.expand(role_ref),
                "negative": "",
                "center": {"x": 0.5, "y": 0.5},
            }
        ]
    else:
        params["characters"] = []

    return novelai_service.generate_text2image(prompt, negative, params)


def _mark_done(record: dict, index: int, saved: dict) -> None:
    item = record["items"][index]
    item["status"] = "done"
    item["path"] = saved.get("path")
    item["seed"] = saved.get("seed")
    item["elapsed_ms"] = saved.get("elapsed_ms")
    item["error"] = None
    record["done"] = sum(1 for it in record["items"] if it["status"] == "done")
    record["failed"] = sum(1 for it in record["items"] if it["status"] == "failed")
    record["current_index"] = int(item["i"])
    record["last_image"] = {
        "path": saved.get("path"),
        "name": saved.get("name"),
        "seed": saved.get("seed"),
    }
    if saved.get("anlas") is not None:
        record["anlas"] = saved.get("anlas")
    elapsed = [it["elapsed_ms"] for it in record["items"] if it.get("elapsed_ms")]
    if elapsed:
        record["estimate_sec"] = round(
            sum(elapsed) / len(elapsed) / 1000 + (COOL_MIN + COOL_MAX) / 2, 1
        )
    _save_record(record)


def _mark_failed(record: dict, index: int, error: str) -> None:
    item = record["items"][index]
    item["status"] = "failed"
    item["error"] = error[:500]
    record["done"] = sum(1 for it in record["items"] if it["status"] == "done")
    record["failed"] = sum(1 for it in record["items"] if it["status"] == "failed")
    record["current_index"] = int(item["i"])
    _save_record(record)


# ---------- 串行工作线程 ----------


def _next_pending(record: dict) -> dict | None:
    for it in record["items"]:
        if it["status"] != "done":
            return it
    return None


def _cool_down(min_sec: float, max_sec: float) -> None:
    """随机等待，期间响应暂停/结束请求（分片检查事件）。"""
    remain = random.uniform(min_sec, max_sec)
    while remain > 0:
        if _stop_event.is_set() or _ended.is_set():
            return
        step = min(0.5, remain)
        time.sleep(step)
        remain -= step


def _worker_loop() -> None:
    _stop_event.clear()
    while True:
        with _lock:
            record = _load_record()
        if record is None or record.get("status") != "running":
            return
        if _stop_event.is_set():
            _set_status("paused", stop_reason="用户已暂停")
            return

        item = _next_pending(record)
        if item is None:
            _set_status("completed", stop_reason=None)
            return

        if record.get("anlas") is not None:
            if int(record["anlas"]) < int(record["stop_anlas"]):
                _set_status(
                    "stopped",
                    stop_reason=f"剩余点数 {record['anlas']} 低于停止阈值 {record['stop_anlas']}",
                )
                return

        start = time.monotonic()
        saved = None
        fatal_error: Exception | None = None
        for attempt in range(MAX_RETRIES + 1):
            if attempt > 0:
                _cool_down(RETRY_WAIT_MIN, RETRY_WAIT_MAX)
            try:
                saved = _generate_one(record, item)
                saved["elapsed_ms"] = int((time.monotonic() - start) * 1000)
                break
            except RuntimeError as e:
                fatal_error = e
            except ValueError as e:
                fatal_error = e
                break
            except Exception as e:
                fatal_error = Exception(f"未知错误: {e}")
                break

        if saved is not None:
            more = False
            with _lock:
                rec = _load_record()
                if rec is None:
                    return
                _mark_done(rec, item["i"], saved)
                more = _next_pending(rec) is not None
            # 每张之间随机冷却 3~5 秒，避免请求过快触发限流
            if more:
                _cool_down(COOL_MIN, COOL_MAX)
            continue

        with _lock:
            rec = _load_record()
            if rec is None:
                return
            _mark_failed(rec, item["i"], str(fatal_error))
        if isinstance(fatal_error, RuntimeError):
            _set_status("paused", stop_reason=f"网络中断：{fatal_error}")
            return


def _start_worker() -> None:
    global _worker
    _ended.clear()
    if _worker is not None and _worker.is_alive():
        return
    _worker = threading.Thread(target=_worker_loop, daemon=True)
    _worker.start()


# ---------- 对外操作 ----------


def status() -> dict:
    with _lock:
        record = _load_record()
        if record is None:
            return {"active": False, "run": None}
        # 进程重启后遗留的 running 记录视为中断
        if record.get("status") == "running" and (_worker is None or not _worker.is_alive()):
            record["status"] = "paused"
            record["stop_reason"] = "进程中断，已停在断点"
            _save_record(record)
        return {"active": True, "run": _public_view(record)}


def start_batch(
    base_positive: str,
    negative: str,
    dimensions: list[dict],
    params: dict,
    stop_anlas: int,
) -> dict:
    with _lock:
        _stop_event.clear()
        _ended.clear()
        existing = _load_record()
        if existing is not None:
            raise ValueError(
                "已有未结束的批量任务（状态："
                f"{existing.get('status')}），请先「结束任务」清理记录，或继续上次任务"
            )

        if not novelai_service.is_configured():
            raise ValueError("尚未配置 NovelAI token，请先在「设置」中配置")
        if not dimensions:
            raise ValueError("没有可用的组合维度")
        for dim in dimensions:
            cards = dim.get("cards") or []
            if not cards:
                raise ValueError(f"维度「{dim.get('name')}」没有卡片，无法组合")
            for c in cards:
                if _coeff(c) < 1:
                    raise ValueError(f"卡片 {c.get('name')} 的系数必须 ≥ 1")

        items = build_items(dimensions)
        if not items:
            raise ValueError("组合结果为空，无法开始批量生成")

        anlas: int | None = None
        anlas, err = novelai_service.inquire_anlas()
        if anlas is None:
            raise RuntimeError(f"查询点数失败：{err}")
        if int(anlas) < int(stop_anlas):
            raise ValueError(f"当前点数 {anlas} 已低于停止阈值 {stop_anlas}，无法开始")

        record = {
            "id": uuid.uuid4().hex[:8],
            "status": "running",
            "stop_reason": None,
            "created_at": _now(),
            "updated_at": _now(),
            "params": params,
            "base_positive": base_positive,
            "negative": negative,
            "dimensions": dimensions,
            "stop_anlas": int(stop_anlas),
            "items": items,
            "total": len(items),
            "done": 0,
            "failed": 0,
            "current_index": -1,
            "last_image": None,
            "anlas": anlas,
            "estimate_sec": DEFAULT_ESTIMATE_SEC,
        }
        _save_record(record)
        _start_worker()
        return _public_view(record)


def pause_batch() -> dict:
    with _lock:
        record = _load_record()
        if record is None:
            raise ValueError("没有正在运行的批量任务")
        if record.get("status") != "running":
            raise ValueError("批量任务当前不在运行中")
        _stop_event.set()
        return {"ok": True, "message": "正在暂停，将在当前图片完成后停下"}


def resume_batch() -> dict:
    with _lock:
        record = _load_record()
        if record is None:
            raise ValueError("没有可继续的批量任务")
        if record.get("status") == "running":
            raise ValueError("批量任务正在运行中")
        if record.get("status") == "completed":
            raise ValueError("批量任务已完成，无需继续")
        anlas, err = novelai_service.inquire_anlas()
        if anlas is None:
            raise RuntimeError(f"查询点数失败：{err}")
        if int(anlas) < int(record.get("stop_anlas") or 0):
            raise ValueError(
                f"当前点数 {anlas} 仍低于停止阈值 {record.get('stop_anlas')}，无法继续"
            )
        record["anlas"] = anlas
        record["status"] = "running"
        record["stop_reason"] = None
        _stop_event.clear()
        _ended.clear()
        _save_record(record)
        _start_worker()
        return _public_view(record)


def end_batch() -> dict:
    global _worker
    with _lock:
        _stop_event.set()
        _ended.set()
        record = _load_record()
        if record is not None:
            total = record.get("total")
            done = sum(1 for it in record.get("items") or [] if it["status"] == "done")
            if RECORD_FILE.exists():
                RECORD_FILE.unlink()
        return {
            "ok": True,
            "message": "批量任务已结束，断点记录已清理",
            "summary": {"total": total, "done": done},
        }


def _public_view(record: dict) -> dict:
    items = record.get("items") or []
    done = sum(1 for it in items if it["status"] == "done")
    failed = sum(1 for it in items if it["status"] == "failed")
    remaining = sum(1 for it in items if it["status"] != "done")
    current = next((it for it in items if it["status"] != "done"), None)
    params = record.get("params") or {}
    return {
        "id": record.get("id"),
        "status": record.get("status"),
        "stop_reason": record.get("stop_reason"),
        "created_at": record.get("created_at"),
        "updated_at": record.get("updated_at"),
        "total": record.get("total"),
        "done": done,
        "failed": failed,
        "remaining": remaining,
        "current_index": current["i"] if current else None,
        "current_combo": current["combo"] if current else None,
        "last_image": record.get("last_image"),
        "anlas": record.get("anlas"),
        "estimate_sec": record.get("estimate_sec", DEFAULT_ESTIMATE_SEC),
        "eta_sec": round(record.get("estimate_sec", DEFAULT_ESTIMATE_SEC) * remaining, 1)
        if remaining
        else 0,
        "stop_anlas": record.get("stop_anlas"),
        "dimensions": record.get("dimensions"),
        "base_positive": record.get("base_positive"),
        "negative": record.get("negative"),
        "params": {
            "model": params.get("model"),
            "width": params.get("width"),
            "height": params.get("height"),
            "steps": params.get("steps"),
            "sampler": params.get("sampler"),
            "noise_schedule": params.get("noise_schedule"),
            "uc_preset": params.get("uc_preset"),
            "seed": params.get("seed"),
            "quality_toggle": params.get("quality_toggle"),
            "variety": params.get("variety"),
            "furry_mode": params.get("furry_mode"),
            "decrisp": params.get("decrisp"),
            "sm": params.get("sm"),
            "sm_dyn": params.get("sm_dyn"),
            "legacy_uc": params.get("legacy_uc"),
            "vibes": [v.get("id") for v in (params.get("vibes") or [])],
        },
    }
