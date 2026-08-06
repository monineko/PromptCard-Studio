"""M2 图片库后端自测（可独立运行：python backend/tests/test_library.py）。

覆盖：扫描分类/日期分组、PNG 信息解析、筛选结束后的移动/删除、会话撤销。
使用临时目录作为图库，不触碰真实用户数据。
"""

import json
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import library as lib  # noqa: E402

ANR_SAMPLE = Path(
    r"E:\NAI\ANR\Auto-NovelAI-Refactor-main\outputs\image2image\2026-08-04\5783883876_00001.png"
)


class LibraryServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="npm_lib_test_"))
        lib.load_settings = lambda: {"library_path": str(cls.tmp)}  # type: ignore[method-assign]

        (cls.tmp / "Treasure" / "2026-08-01").mkdir(parents=True)
        (cls.tmp / "Fine" / "2026-08-02").mkdir(parents=True)
        (cls.tmp / "Reject" / "2026-08-01").mkdir(parents=True)
        (cls.tmp / "收藏" / "2026-08-03").mkdir(parents=True)
        (cls.tmp / "misc").mkdir(parents=True)
        (cls.tmp / ".trash").mkdir(parents=True)
        (cls.tmp / "a.png").write_bytes(b"x")
        (cls.tmp / "misc" / "b.png").write_bytes(b"x")
        (cls.tmp / "Treasure" / "2026-08-01" / "t.png").write_bytes(b"x")
        (cls.tmp / "Fine" / "2026-08-02" / "f.png").write_bytes(b"x")
        (cls.tmp / "Reject" / "2026-08-01" / "r.png").write_bytes(b"x")
        (cls.tmp / "收藏" / "2026-08-03" / "l.png").write_bytes(b"x")
        (cls.tmp / ".trash" / "hidden.png").write_bytes(b"x")
        (cls.tmp / "notes.txt").write_text("not an image", encoding="utf-8")
        if ANR_SAMPLE.exists():
            shutil.copy2(ANR_SAMPLE, cls.tmp / "sample.png")

    def test_01_summary_counts(self):
        result = lib.summary()
        counts = {c["key"]: c["count"] for c in result["categories"]}
        self.assertEqual(counts["all"], 7 if ANR_SAMPLE.exists() else 6)
        self.assertEqual(counts["treasure"], 1)
        self.assertEqual(counts["fine"], 1)
        self.assertEqual(counts["reject"], 1)
        self.assertEqual(counts["favorites"], 1)
        self.assertEqual(counts["unrated"], 3 if ANR_SAMPLE.exists() else 2)  # a.png + misc/b.png (+ sample.png)

    def test_02_list_by_category_and_date(self):
        treasure = lib.list_images("treasure")
        self.assertEqual(treasure["total"], 1)
        self.assertEqual(treasure["items"][0]["date"], "2026-08-01")
        self.assertGreater(treasure["items"][0]["width"], 0)
        self.assertGreater(treasure["items"][0]["height"], 0)
        unrated = lib.list_images("unrated")
        dates = sorted(i["date"] for i in unrated["items"])
        expected = ["", "", "misc"] if ANR_SAMPLE.exists() else ["", "misc"]
        self.assertEqual(dates, expected)

    def test_03_png_info_parsing(self):
        if not ANR_SAMPLE.exists():
            self.skipTest("ANR 示例图不存在")
        result = lib.read_png_info("sample.png")
        self.assertTrue(result["ok"])
        self.assertIsInstance(result["parsed"], dict)
        self.assertIn("prompt", result["parsed"])
        self.assertIsNotNone(result["summary"]["prompt"])
        self.assertIsNotNone(result["summary"]["uc"])
        self.assertGreater(result["width"], 0)

    def test_04_plain_png_no_comment(self):
        from PIL import Image

        plain = self.tmp / "plain.png"
        Image.new("RGB", (16, 16), "red").save(plain)
        result = lib.read_png_info("plain.png")
        self.assertTrue(result["ok"])
        self.assertIsNone(result["parsed"])
        self.assertIsNone(result["summary"])

    def test_05_traversal_rejected(self):
        with self.assertRaises(ValueError):
            lib.resolve_image("..\\config.json")

    def test_06_apply_review_moves_and_undo(self):
        moves = [
            {"path": "Treasure/2026-08-01/t.png", "tag": "fine"},
            {"path": "Fine/2026-08-02/f.png", "tag": "favorites"},
            {"path": "Reject/2026-08-01/r.png", "tag": "reject"},
        ]
        result = lib.apply_review(moves, recycle_reject=False)
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["applied"]), 3)
        self.assertEqual(len(result["skipped"]), 0)

        today = lib.date.today().isoformat()
        self.assertTrue((self.tmp / "Fine" / today / "t.png").exists())
        self.assertTrue((self.tmp / "收藏" / today / "f.png").exists())
        self.assertFalse((self.tmp / "Reject" / "2026-08-01" / "r.png").exists())

        undo = lib.undo_review(result["undo_token"])
        self.assertEqual(len(undo["restored"]), 2)
        self.assertTrue((self.tmp / "Treasure" / "2026-08-01" / "t.png").exists())
        self.assertTrue((self.tmp / "Fine" / "2026-08-02" / "f.png").exists())
        self.assertFalse((self.tmp / "Fine" / today / "t.png").exists())
        self.assertEqual(len(undo["failed"]), 1)  # reject 已永久删除，无法还原

    def test_07_duplicate_name_dedup(self):
        src = self.tmp / "Treasure" / "2026-08-01" / "t.png"
        result = lib.apply_review([{"path": "Treasure/2026-08-01/t.png", "tag": "fine"}])
        today = lib.date.today().isoformat()
        dest = self.tmp / "Fine" / today / "t.png"
        self.assertTrue(dest.exists())
        second = lib.apply_review([{"path": f"Fine/{today}/t.png", "tag": "fine"}])
        self.assertTrue((self.tmp / "Fine" / today / "t (1).png").exists())
        lib.undo_review(second["undo_token"])
        lib.undo_review(result["undo_token"])
        self.assertTrue(src.exists())


class LibraryHttpSmokeTest(unittest.TestCase):
    """真实 HTTP 层冒烟：起一个临时 uvicorn，走一遍核心接口。"""

    PORT = 11551

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="npm_lib_http_"))
        (cls.tmp / "Treasure" / "2026-08-05").mkdir(parents=True)
        (cls.tmp / "Treasure" / "2026-08-05" / "web.png").write_bytes(b"x")

        import uvicorn

        from app import library as lib_module
        from app.main import app

        lib_module.load_settings = lambda: {"library_path": str(cls.tmp)}  # type: ignore[method-assign]
        config = uvicorn.Config(app, host="127.0.0.1", port=cls.PORT, log_level="warning")
        cls.server = uvicorn.Server(config)
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        import time

        for _ in range(50):
            if cls.server.started:
                break
            time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=5)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _get(self, path: str):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.PORT}{path}") as resp:
            return json.loads(resp.read().decode("utf-8"))

    def test_endpoints(self):
        summary = self._get("/api/library/summary")
        self.assertEqual(summary["categories"][1]["count"], 1)
        images = self._get("/api/library/images?category=treasure")
        self.assertEqual(images["total"], 1)
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.PORT}/api/library/image?path=Treasure%2F2026-08-05%2Fweb.png"
        ) as resp:
            self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
