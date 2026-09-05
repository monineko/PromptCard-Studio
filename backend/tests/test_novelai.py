"""NovelAI 文生图请求体回归测试。"""

import sys
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import novelai, png_send  # noqa: E402


class NovelAiPayloadTest(unittest.TestCase):
    def test_resolution_rounds_to_nearest_multiple_of_64(self):
        self.assertEqual(novelai.return_x64(831), 832)
        self.assertEqual(novelai.return_x64(850), 832)
        self.assertEqual(novelai.return_x64(865), 896)
        self.assertEqual(novelai.return_x64(1), 64)

    def test_v5_options_match_current_official_controls(self):
        rules = novelai.MODEL_RULES["nai-diffusion-5-full"]

        self.assertEqual(
            rules["samplers"],
            [
                "k_euler_ancestral",
                "k_euler",
                "k_dpmpp_2s_ancestral",
                "k_dpmpp_2m_sde",
                "k_dpmpp_2m",
                "k_dpmpp_sde",
            ],
        )
        self.assertEqual(rules["noise_schedules"], ["karras"])
        self.assertEqual(rules["uc_presets"], ["Heavy", "Light", "Furry Focus", "Human Focus", "None"])
        self.assertEqual(rules["quality_presets"], ["standard", "light", "none"])

    def test_v5_keeps_character_condition_payload(self):
        for model in ("nai-diffusion-5-full", "nai-diffusion-5-curated"):
            with self.subTest(model=model):
                params = novelai.GenerationParams(
                    {
                        "model": model,
                        "characters": [
                            {
                                "positive": "1girl, blue hair",
                                "negative": "",
                                "center": {"x": 0.5, "y": 0.5},
                            }
                        ],
                    }
                )

                payload = novelai.build_text2image_payload(params, "on a bed", "bad quality")
                request_params = payload["parameters"]

                self.assertEqual(request_params["characterPrompts"][0]["prompt"], "1girl, blue hair")
                self.assertEqual(request_params["params_version"], 4)
                self.assertEqual(request_params["noise_schedule"], "karras")
                self.assertEqual(request_params["ucPresetId"], "heavy")
                self.assertEqual(request_params["qualityPresetId"], "standard")
                self.assertEqual(
                    request_params["v4_prompt"]["caption"]["char_captions"][0]["char_caption"],
                    "1girl, blue hair",
                )
                self.assertTrue(
                    request_params["v4_negative_prompt"]["caption"]["base_caption"].endswith("bad quality")
                )

    def test_v5_uses_current_quality_and_uc_presets(self):
        params = novelai.GenerationParams(
            {
                "model": "nai-diffusion-5-full",
                "quality_preset": "light",
                "uc_preset": "Human Focus",
                "noise_schedule": "exponential",
            }
        )

        payload = novelai.build_text2image_payload(params, "1girl", "extra fingers")
        request_params = payload["parameters"]

        self.assertEqual(request_params["noise_schedule"], "karras")
        self.assertEqual(request_params["qualityPresetId"], "light")
        self.assertTrue(payload["input"].endswith("very aesthetic, amazing quality, no text"))
        self.assertEqual(request_params["ucPresetId"], "humanFocus")
        self.assertTrue(request_params["negative_prompt"].endswith("extra fingers"))

    def test_legacy_quality_toggle_is_migrated(self):
        params = novelai.GenerationParams(
            {"model": "nai-diffusion-5-full", "quality_toggle": False}
        )

        payload = novelai.build_text2image_payload(params, "1girl", "")

        self.assertEqual(payload["input"], "1girl")
        self.assertEqual(payload["parameters"]["qualityPresetId"], "none")

    def test_v5_light_quality_round_trips_from_png_metadata(self):
        restored = png_send.build_send_payload(
            {
                "prompt": "1girl, very aesthetic, amazing quality, no text",
                "negative_prompt": "",
            },
            "nai-diffusion-5-full",
        )

        self.assertEqual(restored["positive"], "1girl")
        self.assertEqual(restored["params"]["quality_preset"], "light")

    def test_generation_http_error_is_logged_with_raw_response(self):
        body = b'{"message":"request rejected","statusCode":432}'
        with mock.patch.object(novelai, "_request_json", return_value=(432, body)), mock.patch.object(
            novelai.terminal_log, "log"
        ) as write_log:
            with self.assertRaisesRegex(RuntimeError, "HTTP 432"):
                novelai.generate_image("token", {})

        write_log.assert_called_once_with(
            "NAI",
            'HTTP 432 · {"message":"request rejected","statusCode":432}',
        )


if __name__ == "__main__":
    unittest.main()
