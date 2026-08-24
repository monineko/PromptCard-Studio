"""NovelAI 生成请求的共享节流策略。"""

from __future__ import annotations

import random
import time
from collections.abc import Callable


# 收到一张图片后至少等待 4 秒；请求失败后等待更长时间，避免连续撞限流。
COOL_MIN = 4.0
COOL_MAX = 6.0
RETRY_WAIT_MIN = 8.0
RETRY_WAIT_MAX = 15.0


def cool_down(
    min_sec: float,
    max_sec: float,
    is_cancelled: Callable[[], bool] | None = None,
) -> bool:
    """随机等待并按半秒响应暂停/结束。返回 False 代表已取消。"""
    remain = random.uniform(min_sec, max_sec)
    while remain > 0:
        if is_cancelled is not None and is_cancelled():
            return False
        step = min(0.5, remain)
        time.sleep(step)
        remain -= step
    return True
