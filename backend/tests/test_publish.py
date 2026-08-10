"""M3 发布处理后端自测（可独立运行：python backend/tests/test_publish.py）。

覆盖：PNG 元数据提取/抹除/回写、批量重命名、引擎命令行构造、
完整流水线（超分+恢复+重命名 / 仅抹除）、节点约束校验、保存到图库与清理。
使用临时目录与假引擎，不触碰真实用户数据、不联网。
"""

import io
import base64
import json
import shutil
import sys
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
import urllib.parse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import config as app_config  # noqa: E402
from app import library as lib  # noqa: E402
from app import publish as pub  # noqa: E402
from PIL import Image  # noqa: E402

MOCK_ENGINE = Path(__file__).resolve().parent / "fixtures" / "mock_engine.py"


def make_png_with_meta() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 100, 50)).save(buf, format="PNG")
    chunks = list(pub._iter_chunks(buf.getvalue()))
    return pub._rebuild(
        chunks, insert_before_idat={b"tEXt": [b"Comment\x00{\"prompt\":\"1girl\",\"seed\":777}"]}
    )


class PngMetaTest(unittest.TestCase):
    def test_extract_wipe_apply(self):
        tmp = Path(tempfile.mkdtemp(prefix="npm_pub_png_"))
        src = tmp / "a.png"
        src.write_bytes(make_png_with_meta())

        meta = pub.extract_png_metadata(src)
        self.assertIn("tEXt", meta)

        wiped = tmp / "b.png"
        wiped.write_bytes(make_png_with_meta())
        pub.wipe_png_metadata(wiped)
        types = [c.decode() for c, _, _ in pub._iter_chunks(wiped.read_bytes())]
        self.assertNotIn("tEXt", types)

        pub.apply_png_metadata(wiped, meta)
        types = [c.decode() for c, _, _ in pub._iter_chunks(wiped.read_bytes())]
        self.assertIn("tEXt", types)
        raw = base64.b64decode(pub.extract_png_metadata(wiped)["tEXt"][0])
        self.assertIn(b'"seed":777', raw)


class RenameTest(unittest.TestCase):
    def test_order_and_custom(self):
        today = __import__("datetime").date(2026, 8, 11)
        self.assertEqual(
            pub.build_rename_name({"parts": ["date", "random"]}, today, "482913"),
            "20260811_482913",
        )
        self.assertEqual(
            pub.build_rename_name({"parts": ["date", "custom", "random"], "custom": "moni"}, today, "482913"),
            "20260811_moni_482913",
        )
        self.assertEqual(
            pub.build_rename_name({"parts": ["custom", "random", "date"], "custom": "佐藤"}, today, "482913"),
            "佐藤_482913_20260811",
        )

    def test_samples(self):
        samples = pub.rename_samples({"parts": ["date", "custom", "random"], "custom": "moni"})
        self.assertEqual(len(samples), 3)
        self.assertTrue(all(s.startswith("20260811_moni_") for s in samples))


class EngineArgsTest(unittest.TestCase):
    def test_args_with_and_without_models(self):
        tmp = Path(tempfile.mkdtemp(prefix="npm_pub_eng_"))
        exe = tmp / "engine" / "realesrgan-ncnn-vulkan.exe"
        exe.parent.mkdir()
        params = {"model": "realesr-animevideov3", "scale": 4, "tile": 0, "gpu": 0, "format": "png", "tta": True}
        args = pub.build_engine_args(exe, params, tmp / "in.png", tmp / "out.png")
        self.assertNotIn("-m", args)
        self.assertIn("-x", args)
        (exe.parent / "models").mkdir()
        args = pub.build_engine_args(exe, params, tmp / "in.png", tmp / "out.png")
        self.assertIn("-m", args)
        self.assertEqual(args[1], str(exe.parent / "models"))


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="npm_pub_run_"))
        cls.library = cls.tmp / "library"
        cat = cls.library / "Treasure" / "Treasure-2026-08-11"
        cat.mkdir(parents=True)
        (cat / "novelai_777.png").write_bytes(make_png_with_meta())
        lib.load_settings = lambda: {"library_path": str(cls.library)}  # type: ignore[method-assign]
        pub._engine_binary = lambda: MOCK_ENGINE  # type: ignore[method-assign]

    def _wait(self, run_id: str) -> dict:
        for _ in range(100):
            state = pub.run_status(run_id)
            if state["status"] != "running":
                return state
            time.sleep(0.1)
        self.fail("任务超时")

    def test_upscale_restore_rename(self):
        res = pub.start_run(
            ["Treasure/Treasure-2026-08-11/novelai_777.png"],
            {"upscale": True, "restore": True, "wipe": False, "rename": True},
            {"parts": ["date", "custom", "random"], "custom": "moni"},
            {"model": "realesr-animevideov3", "scale": 4, "tile": 0, "gpu": 0, "format": "png", "tta": False},
        )
        state = self._wait(res["id"])
        self.assertEqual(state["status"], "completed")
        f = state["files"][0]
        self.assertEqual(f["status"], "done")
        out = pub._run_dir(res["id"]) / "output" / f["output"]
        types = [c.decode() for c, _, _ in pub._iter_chunks(out.read_bytes())]
        self.assertIn("tEXt", types)  # 恢复原数据生效
        self.assertTrue(f["output"].startswith("20260811_moni_"))
        pub.delete_run(res["id"])

    def test_wipe_only_neutral_name(self):
        res = pub.start_run(
            ["Treasure/Treasure-2026-08-11/novelai_777.png"],
            {"upscale": False, "restore": False, "wipe": True, "rename": False},
            {},
            {},
        )
        state = self._wait(res["id"])
        f = state["files"][0]
        out = pub._run_dir(res["id"]) / "output" / f["output"]
        types = [c.decode() for c, _, _ in pub._iter_chunks(out.read_bytes())]
        self.assertNotIn("tEXt", types)
        self.assertEqual(len(Path(f["output"]).stem), 8)  # 随机中性名
        pub.delete_run(res["id"])

    def test_node_validation(self):
        with self.assertRaises(ValueError):
            pub._validate_nodes({"upscale": False, "restore": True, "wipe": False, "rename": False})
        with self.assertRaises(ValueError):
            pub._validate_nodes({"upscale": True, "restore": True, "wipe": True, "rename": False})
        with self.assertRaises(ValueError):
            pub._validate_nodes({"upscale": False, "restore": False, "wipe": False, "rename": False})

    def test_save_to_library(self):
        res = pub.start_run(
            ["Treasure/Treasure-2026-08-11/novelai_777.png"],
            {"upscale": False, "restore": False, "wipe": True, "rename": True},
            {"parts": ["date", "random"]},
            {},
        )
        state = self._wait(res["id"])
        app_config.LIBRARY_DIR = self.library  # type: ignore[attr-defined]
        saved = pub.save_outputs_to_library(res["id"])
        self.assertEqual(len(saved["saved"]), 1)
        self.assertTrue((self.library / saved["saved"][0]["path"]).exists())
        self.assertIsNotNone(state["files"][0]["output"])
        pub.delete_run(res["id"])


