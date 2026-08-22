"""用户数据迁移白名单与覆盖备份自测。"""

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from tempfile import SpooledTemporaryFile

from fastapi import UploadFile

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import migration  # noqa: E402


class MigrationTest(unittest.TestCase):
    def test_destination_allowlist(self):
        self.assertIsNotNone(migration.destination_for("promptcards/角色/a.txt"))
        self.assertIsNotNone(migration.destination_for("config.json"))
        self.assertIsNotNone(migration.destination_for("plugins/auto_mosaics/models/runtime/model.onnx"))
        self.assertIsNone(migration.destination_for("frontend/src/App.tsx"))
        with self.assertRaises(ValueError):
            migration.destination_for("../config.json")

    def test_migrate_and_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            old_root = migration.PROJECT_ROOT
            migration.PROJECT_ROOT = root  # type: ignore[assignment]
            try:
                destination = root / "config.json"
                destination.write_text("new", encoding="utf-8")
                source = SpooledTemporaryFile()
                source.write(b"old")
                source.seek(0)
                upload = UploadFile(filename="config.json", file=source)
                result = asyncio.run(migration.migrate_uploads([upload], ["config.json"]))
                self.assertEqual(result["copied"], 1)
                self.assertEqual(result["overwritten"], 1)
                self.assertEqual(destination.read_text(encoding="utf-8"), "old")
                self.assertIsNotNone(result["backup"])
                source.close()
            finally:
                migration.PROJECT_ROOT = old_root  # type: ignore[assignment]


if __name__ == "__main__":
    unittest.main()
