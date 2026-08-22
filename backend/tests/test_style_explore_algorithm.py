"""画风探索基础候选算法自测（python backend/tests/test_style_explore_algorithm.py）。"""

from __future__ import annotations

import random
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app.style_explore_algorithm import (  # noqa: E402
    ArtistWeight,
    WeightSamplingConfig,
    build_artist_string,
    discretize_weight,
    dispersion_to_beta_shape,
    generate_basic_candidate,
    generate_basic_candidates,
    sample_split_beta_weight,
    sample_weight,
    soft_balance_weights,
)


class StyleExploreAlgorithmTest(unittest.TestCase):
    def test_seeded_candidates_are_reproducible(self):
        config = WeightSamplingConfig()
        pool = ["artist_a", "artist_b", "artist_c", "artist_d"]
        first = generate_basic_candidates(pool, 2, 4, config, random.Random(20260823))
        second = generate_basic_candidates(pool, 2, 4, config, random.Random(20260823))
        self.assertEqual(first, second)

    def test_candidate_is_without_replacement_and_uses_nai_syntax(self):
        candidate = generate_basic_candidate(
            ["a", "b", "c"], 3, WeightSamplingConfig(), random.Random(7)
        )
        ids = [item.artist_id for item in candidate.artist_weights]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual(candidate.artist_string.count("::"), 6)
        self.assertTrue(all(part.endswith("::") for part in candidate.artist_string.split(", ")))

    def test_all_samples_stay_in_range_and_on_tenth_grid(self):
        config = WeightSamplingConfig(
            lower=-2.4, upper=1.7, mode=-0.3, left_dispersion=0.9, right_dispersion=0.8
        )
        rng = random.Random(41)
        values = [sample_weight(config, rng) for _ in range(5000)]
        self.assertTrue(all(config.lower <= value <= config.upper for value in values))
        self.assertTrue(all(abs(value * 10 - round(value * 10)) < 1e-9 for value in values))

    def test_negative_weights_are_not_converted_to_positive(self):
        config = WeightSamplingConfig(lower=-2.0, upper=-0.2, mode=-1.0)
        values = [sample_weight(config, random.Random(seed)) for seed in range(100)]
        self.assertTrue(all(value < 0 for value in values))
        self.assertEqual(discretize_weight(-2.95, -3.0, 3.0), -3.0)

    def test_mode_region_is_more_common_than_far_regions(self):
        config = WeightSamplingConfig(
            lower=0.0, upper=2.0, mode=1.0, left_dispersion=0.25, right_dispersion=0.25
        )
        rng = random.Random(31)
        samples = [sample_weight(config, rng) for _ in range(20000)]
        near_mode = sum(0.8 <= value <= 1.2 for value in samples)
        far_ends = sum(value <= 0.3 or value >= 1.7 for value in samples)
        self.assertGreater(near_mode, far_ends)

    def test_higher_dispersion_produces_more_far_samples_on_that_side(self):
        low = WeightSamplingConfig(
            lower=0.0, upper=2.0, mode=1.0, left_dispersion=0.05, right_dispersion=0.05
        )
        high_left = WeightSamplingConfig(
            lower=0.0, upper=2.0, mode=1.0, left_dispersion=0.95, right_dispersion=0.05
        )
        low_left = self._left_far_rate(low)
        high_left_rate = self._left_far_rate(high_left)
        self.assertGreater(high_left_rate, low_left + 0.12)

    def test_right_dispersion_does_not_change_left_shape(self):
        low_right = WeightSamplingConfig(
            lower=0.0, upper=2.0, mode=1.0, left_dispersion=0.35, right_dispersion=0.05
        )
        high_right = WeightSamplingConfig(
            lower=0.0, upper=2.0, mode=1.0, left_dispersion=0.35, right_dispersion=0.95
        )
        rate_a = self._left_far_rate(low_right)
        rate_b = self._left_far_rate(high_right)
        self.assertLess(abs(rate_a - rate_b), 0.025)

    def test_soft_balance_off_and_zero_strength_are_exactly_equivalent(self):
        disabled = WeightSamplingConfig(soft_balance_strength=0.0)
        rng_a = random.Random(19)
        raw = [sample_split_beta_weight(disabled, rng_a) for _ in range(8)]
        direct = soft_balance_weights(raw, disabled)
        self.assertEqual(raw, direct)
        rng_a, rng_b = random.Random(53), random.Random(53)
        self.assertEqual(
            [sample_weight(disabled, rng_a) for _ in range(8)],
            [sample_weight(disabled, rng_b) for _ in range(8)],
        )

    def test_soft_balance_pulls_combination_mean_toward_mode(self):
        config = WeightSamplingConfig(lower=0.0, upper=2.0, mode=0.8, soft_balance_strength=0.5)
        raw = [1.7, 1.8, 1.9]
        balanced = soft_balance_weights(raw, config)
        self.assertLess(abs(sum(balanced) / len(balanced) - config.mode), abs(sum(raw) / len(raw) - config.mode))
        self.assertTrue(all(config.lower <= value <= config.upper for value in balanced))

    def test_boundaries_and_invalid_parameters(self):
        self.assertEqual(sample_weight(WeightSamplingConfig(lower=1.0, upper=1.0, mode=1.0)), 1.0)
        with self.assertRaisesRegex(ValueError, "众数"):
            sample_weight(WeightSamplingConfig(lower=0.1, upper=1.0, mode=1.1))
        with self.assertRaisesRegex(ValueError, "0.1"):
            sample_weight(WeightSamplingConfig(lower=0.15, upper=1.0, mode=0.8))
        with self.assertRaisesRegex(ValueError, "重复"):
            generate_basic_candidate(["a", "a"], 1, WeightSamplingConfig())
        with self.assertRaisesRegex(ValueError, "不能为空"):
            build_artist_string([ArtistWeight("", 1.0)])

    def test_dispersion_mapping_is_monotonic(self):
        _, concentrated_beta = dispersion_to_beta_shape(0.0)
        _, spread_beta = dispersion_to_beta_shape(1.0)
        self.assertGreater(concentrated_beta, spread_beta)

    @staticmethod
    def _left_far_rate(config: WeightSamplingConfig) -> float:
        rng = random.Random(901)
        samples = [sample_split_beta_weight(config, rng) for _ in range(30000)]
        left = [value for value in samples if value < config.mode]
        return sum(value <= config.mode - 0.6 for value in left) / len(left)


if __name__ == "__main__":
    unittest.main(verbosity=2)
