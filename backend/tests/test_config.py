import json
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import config


def test_style_explore_max_artist_count_defaults_and_is_clamped(tmp_path, monkeypatch):
    config_file = tmp_path / "config.json"
    monkeypatch.setattr(config, "CONFIG_FILE", config_file)

    assert config.load_settings()["style_explore_max_artist_count"] == 10

    config_file.write_text(
        json.dumps({"style_explore_max_artist_count": 99}),
        encoding="utf-8",
    )
    assert config.load_settings()["style_explore_max_artist_count"] == 30

    saved = config.save_settings({"style_explore_max_artist_count": 3})
    assert saved["style_explore_max_artist_count"] == 10
    assert json.loads(config_file.read_text(encoding="utf-8"))["style_explore_max_artist_count"] == 10
