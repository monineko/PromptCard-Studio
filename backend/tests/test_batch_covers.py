"""批量卡面任务的组合归属、懒加载候选与封面绑定回归。"""

import shutil
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import batch  # noqa: E402
from app import batch_covers  # noqa: E402
from app import cards  # noqa: E402
from app import generation_coordinator  # noqa: E402
from app import library as lib  # noqa: E402


class BatchCoverServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="pcs_batch_covers_"))
        self.library_root = self.tmp / "library"
        self.cards_root = self.tmp / "promptcards"
        self.library_root.mkdir(parents=True)

        self.originals = {
            "library_load_settings": lib.load_settings,
            "cards_paths": (
                cards.PROMPTCARDS_DIR,
                cards.CARD_IMAGES_FILE,
                cards.CARD_META_FILE,
                cards.CARD_PINS_FILE,
            ),
            "cover_dir": batch_covers.BATCH_COVER_DIR,
            "cover_record": batch_covers.RECORD_FILE,
            "batch_dir": batch.BATCH_DIR,
            "batch_record": batch.RECORD_FILE,
            "is_configured": batch_covers.novelai_service.is_configured,
            "inquire_anlas": batch_covers.novelai_service.inquire_anlas,
            "start_worker": batch_covers._start_worker,
            "generate_item": batch.generate_item,
            "cool_down": batch_covers._cool_down,
        }
        lib.load_settings = lambda: {  # type: ignore[method-assign]
            "library_path": str(self.library_root),
            "recycle_reject": False,
        }
        cards.PROMPTCARDS_DIR = self.cards_root
        cards.CARD_IMAGES_FILE = self.cards_root / ".card-images.json"
        cards.CARD_META_FILE = self.cards_root / ".card-meta.json"
        cards.CARD_PINS_FILE = self.cards_root / ".card-pins.json"
        batch_covers.BATCH_COVER_DIR = self.tmp / "batch_cover_runs"
        batch_covers.RECORD_FILE = batch_covers.BATCH_COVER_DIR / "active.json"
        batch.BATCH_DIR = self.tmp / "batch_runs"
        batch.RECORD_FILE = batch.BATCH_DIR / "active.json"
        batch_covers.novelai_service.is_configured = lambda: True
        batch_covers.novelai_service.inquire_anlas = lambda: (9000, None)
        batch_covers._start_worker = lambda: None
        batch_covers._worker = None
        batch_covers._stop_event.clear()
        batch_covers._ended.clear()
        generation_coordinator.release("batch_cover")
        generation_coordinator.release("style_explore")

    def tearDown(self):
        lib.load_settings = self.originals["library_load_settings"]  # type: ignore[method-assign]
        (
            cards.PROMPTCARDS_DIR,
            cards.CARD_IMAGES_FILE,
            cards.CARD_META_FILE,
            cards.CARD_PINS_FILE,
        ) = self.originals["cards_paths"]
        batch_covers.BATCH_COVER_DIR = self.originals["cover_dir"]
        batch_covers.RECORD_FILE = self.originals["cover_record"]
        batch.BATCH_DIR = self.originals["batch_dir"]
        batch.RECORD_FILE = self.originals["batch_record"]
        batch_covers.novelai_service.is_configured = self.originals["is_configured"]
        batch_covers.novelai_service.inquire_anlas = self.originals["inquire_anlas"]
        batch_covers._start_worker = self.originals["start_worker"]
        batch.generate_item = self.originals["generate_item"]
        batch_covers._cool_down = self.originals["cool_down"]
        batch_covers._worker = None
        batch_covers._stop_event.clear()
        batch_covers._ended.clear()
        generation_coordinator.release("batch_cover")
        generation_coordinator.release("style_explore")
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _create_cards(self):
        cards.create_card("角色", "猫羽", "1girl")
        cards.create_card("动作", "挥手", "waving")
        cards.create_card("动作", "奔跑", "running")

    def _start_task(self) -> dict:
        self._create_cards()
        return batch_covers.start(
            "<角色:猫羽>",
            "",
            [
                {
                    "name": "动作",
                    "cards": [
                        {"category": "动作", "name": "挥手", "coefficient": 1},
                        {"category": "动作", "name": "奔跑", "coefficient": 1},
                    ],
                }
            ],
            [{"category": "角色", "name": "猫羽"}],
            [
                {"category": "角色", "name": "猫羽"},
                {"category": "动作", "name": "挥手"},
                {"category": "动作", "name": "奔跑"},
            ],
            {"seed": -1},
            8000,
        )

    def _finish_items(self) -> None:
        record = batch_covers._load_record()
        assert record is not None
        for index, item in enumerate(record["items"]):
            relative = f"2026-09-06/result-{index}.png"
            image = self.library_root / relative
            image.parent.mkdir(parents=True, exist_ok=True)
            image.write_bytes(b"image")
            item.update({"status": "done", "path": relative, "seed": index})
            record["last_image"] = {
                "path": relative,
                "name": image.name,
                "seed": index,
            }
        record["status"] = "completed"
        batch_covers._save_record(record)
        generation_coordinator.release("batch_cover", record["id"])

    def test_build_items_keeps_structured_cards_for_each_cross_product_item(self):
        items = batch.build_items(
            [
                {
                    "name": "角色",
                    "cards": [{"category": "角色", "name": "猫羽", "coefficient": 2}],
                },
                {
                    "name": "动作",
                    "cards": [
                        {"category": "动作", "name": "挥手", "coefficient": 1},
                        {"category": "动作", "name": "奔跑", "coefficient": 1},
                    ],
                },
            ]
        )
        self.assertEqual(len(items), 4)
        self.assertEqual(
            items[0]["cards"],
            [
                {"category": "角色", "name": "猫羽"},
                {"category": "动作", "name": "挥手"},
            ],
        )
        self.assertEqual(items[2]["cards"][1]["name"], "奔跑")

    def test_status_is_summary_only_and_candidates_load_for_one_card(self):
        started = self._start_task()
        self.assertEqual(started["target_count"], 3)
        self._finish_items()

        run = batch_covers.status()["run"]
        by_key = {f"{target['category']}:{target['name']}": target for target in run["targets"]}
        self.assertEqual(by_key["角色:猫羽"]["candidate_count"], 2)
        self.assertEqual(by_key["动作:挥手"]["candidate_count"], 1)
        self.assertNotIn("items", by_key["角色:猫羽"])

        role_candidates = batch_covers.candidates("角色", "猫羽")
        self.assertEqual(len(role_candidates["items"]), 2)
        action_candidates = batch_covers.candidates("动作", "挥手")
        self.assertEqual(len(action_candidates["items"]), 1)

    def test_assign_defaults_uses_first_successful_candidate_per_card(self):
        self._start_task()
        self._finish_items()

        result = batch_covers.assign_defaults()
        self.assertEqual(len(result["assigned"]), 3)
        images = cards.list_cards_images()
        self.assertEqual(images["角色:猫羽"], "2026-09-06/result-0.png")
        self.assertEqual(images["动作:挥手"], "2026-09-06/result-0.png")
        self.assertEqual(images["动作:奔跑"], "2026-09-06/result-1.png")

    def test_assign_defaults_does_not_overwrite_a_cover_set_after_task_start(self):
        self._start_task()
        self._finish_items()
        cards.set_card_image("角色", "猫羽", "2026-09-06/result-1.png")

        result = batch_covers.assign_defaults()
        self.assertEqual(len(result["assigned"]), 2)
        self.assertEqual(len(result["skipped"]), 1)
        self.assertEqual(
            cards.list_cards_images()["角色:猫羽"], "2026-09-06/result-1.png"
        )

    def test_candidate_and_assigned_cover_follow_library_move_and_delete(self):
        self._start_task()
        self._finish_items()
        batch_covers.assign("动作", "挥手", "2026-09-06/result-0.png")
        record = batch_covers._load_record()
        assert record is not None
        record["last_image"] = {
            "path": "2026-09-06/result-0.png",
            "name": "result-0.png",
            "seed": 0,
        }
        batch_covers._save_record(record)

        moved = lib.move_images(["2026-09-06/result-0.png"], "treasure")
        destination = moved["applied"][0]["dest"]
        self.assertEqual(cards.list_cards_images()["动作:挥手"], destination)
        self.assertEqual(
            batch_covers.candidates("动作", "挥手")["items"][0]["path"],
            destination,
        )
        self.assertEqual(batch_covers.status()["run"]["last_image"]["path"], destination)

        lib.delete_images([destination])
        self.assertNotIn("动作:挥手", cards.list_cards_images())
        self.assertEqual(batch_covers.candidates("动作", "挥手")["items"], [])
        self.assertIsNone(batch_covers.status()["run"]["last_image"])

    def test_worker_generates_all_items_and_releases_generation_channel(self):
        self._start_task()

        def fake_generate(_record: dict, item: dict) -> dict:
            relative = f"2026-09-06/generated-{item['i']}.png"
            image = self.library_root / relative
            image.parent.mkdir(parents=True, exist_ok=True)
            image.write_bytes(b"image")
            return {
                "path": relative,
                "name": image.name,
                "seed": item["i"],
                "anlas": 8990 - item["i"],
            }

        batch.generate_item = fake_generate
        batch_covers._cool_down = lambda *_args: True
        batch_covers._worker_loop()

        run = batch_covers.status()["run"]
        self.assertEqual(run["status"], "completed")
        self.assertEqual(run["done"], 2)
        self.assertIsNone(generation_coordinator.status()["reservation"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
