"""面向本地后端窗口的轻量彩色输出。

规范见 ``docs/development/terminal-logging.md``。
"""

from __future__ import annotations

import os
import sys
import threading
from datetime import datetime
from typing import TextIO


RESET = "\033[0m"
TITLE_TEMPLATE = "✦ ─── PromptCard Studio for NovelAI · v{version} ─── ✦"
GITHUB = "https://github.com/monineko/PromptCard-Studio"

_PALETTE = {
    "启动": (174, 214, 255),
    "服务": (174, 214, 255),
    "生成": (196, 181, 253),
    "成功": (134, 239, 172),
    "等待": (253, 224, 145),
    "重试": (253, 186, 116),
    "批量": (147, 217, 255),
    "探索": (216, 180, 254),
    "筛选": (249, 168, 212),
    "移动": (165, 243, 252),
    "NAI": (253, 164, 175),
    "连接": (253, 186, 116),
    "状态": (125, 211, 252),
    "卡片": (249, 168, 212),
    "分类": (196, 181, 253),
    "设置": (253, 224, 145),
    "图库": (134, 239, 172),
    "下载": (165, 243, 252),
    "警告": (253, 224, 145),
    "错误": (253, 164, 175),
}
_TEXT_COLOR = (226, 232, 240)
_TITLE_STOPS = ((255, 180, 218), (205, 184, 255), (137, 220, 255))
_PANEL_LABEL_COLORS = {
    "Author": (253, 186, 116),
    "GitHub": (103, 232, 249),
    "Python": (216, 180, 254),
    "Frontend": (134, 239, 172),
    "Backend": (249, 168, 212),
    "Local URL": (147, 217, 255),
}
_lock = threading.Lock()


def _enable_windows_ansi() -> bool:
    if os.name != "nt":
        return True
    try:
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if handle in (0, -1) or not kernel32.GetConsoleMode(handle, ctypes.byref(mode)):
            return False
        return bool(kernel32.SetConsoleMode(handle, mode.value | 0x0004))
    except Exception:
        return False


def supports_color(stream: TextIO | None = None) -> bool:
    """仅在交互式终端启用 ANSI；重定向与 NO_COLOR 自动回退。"""
    target = stream or sys.stdout
    if os.environ.get("NO_COLOR") is not None or os.environ.get("TERM") == "dumb":
        return False
    if os.environ.get("PCS_FORCE_COLOR") == "1":
        return _enable_windows_ansi()
    if not getattr(target, "isatty", lambda: False)():
        return False
    return _enable_windows_ansi()


def _rgb(text: str, color: tuple[int, int, int]) -> str:
    return f"\033[38;2;{color[0]};{color[1]};{color[2]}m{text}{RESET}"


def _interpolate(left: tuple[int, int, int], right: tuple[int, int, int], ratio: float) -> tuple[int, int, int]:
    return tuple(round(a + (b - a) * ratio) for a, b in zip(left, right))


def gradient(text: str, *, color: bool = True) -> str:
    """用浅粉紫蓝横向渐变渲染一行文字。"""
    if not color or len(text) < 2:
        return text
    chunks: list[str] = []
    segments = len(_TITLE_STOPS) - 1
    for index, char in enumerate(text):
        position = index / (len(text) - 1) * segments
        segment = min(int(position), segments - 1)
        tone = _interpolate(_TITLE_STOPS[segment], _TITLE_STOPS[segment + 1], position - segment)
        chunks.append(_rgb(char, tone))
    return "".join(chunks)


def _emit(line: str, stream: TextIO | None = None) -> None:
    with _lock:
        print(line, file=stream or sys.stdout, flush=True)


def log(kind: str, message: str, *, stream: TextIO | None = None) -> None:
    """输出一条紧凑业务日志；每条都可脱离上下文单独阅读。"""
    target = stream or sys.stdout
    color = supports_color(target)
    stamp = datetime.now().strftime("%H:%M:%S")
    label = f"[{kind}]"
    if color:
        stamp = _rgb(stamp, (148, 163, 184))
        label = _rgb(label, _PALETTE.get(kind, _TEXT_COLOR))
        message = _rgb(message, _TEXT_COLOR)
    _emit(f"{stamp} {label} {message}", target)


def startup_panel(version: str, url: str, *, frontend_ready: bool, stream: TextIO | None = None) -> None:
    """输出启动面板；宽度固定，避免窗口缩放时边框错位。"""
    target = stream or sys.stdout
    color = supports_color(target)
    title = TITLE_TEMPLATE.format(version=version)
    separator = "█" * 56

    def border(line: str) -> str:
        return gradient(line, color=color)

    def row(label: str, value: str) -> str:
        content = f"  {label:<13}{value}".ljust(56)
        if not color:
            return f"│{content}│"
        left = _rgb("│", _TITLE_STOPS[0])
        right = _rgb("│", _TITLE_STOPS[-1])
        prefix = "  "
        painted_label = _rgb(f"{label:<13}", _PANEL_LABEL_COLORS[label])
        suffix = value + " " * (56 - len(prefix) - 13 - len(value))
        return f"{left}{prefix}{painted_label}{suffix}{right}"

    lines = [
        gradient(title, color=color),
        gradient(separator, color=color),
        border("╭" + "─" * 56 + "╮"),
        row("Author", "monineko"),
        row("GitHub", "github.com/monineko/PromptCard-Studio"),
        border("├" + "─" * 56 + "┤"),
        row("Python", "✓ Ready"),
        row("Frontend", "✓ Ready" if frontend_ready else "⚠ Missing"),
        row("Backend", "● Running"),
        row("Local URL", url),
        border("╰" + "─" * 56 + "╯"),
        gradient(separator, color=color),
    ]
    _emit("\n" + "\n".join(lines), target)


def compact_error(error: object, limit: int = 500) -> str:
    """压平错误换行，避免服务响应把终端版面撑散。"""
    text = " ".join(str(error).replace("\r", "\n").splitlines()).strip()
    return text if len(text) <= limit else f"{text[: limit - 1]}…"
