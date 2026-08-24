"""共享生图节流策略自测。"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import batch, generation_timing, style_explore  # noqa: E402


class GenerationTimingTest(unittest.TestCase):
    def test_batch_and_style_exploration_share_the_same_intervals(self):
        self.assertEqual(batch.COOL_MIN, generation_timing.COOL_MIN)
        self.assertEqual(batch.COOL_MAX, generation_timing.COOL_MAX)
        self.assertEqual(style_explore.COOL_MIN, generation_timing.COOL_MIN)
        self.assertEqual(style_explore.COOL_MAX, generation_timing.COOL_MAX)
        self.assertEqual(style_explore.RETRY_WAIT_MIN, generation_timing.RETRY_WAIT_MIN)
        self.assertEqual(style_explore.RETRY_WAIT_MAX, generation_timing.RETRY_WAIT_MAX)

    def test_cool_down_can_stop_before_waiting(self):
        with mock.patch("app.generation_timing.random.uniform", return_value=4.0), mock.patch(
            "app.generation_timing.time.sleep"
        ) as sleep:
            self.assertFalse(generation_timing.cool_down(4.0, 6.0, lambda: True))
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main(verbosity=2)