class PublishHttpSmokeTest(unittest.TestCase):
    """真实 HTTP 层冒烟：临时 uvicorn + 假引擎，走一遍发布处理完整接口。"""

    PORT = 11552

    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="npm_pub_http_"))
        cls.library = cls.tmp / "library"
        cat = cls.library / "Treasure" / "Treasure-2026-08-11"
        cat.mkdir(parents=True)
        (cat / "web_777.png").write_bytes(make_png_with_meta())

        import uvicorn

        from app import config as cfg
        from app import library as lib_module
        from app.main import app

        lib_module.load_settings = lambda: {"library_path": str(cls.library)}  # type: ignore[method-assign]
        cfg.LIBRARY_DIR = cls.library  # type: ignore[attr-defined]
        pub._engine_binary = lambda: MOCK_ENGINE  # type: ignore[method-assign]

        config = uvicorn.Config(app, host="127.0.0.1", port=cls.PORT, log_level="warning")
        cls.server = uvicorn.Server(config)
        cls.thread = threading.Thread(target=cls.server.run, daemon=True)
        cls.thread.start()
        for _ in range(50):
            if cls.server.started:
                break
            time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        cls.server.should_exit = True
        cls.thread.join(timeout=5)
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _post(self, path: str, body: dict):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.PORT}{path}",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def _get(self, path: str):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.PORT}{path}") as resp:
            return resp.read()

    def test_publish_flow(self):
        engine = json.loads(self._get("/api/publish/engine"))
        self.assertTrue(engine["installed"])
        self.assertEqual(engine["manifest"]["id"], "realesrgan-ncnn-vulkan")

        preview = self._post("/api/publish/rename-preview", {"rename": {"parts": ["date", "custom", "random"], "custom": "moni"}})
        self.assertTrue(preview["samples"][0].startswith("20260811_moni_"))

        started = self._post(
            "/api/publish/run",
            {
                "paths": ["Treasure/Treasure-2026-08-11/web_777.png"],
                "nodes": {"upscale": True, "restore": True, "wipe": False, "rename": True},
                "rename": {"parts": ["date", "custom", "random"], "custom": "moni"},
                "engine_params": {"model": "realesr-animevideov3", "scale": 4, "tile": 0, "gpu": 0, "format": "png", "tta": False},
            },
        )
        run_id = started["id"]
        state = None
        for _ in range(100):
            state = json.loads(self._get(f"/api/publish/run/{run_id}"))
            if state["status"] != "running":
                break
            time.sleep(0.1)
        self.assertEqual(state["status"], "completed")
        output = state["files"][0]["output"]
        self.assertTrue(output.startswith("20260811_moni_"))

        image = self._get(f"/api/publish/run/{run_id}/file?name={urllib.parse.quote(output)}")
        self.assertTrue(image.startswith(b"\x89PNG"))

        saved = self._post(f"/api/publish/run/{run_id}/save-to-library", {})
        self.assertEqual(len(saved["saved"]), 1)
        self.assertTrue((self.library / saved["saved"][0]["path"]).exists())

        req = urllib.request.Request(
            f"http://127.0.0.1:{self.PORT}/api/publish/run/{run_id}",
            method="DELETE",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
        with self.assertRaises(urllib.error.HTTPError):
            self._get(f"/api/publish/run/{run_id}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
