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
MAX_PORT_SHIFT = 20


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
    parser = argparse.ArgumentParser(description="Start PromptCard Studio backend")
    parser.add_argument("--no-browser", action="store_true", help="Do not open the browser")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Preferred port")
    args = parser.parse_args()

    port = pick_port(args.port)
    if not port:
        print(
            f"[ERROR] Ports {args.port}-{args.port + MAX_PORT_SHIFT - 1} are all occupied "
            "or reserved by the system. Please close other processes and retry."
        )
        return 1

    try:
        import uvicorn
        from app.main import app
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] Failed to load the application: {exc}")
        print("Please run run.bat / run.sh to set up the environment first.")
        return 1

    url = f"http://127.0.0.1:{port}"
    print(f"Starting backend on {url} ...")

    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="info")
    server = uvicorn.Server(config)

    no_browser = args.no_browser or os.environ.get("PCS_NO_BROWSER") == "1"
    if not no_browser:

        def open_browser():
            if wait_healthy(port):
                print(f"Service is ready: {url}")
                webbrowser.open(url)
            else:
                print("[ERROR] Service did not become ready in time.")

        threading.Thread(target=open_browser, daemon=True).start()

    maybe_hide_console()

    try:
        server.run()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
