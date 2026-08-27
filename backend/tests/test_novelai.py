"""NovelAI 文生图请求体回归测试。"""

import sys
import unittest
from pathlib import Path
from unittest import mock


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import novelai  # noqa: E402


class NovelAiPayloadTest(unittest.TestCase):
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
                self.assertEqual(
                    request_params["v4_prompt"]["caption"]["char_captions"][0]["char_caption"],
                    "1girl, blue hair",
                )
                self.assertEqual(request_params["v4_negative_prompt"]["caption"]["base_caption"], "bad quality")

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
