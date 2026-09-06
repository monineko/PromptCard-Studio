"""M2 图片库后端自测（可独立运行：python backend/tests/test_library.py）。

覆盖：扫描分类/日期分组、PNG 信息解析、筛选结束后的移动/删除、会话撤销。
使用临时目录作为图库，不触碰真实用户数据。
"""

import asyncio
import json
import shutil
import socket
import sys
import tempfile
import threading
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import library as lib  # noqa: E402

ANR_SAMPLE = Path(
    r"C:\Auto-NovelAI-Refactor\outputs\image2image\sample.png"
)


class LibraryServiceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="npm_lib_test_"))
        lib.load_settings = lambda: {  # type: ignore[method-assign]
            "library_path": str(cls.tmp),
            "recycle_reject": False,
        }

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

    def test_01b_summary_uses_lightweight_scan_and_returns_cover_previews(self):
        original_image_size = lib._image_size
        dimension_reads: list[Path] = []
        lib._image_size = lambda path: dimension_reads.append(path) or (1, 1)  # type: ignore[method-assign]
        try:
            result = lib.summary()
        finally:
            lib._image_size = original_image_size  # type: ignore[method-assign]

        self.assertEqual(dimension_reads, [])
        self.assertIn("previews", result)
        self.assertLessEqual(len(result["previews"]["all"]), 12)
        self.assertEqual(len(result["previews"]["treasure"]), 1)
        self.assertEqual(result["previews"]["treasure"][0]["name"], "t.png")

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

    def test_02b_category_scan_reads_dimensions_only_for_matching_images(self):
        original_image_size = lib._image_size
        dimension_reads: list[Path] = []
        lib._image_size = lambda path: dimension_reads.append(path) or (1, 1)  # type: ignore[method-assign]
        try:
            result = lib.list_images("treasure")
        finally:
            lib._image_size = original_image_size  # type: ignore[method-assign]

        self.assertEqual(result["total"], 1)
        self.assertEqual([path.name for path in dimension_reads], ["t.png"])

    def test_02c_category_scan_skips_unrelated_top_level_roots(self):
        roots = lib._category_scan_roots(self.tmp, "treasure")
        self.assertEqual([path.name for path in roots], ["Treasure"])

        unrated_roots = lib._category_scan_roots(self.tmp, "unrated")
        self.assertIn("misc", [path.name for path in unrated_roots])
        self.assertNotIn("Fine", [path.name for path in unrated_roots])

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

    def test_04b_thumbnail_is_cached_without_changing_original(self):
        from PIL import Image

        source = self.tmp / "thumbnail-source.png"
        Image.new("RGB", (1200, 800), "blue").save(source)
        original_bytes = source.read_bytes()

        first = lib.thumbnail("thumbnail-source.png")
        second = lib.thumbnail("thumbnail-source.png")

        self.assertEqual(first, second)
        self.assertTrue(first.is_file())
        self.assertTrue(first.is_relative_to(self.tmp / ".thumbnails"))
        with Image.open(first) as preview:
            self.assertLessEqual(max(preview.size), 512)
        self.assertEqual(source.read_bytes(), original_bytes)

    def test_04c_thumbnail_failure_logs_and_returns_original(self):
        from PIL import Image

        source = self.tmp / "thumbnail-error.png"
        Image.new("RGB", (16, 16), "red").save(source)

        with mock.patch.object(lib.Image, "open", side_effect=OSError("encode failed")):
            with mock.patch.object(lib.terminal_log, "log") as log:
                result = lib.thumbnail("thumbnail-error.png")

        self.assertEqual(result, source)
        log.assert_called_once()
        self.assertEqual(log.call_args.args[0], "警告")
        self.assertIn("thumbnail-error.png", log.call_args.args[1])
        self.assertIn("encode failed", log.call_args.args[1])

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
        self.assertTrue((self.tmp / "Fine" / f"Fine-{today}" / "t.png").exists())
        self.assertTrue((self.tmp / "like" / f"like-{today}" / "f.png").exists())
        self.assertTrue((self.tmp / "Reject" / f"Reject-{today}" / "r.png").exists())
        self.assertFalse((self.tmp / "Reject" / "2026-08-01" / "r.png").exists())

        undo = lib.undo_review(result["undo_token"])
        self.assertEqual(len(undo["restored"]), 3)
        self.assertEqual(len(undo["failed"]), 0)
        self.assertTrue((self.tmp / "Treasure" / "2026-08-01" / "t.png").exists())
        self.assertTrue((self.tmp / "Fine" / "2026-08-02" / "f.png").exists())
        self.assertTrue((self.tmp / "Reject" / "2026-08-01" / "r.png").exists())
        self.assertFalse((self.tmp / "Fine" / f"Fine-{today}" / "t.png").exists())

    def test_07_reapply_same_target_skipped(self):
        src = self.tmp / "Treasure" / "2026-08-01" / "t.png"
        result = lib.apply_review([{"path": "Treasure/2026-08-01/t.png", "tag": "fine"}])
        today = lib.date.today().isoformat()
        dest = self.tmp / "Fine" / f"Fine-{today}" / "t.png"
        self.assertTrue(dest.exists())
        second = lib.apply_review([{"path": f"Fine/Fine-{today}/t.png", "tag": "fine"}])
        self.assertEqual(len(second["applied"]), 0)
        self.assertEqual(len(second["skipped"]), 1)
        lib.undo_review(result["undo_token"])
        self.assertTrue(src.exists())

    def test_08_import_uploaded_files(self):
        result = lib.import_uploaded_files(
            [("a.png", b"x"), ("a.png", b"y"), ("note.txt", b"z")]
        )
        today = lib.date.today().isoformat()
        self.assertEqual(result["imported"], 2)
        self.assertEqual(result["skipped"], 1)
        self.assertTrue((self.tmp / today / "a.png").exists())
        self.assertTrue((self.tmp / today / "a (1).png").exists())

    def test_08b_import_uploaded_files_to_category(self):
        result = lib.import_uploaded_files([("dropped.png", b"x")], target="treasure")
        today = lib.date.today().isoformat()
        destination = self.tmp / "Treasure" / f"Treasure-{today}" / "dropped.png"
        self.assertEqual(result["imported"], 1)
        self.assertTrue(destination.exists())
        self.assertEqual(result["items"][0]["category"], "treasure")

    def test_08c_remote_import_rejects_local_addresses(self):
        result = lib.import_remote_urls(["http://127.0.0.1/private.png"], target="unrated")
        self.assertEqual(result["imported"], 0)
        self.assertEqual(result["skipped"], 1)
        self.assertIn("不允许下载本机地址", result["errors"][0])

    def test_08d_streamed_upload_writes_to_target_category(self):
        class FakeUpload:
            filename = "streamed.webp"

            def __init__(self):
                self.chunks = [b"first", b"second", b""]

            async def read(self, _size):
                return self.chunks.pop(0)

        result = asyncio.run(lib.import_uploaded_streams([FakeUpload()], "fine"))
        today = lib.date.today().isoformat()
        self.assertEqual(result["imported"], 1)
        self.assertTrue((self.tmp / "Fine" / f"Fine-{today}" / "streamed.webp").exists())

    def test_08e_streamed_upload_writes_unrated_images_to_today_folder(self):
        class FakeUpload:
            filename = "unrated.webp"

            def __init__(self):
                self.chunks = [b"image", b""]

            async def read(self, _size):
                return self.chunks.pop(0)

        result = asyncio.run(lib.import_uploaded_streams([FakeUpload()], "unrated"))
        today = lib.date.today().isoformat()
        self.assertEqual(result["imported"], 1)
        self.assertTrue((self.tmp / today / "unrated.webp").exists())

    def test_09_import_from_path(self):
        src = Path(tempfile.mkdtemp(prefix="npm_import_src_"))
        (src / "2026-08-01").mkdir()
        (src / "2026-08-01" / "x.png").write_bytes(b"x")
        (src / "2026-08-02").mkdir()
        (src / "2026-08-02" / "y.jpg").write_bytes(b"y")
        (src / "2026-08-02" / "skip.txt").write_text("no", encoding="utf-8")
        result = lib.import_from_path(str(src))
        self.assertEqual(result["imported"], 2)
        self.assertTrue((self.tmp / "2026-08-01" / "x.png").exists())
        self.assertTrue((self.tmp / "2026-08-02" / "y.jpg").exists())
        shutil.rmtree(src, ignore_errors=True)

    def test_10_import_from_path_missing(self):
        with self.assertRaises(FileNotFoundError):
            lib.import_from_path(str(self.tmp / "no_such_dir"))

    def test_11_new_folder_format(self):
        (self.tmp / "Treasure-2026-08-07").mkdir(parents=True)
        (self.tmp / "Treasure-2026-08-07" / "x.png").write_bytes(b"x")
        (self.tmp / "like-2026-08-07").mkdir(parents=True, exist_ok=True)
        (self.tmp / "like-2026-08-07" / "y.png").write_bytes(b"y")
        treasure = lib.list_images("treasure")["items"]
        self.assertTrue(any(i["date"] == "2026-08-07" for i in treasure))
        favorites = lib.list_images("favorites")["items"]
        self.assertTrue(any(i["date"] == "2026-08-07" for i in favorites))

    def test_12_move_images(self):
        (self.tmp / "mv1.png").write_bytes(b"x")
        # 已在根目录（未评分）时移动 unrated 应跳过而不是重命名
        same = lib.move_images(["mv1.png"], "unrated")
        self.assertEqual(len(same["applied"]), 0)
        self.assertEqual(len(same["skipped"]), 1)
        self.assertTrue((self.tmp / "mv1.png").exists())
        self.assertFalse((self.tmp / "mv1 (1).png").exists())
        # 移到 Treasure
        result = lib.move_images(["mv1.png"], "treasure")
        self.assertEqual(len(result["applied"]), 1)
        today = lib.date.today().isoformat()
        dest = self.tmp / "Treasure" / f"Treasure-{today}" / "mv1.png"
        self.assertTrue(dest.exists())
        # 移回未评分
        back = lib.move_images([f"Treasure/Treasure-{today}/mv1.png"], "unrated")
        self.assertTrue((self.tmp / "mv1.png").exists())
        self.assertEqual(len(back["applied"]), 1)
        undo = lib.undo_review(back["undo_token"])
        self.assertEqual(len(undo["restored"]), 1)
        self.assertTrue(dest.exists())

    def test_13_delete_images(self):
        today = lib.date.today().isoformat()
        folder = self.tmp / f"Reject-{today}"
        folder.mkdir(parents=True, exist_ok=True)
        file = folder / "del.png"
        file.write_bytes(b"x")
        result = lib.delete_images([f"Reject-{today}/del.png"])
        self.assertEqual(len(result["deleted"]), 1)
        self.assertEqual(result["deleted"][0]["mode"], "permanent")
        self.assertFalse(file.exists())


class LibraryHttpSmokeTest(unittest.TestCase):
    """真实 HTTP 层冒烟：起一个临时 uvicorn，走一遍核心接口。"""

    PORT = 11551

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="npm_lib_http_"))
        (cls.tmp / "Treasure" / "2026-08-05").mkdir(parents=True)
        from PIL import Image

        Image.new("RGB", (640, 960), "green").save(
            cls.tmp / "Treasure" / "2026-08-05" / "web.png"
        )
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            cls.PORT = probe.getsockname()[1]

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
        with urllib.request.urlopen(
            f"http://127.0.0.1:{self.PORT}/api/library/thumbnail?path=Treasure%2F2026-08-05%2Fweb.png"
        ) as resp:
            self.assertEqual(resp.headers.get_content_type(), "image/webp")
            self.assertTrue(resp.read().startswith(b"RIFF"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
