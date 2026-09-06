import sys
import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import generation_coordinator  # noqa: E402


class GenerationCoordinatorTest(unittest.TestCase):
    def tearDown(self):
        reservation = generation_coordinator.status().get("reservation")
        if reservation:
            generation_coordinator.release(reservation["owner"], reservation["task_id"])

    def test_unavailable_check_does_not_leave_reservation(self):
        with self.assertRaisesRegex(ValueError, "普通批量生成"):
            generation_coordinator.acquire(
                "single",
                "request-1",
                lambda: "普通批量生成正在占用生成通道",
            )
        self.assertFalse(generation_coordinator.status()["occupied"])

    def test_transient_reservation_blocks_other_generation(self):
        generation_coordinator.acquire("single", "request-1")
        with self.assertRaisesRegex(ValueError, "request-1"):
            generation_coordinator.acquire("batch_start", "request-2")


if __name__ == "__main__":
    unittest.main()
