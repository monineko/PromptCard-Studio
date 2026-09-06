import sys
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import image_references  # noqa: E402


class ImageReferenceRollbackTest(unittest.TestCase):
    def test_rollback_failure_is_logged_without_masking_original_error(self):
        first_saves: list[dict[str, str]] = []

        def save_first(value: dict[str, str]) -> None:
            first_saves.append(value)
            if len(first_saves) == 2:
                raise OSError("rollback failed")

        def save_second(_value: dict[str, str]) -> None:
            raise RuntimeError("primary save failed")

        stores = (
            image_references.ImageReferenceStore(
                "cards",
                lambda: {"card": "old.png"},
                save_first,
            ),
            image_references.ImageReferenceStore(
                "covers",
                lambda: {"cover": "old.png"},
                save_second,
            ),
        )

        with mock.patch.object(image_references.terminal_log, "log") as log:
            with self.assertRaisesRegex(RuntimeError, "primary save failed"):
                image_references.rewrite_image_references(
                    stores,
                    moved={"old.png": "new.png"},
                )

        log.assert_called_once()
        self.assertEqual(log.call_args.args[0], "错误")
        self.assertIn("cards", log.call_args.args[1])
        self.assertIn("rollback failed", log.call_args.args[1])


if __name__ == "__main__":
    unittest.main()
