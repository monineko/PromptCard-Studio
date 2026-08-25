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
        self.assertEqual(saved["style_explore_max_artist_count"], 10)
        self.assertEqual(json.loads(self.config_file.read_text(encoding="utf-8"))["style_explore_max_artist_count"], 10)

    def test_library_drag_import_enabled_by_default(self):
        self.assertTrue(config.load_settings()["library_drag_import_enabled"])
