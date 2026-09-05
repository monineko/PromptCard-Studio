"""图库文件变动后，所有封面引用都应继续指向同一张图片。"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import cards  # noqa: E402
from app import library as lib  # noqa: E402


class ImageReferenceConsistencyTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pcs_image_refs_"))
        self.library_root = self.tmp / "library"
        self.cards_root = self.tmp / "promptcards"
        self.library_root.mkdir(parents=True)

        self.original_load_settings = lib.load_settings
        self.original_card_paths = (
            cards.PROMPTCARDS_DIR,
            cards.CARD_IMAGES_FILE,
            cards.CARD_META_FILE,
            cards.CARD_PINS_FILE,
        )
        lib.load_settings = lambda: {  # type: ignore[method-assign]
            "library_path": str(self.library_root),
            "recycle_reject": False,
        }
        cards.PROMPTCARDS_DIR = self.cards_root
        cards.CARD_IMAGES_FILE = self.cards_root / ".card-images.json"
        cards.CARD_META_FILE = self.cards_root / ".card-meta.json"
        cards.CARD_PINS_FILE = self.cards_root / ".card-pins.json"
        lib._UNDO_STORE.clear()

    def tearDown(self):
        lib.load_settings = self.original_load_settings  # type: ignore[method-assign]
        (
            cards.PROMPTCARDS_DIR,
            cards.CARD_IMAGES_FILE,
            cards.CARD_META_FILE,
            cards.CARD_PINS_FILE,
        ) = self.original_card_paths
        lib._UNDO_STORE.clear()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _bind_both_covers(self, relative_path: str, card_name: str) -> None:
        image = self.library_root / relative_path
        image.parent.mkdir(parents=True, exist_ok=True)
        image.write_bytes(b"image")
        cards.create_card("动作", card_name, "1girl")
        cards.set_card_image("动作", card_name, relative_path)
        lib.set_cover("unrated", relative_path)

    def _assert_cover_paths(self, card_name: str, expected: str | None) -> None:
        card_images = cards.list_cards_images()
        library_covers = lib.list_covers()
        if expected is None:
            self.assertNotIn(f"动作:{card_name}", card_images)
            self.assertNotIn("unrated", library_covers)
        else:
            self.assertEqual(card_images[f"动作:{card_name}"], expected)
            self.assertEqual(library_covers["unrated"], expected)

    def test_move_and_undo_remap_card_and_library_covers(self):
        original = "2026-09-06/move.png"
        self._bind_both_covers(original, "移动")

        # 制造同名冲突，确保引用跟随实际生成的唯一目标路径。
        today = lib.date.today().isoformat()
        collision = self.library_root / "Treasure" / f"Treasure-{today}" / "move.png"
        collision.parent.mkdir(parents=True, exist_ok=True)
        collision.write_bytes(b"existing")

        moved = lib.move_images([original], "treasure")
        destination = moved["applied"][0]["dest"]
        self.assertNotEqual(destination, original)
        self._assert_cover_paths("移动", destination)

        undone = lib.undo_review(moved["undo_token"])
        self.assertEqual(len(undone["restored"]), 1)
        self._assert_cover_paths("移动", original)

    def test_review_move_remaps_card_and_library_covers(self):
        original = "2026-09-06/review.png"
        self._bind_both_covers(original, "筛选")

        reviewed = lib.apply_review([{"path": original, "tag": "fine"}])
        destination = reviewed["applied"][0]["dest"]
        self._assert_cover_paths("筛选", destination)

    def test_delete_clears_card_and_library_covers(self):
        original = "2026-09-06/delete.png"
        self._bind_both_covers(original, "删除")

        deleted = lib.delete_images([original])
        self.assertEqual(len(deleted["deleted"]), 1)
        self._assert_cover_paths("删除", None)


if __name__ == "__main__":
    unittest.main(verbosity=2)
