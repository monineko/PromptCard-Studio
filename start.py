"""PromptCard Studio launcher.

Starts the backend, waits until it is healthy, then opens the default browser.
Used by run.bat (Windows) and run.sh (macOS / Linux) as the single entry point.

Usage:
    python start.py [--no-browser] [--port 14419]
"""

import argparse
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))

DEFAULT_PORT = 14419
# Windows may reserve a contiguous "excluded port" block for Hyper-V / WSL2 /
# Docker (e.g. 14397-14996 here). Those ports refuse bind() even though nothing
# is listening, so the shift window must be wide enough to skip such blocks.
# When the preferred port is free, pick_port returns immediately.
MAX_PORT_SHIFT = 1000


def configure_stdio() -> None:
    """统一使用 UTF-8，保证直接运行 start.py 时也能显示中文与终端符号。"""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (OSError, ValueError):
                pass


def port_bindable(port: int) -> bool:
    """Return True if the port can really be bound on 127.0.0.1.

    Unlike a connect probe, this also detects Windows reserved/excluded
    port ranges (e.g. Hyper-V / WSL dynamic ranges) which refuse bind with
    EACCES (WinError 10013) even when nothing is listening.
    """
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def pick_port(preferred: int) -> int:
    for port in range(preferred, preferred + MAX_PORT_SHIFT):
        if port_bindable(port):
            return port
    return 0


def wait_healthy(port: int, timeout: float = 40.0) -> bool:
    import urllib.request

    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/health", timeout=1
            ) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.3)
    return False


def maybe_hide_console() -> None:
    """Hide the backend console window when enabled in config.json (Windows only)."""
    if os.name != "nt":
        return
    try:
        config_path = ROOT / "config.json"
        if not config_path.exists():
            return
        import json

        with open(config_path, encoding="utf-8") as f:
            config = json.load(f)
        if not config.get("hide_backend_panel"):
            return
        import ctypes

        hwnd = ctypes.windll.kernel32.GetConsoleWindow()
        if hwnd:
            ctypes.windll.user32.ShowWindow(hwnd, 0)  # SW_HIDE
    except Exception:
        pass


def main() -> int:
    configure_stdio()
    parser = argparse.ArgumentParser(description="Start PromptCard Studio backend")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred port")
    args = parser.parse_args()

    port = pick_port(args.port)
    if not port:
        print(f"[错误] 端口 {args.port}-{args.port + MAX_PORT_SHIFT - 1} 均被占用或由系统保留，请关闭占用程序后重试。")
        return 1

    try:
        import uvicorn
        from app.main import app
        from app import terminal as terminal_log
    except Exception as exc:  # noqa: BLE001
        print(f"[错误] 后端应用加载失败：{exc}")
        print("请先通过 run.bat / run.sh 启动，以完成运行环境检查。")
        return 1

    url = f"http://127.0.0.1:{port}"
    terminal_log.startup_panel(
        app.version,
        url,
        frontend_ready=(ROOT / "frontend" / "dist" / "index.html").is_file(),
    )
    terminal_log.log("启动", f"项目目录 · {ROOT}")
    terminal_log.log("服务", f"后端监听 · 127.0.0.1:{port} · 仅允许本机访问")
    terminal_log.log("状态", "本地运行状态每 15 秒检查一次；任务变化会立即记录")
    if port != args.port:
        terminal_log.log("警告", f"首选端口 {args.port} 不可用，已自动改用 {port}")

    # 浏览器会高频读取缩略图和任务状态；关闭成功访问记录，仅保留错误与业务日志。
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
    server = uvicorn.Server(config)

    no_browser = args.no_browser or os.environ.get("PCS_NO_BROWSER") == "1"
    if not no_browser:

        def open_browser():
            if wait_healthy(port):
                terminal_log.log("服务", f"服务已就绪 · {url}")
                webbrowser.open(url)
            else:
                terminal_log.log("错误", "服务未能在预期时间内完成启动")

        threading.Thread(target=open_browser, daemon=True).start()

    maybe_hide_console()

    try:
        server.run()
    except KeyboardInterrupt:
        pass
    terminal_log.log("服务", "后端服务已停止")
    return 0


if __name__ == "__main__":
    sys.exit(main())
