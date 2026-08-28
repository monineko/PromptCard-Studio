"""发布版本号一致性回归测试。"""

from __future__ import annotations

import json
import re
import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app.main import app  # noqa: E402


class ReleaseMetadataTest(unittest.TestCase):
    def test_frontend_backend_and_package_versions_are_synchronized(self):
        update_source = (PROJECT_ROOT / "frontend" / "src" / "update.ts").read_text(encoding="utf-8")
        version_match = re.search(r'APP_VERSION\s*=\s*"([^"\s]+)"', update_source)
        self.assertIsNotNone(version_match)
        frontend_version = version_match.group(1) if version_match else ""
        package_version = json.loads((PROJECT_ROOT / "frontend" / "package.json").read_text(encoding="utf-8"))["version"]
        lock_version = json.loads((PROJECT_ROOT / "frontend" / "package-lock.json").read_text(encoding="utf-8"))["version"]

        self.assertEqual(frontend_version, "1.2.3")
        self.assertEqual(frontend_version, package_version)
        self.assertEqual(frontend_version, lock_version)
        self.assertEqual(frontend_version, app.version)

    def test_windows_portable_uses_prebuilt_frontend_without_npm(self):
        launcher_file = PROJECT_ROOT / "run.bat"
        launcher_bytes = launcher_file.read_bytes()
        self.assertFalse(launcher_bytes.startswith(b"\xef\xbb\xbf"), "run.bat 不能带 UTF-8 BOM")
        self.assertTrue(all(byte < 128 for byte in launcher_bytes), "run.bat 必须是纯 ASCII 入口")
        self.assertIsNone(re.search(rb"(?<!\r)\n", launcher_bytes), "run.bat 必须使用 CRLF")

        launcher = launcher_bytes.decode("ascii")
        helper_call = 'call "%~dp0run-utf8.bat"'
        self.assertIn(helper_call, launcher)
        self.assertLess(launcher.index("chcp 65001"), launcher.index(helper_call))

        helper_file = PROJECT_ROOT / "run-utf8.bat"
        helper_bytes = helper_file.read_bytes()
        self.assertFalse(helper_bytes.startswith(b"\xef\xbb\xbf"), "run-utf8.bat 不能带 UTF-8 BOM")
        self.assertTrue(all(byte < 128 for byte in helper_bytes), "run-utf8.bat 必须保持纯 ASCII")
        self.assertIsNone(re.search(rb"(?<!\r)\n", helper_bytes), "run-utf8.bat 必须使用 CRLF")

        helper = helper_bytes.decode("ascii")
        portable_guard = helper.index('if "%PORTABLE_MODE%"=="1"')
        source_timestamp_check = helper.index("Get-ChildItem 'frontend\\src'")

        self.assertLess(portable_guard, source_timestamp_check)
        self.assertIn("Portable mode is using the prebuilt frontend. Node.js is not required.", helper)

    def test_windows_launcher_never_hides_the_backend_console(self):
        launcher = (PROJECT_ROOT / "start.py").read_text(encoding="utf-8")

        for removed_symbol in (
            "hide_backend_panel",
            "maybe_hide_console",
            "GetConsoleWindow",
            "ShowWindow",
        ):
            self.assertNotIn(removed_symbol, launcher)


if __name__ == "__main__":
    unittest.main(verbosity=2)
