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

        self.assertEqual(frontend_version, "1.2.1")
        self.assertEqual(frontend_version, package_version)
        self.assertEqual(frontend_version, lock_version)
        self.assertEqual(frontend_version, app.version)


if __name__ == "__main__":
    unittest.main(verbosity=2)
