"""生成任务的轻量互斥协调器。

当前普通批量任务已经自行维护断点和工作线程，画风探索首轮尚未启动
实际生图。因此这里不接管调度，只提供进程内的「谁占用了生成通道」
约束。调用方仍须检查旧批量任务的 active 状态。
"""

from __future__ import annotations

import threading
from datetime import datetime
from typing import Callable


_lock = threading.RLock()
_reservation: dict | None = None


def _now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def acquire(
    owner: str,
    task_id: str,
    unavailable_reason: Callable[[], str | None] | None = None,
) -> dict:
    """占用生成通道；同一任务重复占用是幂等操作。"""
    if not owner or not task_id:
        raise ValueError("生成任务标识不能为空")
    with _lock:
        global _reservation
        if _reservation is not None:
            if _reservation["owner"] == owner and _reservation["task_id"] == task_id:
                return dict(_reservation)
            raise ValueError(
                f"生成通道正被{_reservation['owner']}任务「{_reservation['task_id']}」占用"
            )
        if unavailable_reason is not None:
            reason = unavailable_reason()
            if reason:
                raise ValueError(reason)
        _reservation = {"owner": owner, "task_id": task_id, "acquired_at": _now()}
        return dict(_reservation)


def release(owner: str, task_id: str | None = None) -> bool:
    """释放自己的占用；非所有者不会释放其他模块的任务。"""
    with _lock:
        global _reservation
        if _reservation is None:
            return False
        if _reservation["owner"] != owner:
            return False
        if task_id is not None and _reservation["task_id"] != task_id:
            return False
        _reservation = None
        return True


def status() -> dict:
    with _lock:
        return {"occupied": _reservation is not None, "reservation": dict(_reservation) if _reservation else None}


def assert_available_for_batch() -> None:
    """普通批量开始前调用，避免与其他生成任务抢占请求通道。"""
    with _lock:
        if _reservation is not None:
            owner_label = {
                "style_explore": "画风探索",
                "batch_cover": "批量卡面",
            }.get(str(_reservation.get("owner")), "其他")
            raise ValueError(
                f"{owner_label}任务正在占用生成通道，请先暂停、结束或完成该任务"
            )
