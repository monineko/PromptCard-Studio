import json
import tempfile
import unittest
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import config


class ConfigTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.config_file = Path(self.temp.name) / "config.json"
        self.original_config_file = config.CONFIG_FILE
        config.CONFIG_FILE = self.config_file

    def tearDown(self):
        config.CONFIG_FILE = self.original_config_file
        self.temp.cleanup()

    def test_style_explore_max_artist_count_defaults_and_is_clamped(self):
        self.assertEqual(config.load_settings()["style_explore_max_artist_count"], 10)

        self.config_file.write_text(
            json.dumps({"style_explore_max_artist_count": 99}),
            encoding="utf-8",
        )
        self.assertEqual(config.load_settings()["style_explore_max_artist_count"], 30)

        saved = config.save_settings({"style_explore_max_artist_count": 3})
        self.assertEqual(saved["style_explore_max_artist_count"], 5)
        self.assertEqual(json.loads(self.config_file.read_text(encoding="utf-8"))["style_explore_max_artist_count"], 5)

    def test_library_drag_import_enabled_by_default(self):
        self.assertTrue(config.load_settings()["library_drag_import_enabled"])

    def test_legacy_hide_backend_panel_setting_is_ignored_and_removed_on_save(self):
        self.assertNotIn("hide_backend_panel", config.DEFAULT_SETTINGS)

        self.config_file.write_text(
            json.dumps({"hide_backend_panel": True, "library_drag_import_enabled": False}),
            encoding="utf-8",
        )
        loaded = config.load_settings()
        self.assertNotIn("hide_backend_panel", loaded)
        self.assertFalse(loaded["library_drag_import_enabled"])

        saved = config.save_settings({})
        persisted = json.loads(self.config_file.read_text(encoding="utf-8"))
        self.assertNotIn("hide_backend_panel", saved)
        self.assertNotIn("hide_backend_panel", persisted)

    def test_theme_defaults_and_ranges_include_background_blur(self):
        self.assertEqual(config.load_settings()["theme"]["background_blur"], 30)
        self.assertEqual(config.load_settings()["theme"]["glass"], 0.3)
        self.assertEqual(config.load_settings()["theme"]["accent"], "#5a78fa")

        self.config_file.write_text(
            json.dumps({"theme": {"glass": 0}}),
            encoding="utf-8",
        )
        migrated = config.load_settings()
        self.assertEqual(migrated["theme"]["background_blur"], 30)
        self.assertEqual(migrated["theme"]["glass"], 0)

        saved = config.save_settings({"theme": {"background_blur": 135}})
        self.assertEqual(saved["theme"]["background_blur"], 100)
        saved = config.save_settings({"theme": {"background_blur": -10}})
        self.assertEqual(saved["theme"]["background_blur"], 0)
        saved = config.save_settings({"theme": {"glass": 2}})
        self.assertEqual(saved["theme"]["glass"], 1)
