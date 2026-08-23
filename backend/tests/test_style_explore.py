"""画风探索首轮持久化与互斥协调器自测。"""

import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

PROJECT_ROOT = Path(__file__).resolve().parents[2]
import sys

sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import generation_coordinator as coordinator  # noqa: E402
from app import style_explore as explore  # noqa: E402


class StyleExploreServiceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="pcs_style_explore_")
        root = Path(self.tmp.name)
        self.old_paths = (
            explore.STYLE_EXPLORE_DIR,
            explore.POOLS_DIR,
            explore.POOL_BACKUPS_DIR,
            explore.RUNS_DIR,
            explore.POOLS_INDEX_FILE,
            explore.DEFAULT_POOL_FILE,
        )
        explore.STYLE_EXPLORE_DIR = root / "style_explore"
        explore.POOLS_DIR = explore.STYLE_EXPLORE_DIR / "pools"
        explore.POOL_BACKUPS_DIR = explore.STYLE_EXPLORE_DIR / "pool_backups"
        explore.RUNS_DIR = explore.STYLE_EXPLORE_DIR / "runs"
        explore.POOLS_INDEX_FILE = explore.POOLS_DIR / "index.json"
        explore.DEFAULT_POOL_FILE = explore.POOLS_DIR / f"{explore.DEFAULT_POOL_ID}.txt"
        self.old_batch_check = explore._assert_batch_idle
        explore._assert_batch_idle = lambda: None
        self.generate_gate = __import__("threading").Event()
        self.old_is_configured = explore.novelai_service.is_configured
        self.old_generate = explore.novelai_service.generate_text2image
        self.old_library_root = explore.library_service._library_root
        explore.library_service._library_root = lambda: root / "library"
        self.old_card_paths = (
            explore.cards_service.PROMPTCARDS_DIR,
            explore.cards_service.CARD_IMAGES_FILE,
            explore.cards_service.CARD_META_FILE,
            explore.cards_service.CARD_PINS_FILE,
            explore.cards_service.resolve_image,
        )
        cards_root = root / "promptcards"
        explore.cards_service.PROMPTCARDS_DIR = cards_root
        explore.cards_service.CARD_IMAGES_FILE = cards_root / ".card-images.json"
        explore.cards_service.CARD_META_FILE = cards_root / ".card-meta.json"
        explore.cards_service.CARD_PINS_FILE = cards_root / ".card-pins.json"
        explore.cards_service.resolve_image = lambda path: explore.library_service._library_root() / path
        explore.novelai_service.is_configured = lambda: True

        def fake_generate(_prompt, _negative, _params, output_dir=None):
            self.generate_gate.wait(timeout=1)
            if output_dir is not None:
                Path(output_dir).mkdir(parents=True, exist_ok=True)
                (Path(output_dir) / "fake.png").write_bytes(b"fake")
            return {
                "ok": True,
                "path": str((output_dir or root) / "fake.png"),
                "name": "fake.png",
                "seed": 42,
                "width": 1,
                "height": 1,
                "elapsed_ms": 1,
                "anlas": None,
            }

        explore.novelai_service.generate_text2image = fake_generate
        coordinator.release("style_explore")

    def tearDown(self):
        coordinator.release("style_explore")
        self.generate_gate.set()
        explore._assert_batch_idle = self.old_batch_check
        explore.novelai_service.is_configured = self.old_is_configured
        explore.novelai_service.generate_text2image = self.old_generate
        explore.library_service._library_root = self.old_library_root
        (
            explore.cards_service.PROMPTCARDS_DIR,
            explore.cards_service.CARD_IMAGES_FILE,
            explore.cards_service.CARD_META_FILE,
            explore.cards_service.CARD_PINS_FILE,
            explore.cards_service.resolve_image,
        ) = self.old_card_paths
        (
            explore.STYLE_EXPLORE_DIR,
            explore.POOLS_DIR,
            explore.POOL_BACKUPS_DIR,
            explore.RUNS_DIR,
            explore.POOLS_INDEX_FILE,
            explore.DEFAULT_POOL_FILE,
        ) = self.old_paths
        self.tmp.cleanup()

    def test_pool_normalizes_two_supported_formats_and_keeps_escapes(self):
        content = "a, b\n# note\na\nsakimori_\\(hououbds\\)\nname\\,with-comma\n"
        pool = explore.create_pool("混合池", content, "artists.txt")
        self.assertEqual(pool["count"], 4)
        self.assertEqual(pool["skipped"], 2)
        self.assertEqual(pool["input_count"], 6)
        self.assertEqual(pool["original_count"], 6)
        self.assertEqual(pool["duplicate_count"], 1)
        self.assertEqual(pool["skipped_count"], 1)
        self.assertEqual(pool["duplicate_preview"], ["a"])
        self.assertEqual(pool["skipped_preview"], [{"value": "# note", "reason": "comment"}])
        self.assertEqual(pool["normalized_preview"], ["a", "b", "sakimori_\\(hououbds\\)", "name\\,with-comma"])
        self.assertFalse(pool["normalized_preview_truncated"])
        self.assertEqual(pool["normalized_content"], "a\nb\nsakimori_\\(hououbds\\)\nname\\,with-comma\n")
        self.assertEqual(pool["format_info"]["normalized_format"], "one_id_per_line")
        self.assertEqual(pool["format_info"]["literal_comma_escape"], "\\,")
        self.assertIn("comment_lines_skipped", pool["warnings"])
        loaded = explore.get_pool(pool["id"])
        self.assertEqual(loaded["ids"], ["a", "b", "sakimori_\\(hououbds\\)", "name\\,with-comma"])
        self.assertEqual(loaded["content"], "a\nb\nsakimori_\\(hououbds\\)\nname\\,with-comma\n")
        backups = explore.list_pool_backups(pool["id"])
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0]["kind"], "import_original")
        original_backup = explore.POOL_BACKUPS_DIR / pool["id"] / backups[0]["name"]
        self.assertEqual(original_backup.read_text(encoding="utf-8"), content)

    def test_default_artist_pool_seed_is_indexed_on_first_access(self):
        default_file = explore.POOLS_DIR / "artists_backup.txt"
        default_file.parent.mkdir(parents=True, exist_ok=True)
        default_file.write_text("ciloranko\nwlop\n", encoding="utf-8")

        pools = explore.list_pools()

        self.assertEqual(len(pools), 1)
        self.assertEqual(pools[0]["id"], "artists_backup")
        self.assertEqual(pools[0]["name"], "artists_backup")
        self.assertEqual(pools[0]["count"], 2)
        self.assertEqual(explore.get_pool("artists_backup")["ids"], ["ciloranko", "wlop"])

    def test_pool_update_creates_backup_and_run_snapshots_ids(self):
        pool = explore.create_pool("原池", "a\nb\n")
        run = explore.create_run(pool["id"], 3, "base", "negative", {"model": "nai"})
        explore.update_pool(pool["id"], "changed\n")
        backups = list((explore.POOL_BACKUPS_DIR / pool["id"]).glob("*.txt"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(encoding="utf-8"), "a\nb\n")
        self.assertEqual(run["pool"]["ids"], ["a", "b"])
        loaded = explore.get_run(run["id"])
        self.assertEqual(loaded["prompt_snapshot"]["params"]["model"], "nai")

    def test_target_image_count_is_limited_to_one_thousand(self):
        pool = explore.create_pool("池", "a\n")
        with self.assertRaisesRegex(ValueError, "1000"):
            explore.create_run(pool["id"], 1001, "base", "negative")

    def test_pool_backup_can_be_restored_and_referenced_pool_cannot_be_deleted(self):
        pool = explore.create_pool("原池", "a\nb\n")
        explore.update_pool(pool["id"], "changed\n")
        backups = explore.list_pool_backups(pool["id"])
        self.assertEqual(len(backups), 1)
        restored = explore.restore_pool_backup(pool["id"], backups[0]["name"])
        self.assertEqual(restored["ids"], ["a", "b"])
        self.assertEqual(len(explore.list_pool_backups(pool["id"])), 1)
        run = explore.create_run(pool["id"], 1, "base", "neg")
        with self.assertRaises(ValueError):
            explore.delete_pool(pool["id"])
        explore.delete_run(run["id"])
        self.assertTrue(explore.delete_pool(pool["id"])["ok"])

    def test_run_state_uses_generation_reservation_and_candidate_reviews(self):
        pool = explore.create_pool("池", "a\n")
        run = explore.create_run(pool["id"], 2, "base", "neg", algorithm={"artist_count": 1})
        running = explore.start_run(run["id"])
        self.assertEqual(running["status"], "running")
        self.assertTrue(coordinator.status()["occupied"])
        with self.assertRaises(ValueError):
            coordinator.assert_available_for_batch()
        paused = explore.pause_run(run["id"])
        self.assertEqual(paused["status"], "paused")
        self.assertFalse(coordinator.status()["occupied"])

        added = explore.add_candidates(
            run["id"],
            [{"id": "candidate-1", "artist_string": "artist:a, 0.8::artist:b::", "ids": [{"id": "a", "weight": 0.8}]}],
        )
        self.assertEqual(added["run"]["candidate_count"], 3)
        candidate = explore.update_candidate(
            run["id"], "candidate-1", {"generation": {"status": "done", "seed": 42}, "review": {"heart": True, "rating": 4.5, "label": "treasure"}},
        )
        self.assertEqual(candidate["review"]["label"], "treasure")
        stored = next(item for item in explore.get_run(run["id"])["candidates"] if item["id"] == "candidate-1")
        self.assertEqual(stored["generation"]["seed"], 42)

    def test_invalid_candidate_rating_is_rejected(self):
        pool = explore.create_pool("池", "a\n")
        run = explore.create_run(pool["id"], 1, "base", "neg")
        explore.add_candidates(run["id"], [{"id": "c", "artist_string": "artist:a"}])
        with self.assertRaises(ValueError):
            explore.update_candidate(run["id"], "c", {"review": {"rating": 6}})

    def test_worker_generates_into_task_folder_and_review_moves_image(self):
        pool = explore.create_pool("池", "a\nb\n")
        run = explore.create_run(pool["id"], 1, "base", "neg", algorithm={"artist_count": 1})
        self.generate_gate.set()
        explore.start_run(run["id"])
        for _ in range(50):
            current = explore.get_run(run["id"])
            if current["status"] == "generated":
                break
            time.sleep(0.02)
        self.assertEqual(current["status"], "generated")
        candidate = current["candidates"][0]
        self.assertTrue(Path(candidate["generation"]["path"]).is_file())
        explore.update_candidate(run["id"], candidate["id"], {"review": {"preliminary_label": "treasure"}})
        preliminary = explore.get_run(run["id"])["candidates"][0]
        self.assertEqual(preliminary["generation"]["path"], candidate["generation"]["path"])
        explore.update_candidate(run["id"], candidate["id"], {"review": {"label": "treasure"}})
        moved = explore.get_run(run["id"])["candidates"][0]
        self.assertIn("treasure", Path(moved["generation"]["path"]).parts)
        self.assertTrue(explore.candidate_image_file(run["id"], candidate["id"]).is_file())

    def test_task_can_be_renamed_and_append_round_keeps_its_own_snapshot(self):
        pool = explore.create_pool("池", "a\nb\n")
        run = explore.create_run(pool["id"], 1, "first", "neg", {"seed": 11}, {"artist_count": 1}, name="原任务")
        renamed = explore.rename_run(run["id"], "新任务")
        self.assertEqual(renamed["name"], "新任务")

        appended = explore.append_basic_round(
            run["id"], 2, "second", "other-neg", {"seed": 22}, {"artist_count": 1, "random_seed": 7}
        )
        self.assertEqual(appended["status"], "draft")
        self.assertEqual(len(appended["rounds"]), 1)
        self.assertEqual(len(appended["candidates"]), 2)
        self.assertEqual(appended["candidates"][0]["prompt_snapshot"]["positive"], "second")
        self.assertEqual(appended["candidates"][0]["round_id"], appended["rounds"][0]["id"])

        explore.archive_run(run["id"])
        self.assertNotIn(run["id"], [item["id"] for item in explore.list_runs()])
        self.assertIn(run["id"], [item["id"] for item in explore.list_runs(include_archived=True)])
        self.assertIsNone(explore.archive_run(run["id"], False)["archived_at"])

    def test_resume_replaces_generation_params_only_for_unfinished_candidates(self):
        pool = explore.create_pool("池", "a\nb\n")
        run = explore.create_run(pool["id"], 2, "base", "neg", {"steps": 20}, {"artist_count": 1})
        prepared = explore.append_basic_round(
            run["id"], 2, "base", "neg", {"steps": 20}, {"artist_count": 1, "random_seed": 9}
        )
        record = explore._load_run(run["id"])
        record["status"] = "paused"
        record["candidates"][0]["generation"] = {"status": "done"}
        explore._save_run(record)

        resumed = explore.resume_run(run["id"], {"steps": 31, "sampler": "new"})

        self.assertEqual(resumed["candidates"][0]["prompt_snapshot"]["params"], {"steps": 20})
        self.assertEqual(resumed["candidates"][1]["prompt_snapshot"]["params"], {"steps": 31, "sampler": "new"})
        self.assertEqual(resumed["algorithm"], prepared["algorithm"])

    def test_paused_task_resumes_pending_candidates_across_multiple_deep_rounds(self):
        pool = explore.create_pool("池", "a\nb\nc\nd\n")
        run = explore.create_run(pool["id"], 1, "base", "neg", {"steps": 20}, {"artist_count": 1})
        explore.add_candidates(
            run["id"],
            [
                {"id": "deep-old", "artist_string": "0.8::a::"},
                {"id": "deep-new-a", "artist_string": "0.9::b::"},
                {"id": "deep-new-b", "artist_string": "1.0::c::"},
            ],
        )
        record = explore._load_run(run["id"])
        record["status"] = "paused"
        record["rounds"] = [
            {"id": "round-old", "number": 1, "phase": "deep", "status": "pending", "candidate_ids": ["deep-old"]},
            {"id": "round-new", "number": 2, "phase": "deep", "status": "pending", "candidate_ids": ["deep-new-a", "deep-new-b"]},
        ]
        for candidate in record["candidates"]:
            candidate["round_id"] = "round-old" if candidate["id"] == "deep-old" else "round-new"
            candidate["prompt_snapshot"] = {"positive": "base", "negative": "neg", "params": {"steps": 20}}
        explore._save_run(record)

        self.generate_gate.set()
        explore.resume_run(run["id"], {"steps": 28})
        for _ in range(100):
            current = explore.get_run(run["id"])
            if current["status"] == "generated":
                break
            time.sleep(0.02)

        self.assertEqual(current["status"], "generated")
        self.assertEqual([item["generation"]["status"] for item in current["candidates"]], ["done", "done", "done"])
        self.assertEqual([item["status"] for item in current["rounds"]], ["generated", "generated"])
        self.assertTrue(all(item["prompt_snapshot"]["params"] == {"steps": 28} for item in current["candidates"]))

    def test_restart_recovery_pauses_run_and_requeues_generating_candidate_preserving_done(self):
        pool = explore.create_pool("池", "a\nb\nc\n")
        run = explore.create_run(pool["id"], 3, "base", "neg", algorithm={"artist_count": 1})
        prepared = explore.append_basic_round(
            run["id"], 3, "base", "neg", {}, {"artist_count": 1, "random_seed": 17}
        )
        record = explore._load_run(run["id"])
        done_image = explore._active_dir(run["id"]) / "done.png"
        done_image.write_bytes(b"done")
        record["status"] = "running"
        record["status_reason"] = None
        record["candidates"][0]["generation"] = {
            "status": "done",
            "path": str(done_image),
            "name": done_image.name,
            "seed": 7,
        }
        record["candidates"][1]["generation"] = {"status": "generating"}
        record["candidates"][2]["generation"] = {"status": "pending"}
        explore._save_run(record)
        coordinator.release("style_explore", run["id"])

        recovered = explore.get_run(run["id"])

        self.assertEqual(recovered["status"], "paused")
        self.assertIn("服务重启", recovered["status_reason"])
        self.assertEqual(recovered["candidates"][0]["generation"]["status"], "done")
        self.assertEqual(recovered["candidates"][0]["generation"]["path"], str(done_image))
        self.assertEqual(recovered["candidates"][1]["generation"]["status"], "pending")
        self.assertEqual(recovered["candidates"][2]["generation"]["status"], "pending")
        self.assertEqual(recovered["done_count"], 1)
        self.assertEqual(prepared["target_count"], 3)

        self.generate_gate.set()
        explore.resume_run(run["id"], {"steps": 28})
        for _ in range(50):
            continued = explore.get_run(run["id"])
            if continued["status"] == "generated":
                break
            time.sleep(0.02)
        self.assertEqual(continued["status"], "generated")
        self.assertEqual(continued["done_count"], 3)
        self.assertEqual(continued["candidates"][0]["generation"]["path"], str(done_image))
        self.assertEqual(continued["candidates"][0]["generation"]["seed"], 7)

    def test_run_list_recovers_interrupted_status_before_returning_summary(self):
        pool = explore.create_pool("池", "a\n")
        run = explore.create_run(pool["id"], 1, "base", "neg", algorithm={"artist_count": 1})
        record = explore._load_run(run["id"])
        record["status"] = "running"
        explore._save_run(record)
        coordinator.release("style_explore", run["id"])

        result = explore.recover_interrupted_runs()
        summary = next(item for item in explore.list_runs() if item["id"] == run["id"])

        self.assertEqual(result, {"recovered_count": 1, "run_ids": [run["id"]]})
        self.assertEqual(summary["status"], "paused")
        self.assertIn("服务重启", summary["status_reason"])
        self.assertEqual(explore.recover_interrupted_runs()["recovered_count"], 0)

    def test_copy_candidate_to_library_preserves_exploration_original_and_delete_removes_task(self):
        pool = explore.create_pool("池", "a\n")
        run = explore.create_run(pool["id"], 1, "base", "neg", algorithm={"artist_count": 1})
        self.generate_gate.set()
        explore.start_run(run["id"])
        for _ in range(50):
            current = explore.get_run(run["id"])
            if current["status"] == "generated":
                break
            time.sleep(0.02)
        candidate = current["candidates"][0]
        original = Path(candidate["generation"]["path"])
        copied = explore.copy_candidate_to_library(run["id"], candidate["id"])
        self.assertTrue(original.is_file())
        self.assertTrue((explore.library_service._library_root() / copied["path"]).is_file())
        explore.delete_run(run["id"])
        self.assertFalse(original.parent.parent.exists())

    def test_create_candidate_card_copies_demo_image_to_normal_library(self):
        pool = explore.create_pool("池", "a\n")
        run = explore.create_run(pool["id"], 1, "base", "neg", algorithm={"artist_count": 1})
        self.generate_gate.set()
        explore.start_run(run["id"])
        for _ in range(50):
            current = explore.get_run(run["id"])
            if current["status"] == "generated":
                break
            time.sleep(0.02)
        candidate = current["candidates"][0]

        result = explore.create_candidate_card(run["id"], candidate["id"], "候选卡")

        self.assertEqual(explore.cards_service.get_card("画师串", "候选卡")["content"], candidate["artist_string"])
        self.assertEqual(explore.cards_service.list_cards_images()["画师串:候选卡"], result["image_path"])
        self.assertTrue((explore.library_service._library_root() / result["image_path"]).is_file())
        self.assertTrue(Path(candidate["generation"]["path"]).is_file())

    def test_formal_review_moves_candidates_and_library_actions_stay_in_sync(self):
        pool = explore.create_pool("池", "a\n")
        run = explore.create_run(pool["id"], 1, "base", "neg", algorithm={"artist_count": 1})
        added = explore.add_candidates(
            run["id"],
            [
                {"id": "formal-a", "artist_string": "1.0::a::"},
                {"id": "formal-b", "artist_string": "1.1::a::"},
                {"id": "formal-c", "artist_string": "1.2::a::"},
            ],
        )
        for candidate in added["added"]:
            path = explore._active_dir(run["id"]) / f"{candidate['id']}.png"
            path.write_bytes(b"fake")
            explore.update_candidate(
                run["id"], candidate["id"], {"generation": {"status": "done", "path": str(path)}}
            )

        reviewed = explore.apply_candidate_reviews(
            run["id"],
            [
                {"candidate_id": "formal-a", "tag": "treasure"},
                {"candidate_id": "formal-b", "tag": "special"},
                {"candidate_id": "formal-c", "tag": "reject"},
            ],
        )

        self.assertEqual(len(reviewed["applied"]), 3)
        current = explore.get_run(run["id"])
        by_id = {candidate["id"]: candidate for candidate in current["candidates"]}
        self.assertIn("treasure", Path(by_id["formal-a"]["generation"]["path"]).parts)
        self.assertIn("special", Path(by_id["formal-b"]["generation"]["path"]).parts)
        self.assertIn("reject", Path(by_id["formal-c"]["generation"]["path"]).parts)
        self.assertEqual(current["status"], "completed")
        with self.assertRaisesRegex(ValueError, "Reject"):
            explore.delete_candidate_image(run["id"], "formal-b")

        moved = explore.apply_candidate_reviews(
            run["id"], [{"candidate_id": "formal-a", "tag": "special"}]
        )
        moved_candidate = next(
            item for item in moved["run"]["candidates"] if item["id"] == "formal-a"
        )
        self.assertIn("special", Path(moved_candidate["generation"]["path"]).parts)

        deleted = explore.delete_candidate_image(run["id"], "formal-c")
        self.assertTrue(deleted["ok"])
        removed = next(item for item in explore.get_run(run["id"])["candidates"] if item["id"] == "formal-c")
        self.assertIsNone(removed["generation"]["path"])
        self.assertTrue(removed["generation"]["deleted_at"])

    def test_partial_formal_review_failure_keeps_saved_paths_in_sync(self):
        pool = explore.create_pool("池", "a\n")
        run = explore.create_run(pool["id"], 1, "base", "neg", algorithm={"artist_count": 1})
        added = explore.add_candidates(
            run["id"],
            [
                {"id": "partial-a", "artist_string": "1.0::a::"},
                {"id": "partial-b", "artist_string": "1.1::a::"},
            ],
        )
        for candidate in added["added"]:
            path = explore._active_dir(run["id"]) / f"{candidate['id']}.png"
            path.write_bytes(b"fake")
            explore.update_candidate(
                run["id"], candidate["id"], {"generation": {"status": "done", "path": str(path)}}
            )

        original_move = explore._move_candidate_for_label
        call_count = 0

        def fail_second_move(run_id, candidate, label):
            nonlocal call_count
            call_count += 1
            if call_count == 2:
                raise OSError("simulated move failure")
            return original_move(run_id, candidate, label)

        with mock.patch.object(explore, "_move_candidate_for_label", side_effect=fail_second_move):
            with self.assertRaisesRegex(OSError, "simulated"):
                explore.apply_candidate_reviews(
                    run["id"],
                    [
                        {"candidate_id": "partial-a", "tag": "treasure"},
                        {"candidate_id": "partial-b", "tag": "special"},
                    ],
                )

        current = explore.get_run(run["id"])
        by_id = {candidate["id"]: candidate for candidate in current["candidates"]}
        self.assertEqual(by_id["partial-a"]["review"]["label"], "treasure")
        self.assertIn("treasure", Path(by_id["partial-a"]["generation"]["path"]).parts)
        self.assertTrue(Path(by_id["partial-a"]["generation"]["path"]).is_file())
        self.assertIsNone(by_id["partial-b"]["review"]["label"])
        self.assertIn("active", Path(by_id["partial-b"]["generation"]["path"]).parts)
        self.assertTrue(Path(by_id["partial-b"]["generation"]["path"]).is_file())

    def test_deep_parent_preference_and_round_are_persisted_with_lineage(self):
        pool = explore.create_pool("深度池", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n")
        run = explore.create_run(
            pool["id"],
            2,
            "base",
            "negative",
            {"model": "nai"},
            {"min_artist_count": 2, "random_seed": 7},
        )
        added = explore.add_candidates(
            run["id"],
            [
                {"id": "parent-a", "artist_string": "0.8::a::, 1.0::b::"},
                {"id": "parent-b", "artist_string": "0.7::c::, 1.1::d::"},
            ],
        )
        for candidate in added["added"]:
            path = explore._active_dir(run["id"]) / f"{candidate['id']}.png"
            path.write_bytes(b"fake")
            explore.update_candidate(
                run["id"], candidate["id"], {"generation": {"status": "done", "path": str(path)}}
            )
        explore.apply_candidate_reviews(
            run["id"],
            [
                {"candidate_id": "parent-a", "tag": "treasure"},
                {"candidate_id": "parent-b", "tag": "treasure"},
            ],
        )

        with_parents = explore.set_deep_parent_set(
            run["id"], ["parent-a", "parent-b"], ["0.9::e::, 1.0::f::"]
        )
        parent_set = with_parents["deep"]["parent_sets"][0]
        self.assertEqual(parent_set["status"], "active")
        self.assertEqual(len(parent_set["parents"]), 3)
        self.assertEqual(parent_set["suggested_target_count"], 10)

        preferred = explore.record_deep_preference(
            run["id"],
            parent_set["id"],
            parent_set["parents"][0]["id"],
            parent_set["parents"][1]["id"],
            "left",
        )
        preferred_set = preferred["deep"]["parent_sets"][0]
        self.assertEqual(preferred_set["parents"][0]["preference"], 2.0)
        self.assertEqual(preferred_set["comparisons"][0]["result"], "left")

        deep_run = explore.append_deep_round(
            run["id"],
            10,
            "deep base",
            "deep negative",
            {"model": "nai", "steps": 28},
            {"random_seed": 20260823},
        )
        deep_round = deep_run["rounds"][-1]
        self.assertEqual(deep_round["phase"], "deep")
        self.assertEqual(deep_round["parent_set_id"], parent_set["id"])
        self.assertEqual(deep_round["suggested_next_parent_count"], 4)
        deep_candidates = [
            candidate for candidate in deep_run["candidates"] if candidate.get("round_id") == deep_round["id"]
        ]
        self.assertEqual(len(deep_candidates), 10)
        self.assertTrue(all(candidate["generation"]["status"] == "pending" for candidate in deep_candidates))
        self.assertTrue(all(candidate["lineage"]["operation"] in {"local_mutation", "crossover", "random_injection"} for candidate in deep_candidates))
        self.assertTrue(any(candidate["lineage"]["parent_ids"] for candidate in deep_candidates))
        self.assertEqual(deep_run["status"], "draft")
        self.assertEqual(deep_run["deep"]["parent_sets"][0]["used_round_ids"], [deep_round["id"]])
        with self.assertRaisesRegex(ValueError, "生成候选"):
            explore.record_deep_preference(
                run["id"],
                parent_set["id"],
                parent_set["parents"][0]["id"],
                parent_set["parents"][1]["id"],
                "right",
            )

    def test_deep_candidate_parents_require_treasure_but_custom_strings_may_use_external_ids(self):
        pool = explore.create_pool("深度池", "a\nb\nc\n")
        run = explore.create_run(pool["id"], 1, "base", "negative", algorithm={"min_artist_count": 1})
        added = explore.add_candidates(run["id"], [{"id": "plain", "artist_string": "0.8::a::"}])
        path = explore._active_dir(run["id"]) / "plain.png"
        path.write_bytes(b"fake")
        explore.update_candidate(
            run["id"], added["added"][0]["id"], {"generation": {"status": "done", "path": str(path)}}
        )
        with self.assertRaisesRegex(ValueError, "Treasure"):
            explore.set_deep_parent_set(run["id"], ["plain"], [])
        custom = explore.set_deep_parent_set(run["id"], [], ["0.8::outside::"])
        parent = custom["deep"]["parent_sets"][0]["parents"][0]
        self.assertEqual(parent["source"], "custom")
        self.assertEqual(parent["artist_string"], "0.8::outside::")

    def test_aesthetic_branch_backcrosses_selected_children_with_source_parents(self):
        pool = explore.create_pool("回交池", "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n")
        run = explore.create_run(
            pool["id"], 1, "base", "negative", algorithm={"min_artist_count": 1, "random_seed": 7}
        )
        with_parents = explore.set_deep_parent_set(
            run["id"], [], ["0.8::a::, 1.0::b::", "0.7::c::, 1.1::d::"]
        )
        first_parent_set = with_parents["deep"]["parent_sets"][0]
        self.assertEqual(first_parent_set["generation"], 1)
        preferred = explore.record_deep_preference(
            run["id"],
            first_parent_set["id"],
            first_parent_set["parents"][0]["id"],
            first_parent_set["parents"][1]["id"],
            "left",
        )
        first_parent_set = preferred["deep"]["parent_sets"][0]
        self.assertEqual(first_parent_set["parents"][0]["preference"], 2.0)

        generated = explore.append_deep_round(
            run["id"], 5, "deep", "negative", {"steps": 28}, {"random_seed": 20260824}
        )
        second_generation = generated["rounds"][-1]
        self.assertEqual(second_generation["generation"], 2)
        all_children = [
            item for item in generated["candidates"] if item.get("round_id") == second_generation["id"]
        ]
        children = all_children[:2]
        with self.assertRaisesRegex(ValueError, "生成完成"):
            explore.create_aesthetic_branch(
                run["id"], second_generation["id"], "过早分支", [children[0]["id"]]
            )
        for child in all_children:
            path = explore._active_dir(run["id"]) / f"{child['id']}.png"
            path.write_bytes(b"fake")
            explore.update_candidate(
                run["id"], child["id"], {"generation": {"status": "done", "path": str(path)}}
            )
        explore.apply_candidate_reviews(
            run["id"], [{"candidate_id": children[0]["id"], "tag": "special"}]
        )
        before_branch = {
            item["id"]: (item["review"]["label"], item["generation"]["path"])
            for item in explore.get_run(run["id"])["candidates"]
            if item["id"] in {child["id"] for child in children}
        }

        branched = explore.create_aesthetic_branch(
            run["id"], second_generation["id"], "柔和光影", [item["id"] for item in children]
        )
        next_parent_set = branched["deep"]["parent_sets"][-1]
        self.assertEqual(next_parent_set["generation"], 2)
        self.assertEqual(next_parent_set["branch"]["name"], "柔和光影")
        self.assertEqual(next_parent_set["branch"]["source_round_id"], second_generation["id"])
        self.assertEqual(next_parent_set["branch"]["source_parent_set_id"], first_parent_set["id"])
        self.assertEqual(next_parent_set["branch"]["selected_candidate_ids"], [item["id"] for item in children])
        self.assertEqual(len(next_parent_set["parents"]), len(first_parent_set["parents"]) + len(children))
        self.assertTrue(all(item["preference"] == 1.0 for item in next_parent_set["parents"]))
        next_parent_ids = {item["id"] for item in next_parent_set["parents"]}
        self.assertTrue({item["id"] for item in first_parent_set["parents"]}.issubset(next_parent_ids))
        self.assertTrue({item["id"] for item in children}.issubset(next_parent_ids))
        refreshed_children = {
            item["id"]: item for item in branched["candidates"] if item["id"] in {child["id"] for child in children}
        }
        self.assertEqual(
            {item_id: (item["review"]["label"], item["generation"]["path"]) for item_id, item in refreshed_children.items()},
            before_branch,
        )
        self.assertTrue(all(Path(item["generation"]["path"]).is_file() for item in refreshed_children.values()))

        with self.assertRaisesRegex(ValueError, "已经添加"):
            explore.create_aesthetic_branch(
                run["id"], second_generation["id"], "重复分支", [children[0]["id"]]
            )

        third_generation_run = explore.append_deep_round(
            run["id"], 5, "deep", "negative", {"steps": 28}, {"random_seed": 20260825}
        )
        third_generation = third_generation_run["rounds"][-1]
        self.assertEqual(third_generation["generation"], 3)
        self.assertEqual(third_generation["parent_set_id"], next_parent_set["id"])

        third_children = [
            item for item in third_generation_run["candidates"] if item.get("round_id") == third_generation["id"]
        ]
        for child in third_children:
            path = explore._active_dir(run["id"]) / f"{child['id']}.png"
            path.write_bytes(b"fake")
            explore.update_candidate(
                run["id"], child["id"], {"generation": {"status": "done", "path": str(path)}}
            )
        fourth_parent_run = explore.create_aesthetic_branch(
            run["id"], third_generation["id"], "清透皮肤", [third_children[0]["id"]]
        )
        fourth_parent_set = fourth_parent_run["deep"]["parent_sets"][-1]
        self.assertEqual(fourth_parent_set["generation"], 3)
        self.assertEqual(fourth_parent_set["branch"]["source_parent_set_id"], next_parent_set["id"])
        self.assertTrue(next_parent_ids.issubset({item["id"] for item in fourth_parent_set["parents"]}))

    def test_aesthetic_branch_rejects_historical_round_and_cross_round_children(self):
        pool = explore.create_pool("线性池", "a\nb\nc\nd\ne\nf\n")
        run = explore.create_run(pool["id"], 1, "base", "negative", algorithm={"min_artist_count": 1})
        explore.set_deep_parent_set(run["id"], [], ["0.8::a::", "1.0::b::"])
        first = explore.append_deep_round(
            run["id"], 3, "deep", "negative", algorithm={"random_seed": 101}
        )["rounds"][-1]
        second_run = explore.append_deep_round(
            run["id"], 3, "deep", "negative", algorithm={"random_seed": 102}
        )
        second = second_run["rounds"][-1]
        candidates_by_round = {
            round_id: [item for item in second_run["candidates"] if item.get("round_id") == round_id]
            for round_id in (first["id"], second["id"])
        }
        for candidates in candidates_by_round.values():
            for child in candidates:
                path = explore._active_dir(run["id"]) / f"{child['id']}.png"
                path.write_bytes(b"fake")
                explore.update_candidate(
                    run["id"], child["id"], {"generation": {"status": "done", "path": str(path)}}
                )
        legacy = explore._load_run(run["id"])
        legacy["deep"]["parent_sets"][0].pop("used_round_ids", None)
        legacy["deep"]["parent_sets"][0].pop("generation", None)
        for round_record in legacy["rounds"]:
            round_record.pop("generation", None)
        explore._save_run(legacy)

        with self.assertRaisesRegex(ValueError, "最新一代"):
            explore.create_aesthetic_branch(
                run["id"], first["id"], "历史分支", [candidates_by_round[first["id"]][0]["id"]]
            )
        with self.assertRaisesRegex(ValueError, "当前代"):
            explore.create_aesthetic_branch(
                run["id"], second["id"], "跨轮误选", [candidates_by_round[first["id"]][0]["id"]]
            )


if __name__ == "__main__":
    unittest.main(verbosity=2)
