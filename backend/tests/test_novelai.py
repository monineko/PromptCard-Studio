"""NovelAI 文生图请求体回归测试。"""

import sys
import unittest
from pathlib import Path


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


if __name__ == "__main__":
    unittest.main()
