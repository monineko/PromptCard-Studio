"""M3 发布处理后端自测（可独立运行：python backend/tests/test_publish.py）。

覆盖：PNG 元数据提取/抹除/回写、批量重命名、暂存区（添加/列表/删除/清空）、
引擎清单识别与命令行构造、完整流水线（超分+恢复+重命名 / 仅抹除 / 自动打码）、
节点约束校验、输出目录命名与保留、真实 HTTP 冒烟。
使用临时目录与假引擎，不触碰真实用户数据、不联网。
"""

import base64
import datetime
import functools
import http.server
import io
import json
import shutil
import socket
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest import mock
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "backend"))

from app import config as app_config  # noqa: E402
from app import library as lib  # noqa: E402
from app import plugins as plugin_service  # noqa: E402
from app import publish as pub  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

MOCK_ENGINE = Path(__file__).resolve().parent / "fixtures" / "mock_engine.py"


def make_png_with_meta() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (200, 100, 50)).save(buf, format="PNG")
    chunks = list(pub._iter_chunks(buf.getvalue()))
    return pub._rebuild(
        chunks, insert_before_idat={b"tEXt": [b"Comment\x00{\"prompt\":\"1girl\",\"seed\":777}"]}
    )


def fake_mosaic(input_path, out_path, params):
    """测试用假打码：在左上角画一个红块并保存，模拟插件输出。"""
    img = Image.open(input_path).convert("RGB")
    ImageDraw.Draw(img).rectangle([0, 0, 5, 5], fill=(255, 0, 0))
    img.save(out_path)
    return {"path": str(out_path), "detected": 1, "skipped": False, "message": "已检测并打码 1 处"}


def set_up_temp_environment(cls) -> Path:
    """把图库/暂存区/输出目录全部指到临时目录，避免触碰真实用户数据。"""
    tmp = Path(tempfile.mkdtemp(prefix="npm_pub_"))
    cls.tmp = tmp
    cls.library = tmp / "library"
    cat = cls.library / "Treasure" / "Treasure-2026-08-11"
    cat.mkdir(parents=True)
    (cat / "novelai_777.png").write_bytes(make_png_with_meta())
    (cat / "second_888.png").write_bytes(make_png_with_meta())
    lib.load_settings = lambda: {"library_path": str(cls.library)}  # type: ignore[method-assign]
    pub.STAGING_DIR = tmp / "staging"
    pub.STAGING_INDEX = pub.STAGING_DIR / "items.json"
    pub.OUTPUTS_DIR = tmp / "outputs"
    pub.PUBLISH_DIR = tmp / "runs"
    # 插件目录重定向到临时目录，避免测试受真实插件安装状态影响
    plugin_service.PLUGINS_DIR = tmp / "plugins"
    return tmp


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

    def test_wipe_jpeg_exif(self):
        tmp = Path(tempfile.mkdtemp(prefix="npm_pub_jpeg_"))
        src = tmp / "a.jpg"
        img = Image.new("RGB", (32, 32), (10, 200, 90))
        exif = Image.Exif()
        exif[0x010F] = "TestCam"
        img.save(src, "JPEG", exif=exif.tobytes())
        self.assertIn("APP1(EXIF/XMP)", pub._metadata_chunk_types(src))

        pub._wipe_jpeg_metadata(src)
        self.assertEqual(pub._metadata_chunk_types(src), [])
        with Image.open(src) as im:
            self.assertEqual(im.size, (32, 32))

    def test_wipe_overwrite_null(self):
        tmp = Path(tempfile.mkdtemp(prefix="npm_pub_null_"))
        src = tmp / "a.png"
        src.write_bytes(make_png_with_meta())
        pub.wipe_png_metadata(src, overwrite_null=True)
        types = [c.decode() for c, _, _ in pub._iter_chunks(src.read_bytes())]
        self.assertNotIn("eXIf", types)
        self.assertEqual(types.count("tEXt"), 1)  # 仅保留一个 null 占位
        meta = pub.extract_png_metadata(src)
        raw = base64.b64decode(meta["tEXt"][0])
        self.assertIn(b'"prompt": null', raw)
        self.assertNotIn(b'"1girl"', raw)


class DownloaderTest(unittest.TestCase):
    """本地 HTTP 服务器验证断点续传下载逻辑（不联网）。"""

    @classmethod
    def setUpClass(cls):
        cls.payload = bytes(range(256)) * 512  # 128 KB

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                body = cls.payload
                rng = self.headers.get("Range")
                if rng and rng.startswith("bytes="):
                    start = int(rng.split("=")[1].split("-")[0])
                    chunk = body[start:]
                    self.send_response(206)
                    self.send_header("Content-Length", str(len(chunk)))
                    self.send_header("Content-Range", f"bytes {start}-{len(body)-1}/{len(body)}")
                    self.end_headers()
                    self.wfile.write(chunk)
                else:
                    self.send_response(200)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)

            def log_message(self, *args):
                pass

        cls.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        cls.server.payload = cls.payload
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.thread.join(timeout=5)

    def _url(self) -> str:
        return f"http://127.0.0.1:{self.port}/engine.zip"

    def test_full_download(self):
        tmp = Path(tempfile.mkdtemp(prefix="npm_pub_dl_"))
        dest = tmp / "engine.zip"
        progress = []
        pub._http_download(self._url(), dest, len(self.payload), lambda d, t: progress.append((d, t)))
        self.assertEqual(dest.read_bytes(), self.payload)
        self.assertTrue(progress)

    def test_resume_download(self):
        tmp = Path(tempfile.mkdtemp(prefix="npm_pub_dl_"))
        dest = tmp / "engine.zip"
        half = len(self.payload) // 2
        dest.write_bytes(self.payload[:half])
        pub._http_download(self._url(), dest, len(self.payload), lambda d, t: None)
        self.assertEqual(dest.read_bytes(), self.payload)


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
        prefix = datetime.date.today().strftime("%Y%m%d")
        samples = pub.rename_samples({"parts": ["date", "custom", "random"], "custom": "moni"})
        self.assertEqual(len(samples), 3)
        self.assertTrue(all(s.startswith(f"{prefix}_moni_") for s in samples))


class EngineTest(unittest.TestCase):
    def test_manifest_detection_and_args(self):
        w2x = Path(r"E:\NAI\插件\caffe超分插件\waifu2x-caffe\waifu2x-caffe.exe")
        m = pub._manifest_for_binary(w2x)
        self.assertEqual(m["id"], "waifu2x-caffe")
        args = pub.build_engine_args(
            m, w2x,
            {"mode": "noise_scale", "noise_level": 2, "scale_ratio": 2, "process": "cpu",
             "crop_size": 128, "batch_size": 8, "tta": True},
            Path(r"C:\in.png"), Path(r"C:\out.png"),
        )
        self.assertIn("-m", args)
        self.assertIn("noise_scale", args)
        self.assertEqual(args[-2:], ["-t", "1"])

        re = Path(r"C:\fake\realesrgan-ncnn-vulkan.exe")
        m2 = pub._manifest_for_binary(re)
        self.assertEqual(m2["id"], "realesrgan-ncnn-vulkan")
        args2 = pub.build_engine_args(
            m2, re,
            {"model": "realesr-animevideov3", "scale": 4, "tile": 0, "gpu": 0, "format": "png", "tta": True},
            Path(r"C:\in.png"), Path(r"C:\out.png"),
        )
        self.assertIn("-x", args2)
        self.assertNotIn("-m", args2)  # 无 models 目录时跳过


class StagingTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        set_up_temp_environment(cls)

    def test_stage_list_remove_clear(self):
        res = pub.stage_images(["Treasure/Treasure-2026-08-11/novelai_777.png"])
        self.assertEqual(res["added"], 1)
        self.assertEqual(res["count"], 1)
        # 硬链接生效：与原图共享 inode
        staged = pub.STAGING_DIR / "novelai_777.png"
        self.assertTrue(staged.exists())
        self.assertGreaterEqual(staged.stat().st_nlink, 2)

        listing = pub.list_staging()
        self.assertEqual(listing["count"], 1)
        self.assertEqual(listing["items"][0]["name"], "novelai_777.png")

        # 同名二次加入自动加后缀
        res2 = pub.stage_images(["Treasure/Treasure-2026-08-11/novelai_777.png"])
        self.assertEqual(res2["added"], 1)
        self.assertTrue((pub.STAGING_DIR / "novelai_777 (1).png").exists())

        removed = pub.remove_staged("novelai_777.png")
        self.assertEqual(removed["count"], 1)
        self.assertFalse((pub.STAGING_DIR / "novelai_777.png").exists())
        self.assertTrue((pub.STAGING_DIR / "novelai_777 (1).png").exists())

        cleared = pub.clear_staging()
        self.assertEqual(cleared["removed"], 1)
        self.assertEqual(pub.list_staging()["count"], 0)


class PipelineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        set_up_temp_environment(cls)
        pub._engine_binary = lambda: MOCK_ENGINE  # type: ignore[method-assign]
        cls.staged = pub.stage_images(
            ["Treasure/Treasure-2026-08-11/novelai_777.png"]
        )

    def _wait(self, run_id: str) -> dict:
        for _ in range(100):
            state = pub.run_status(run_id)
            if state["status"] != "running":
                return state
            time.sleep(0.1)
        self.fail("任务超时")

    def test_upscale_restore_rename_output_dir(self):
        res = pub.start_run(
            ["novelai_777.png"],
            {"upscale": True, "restore": True, "wipe": False, "rename": True},
            {"parts": ["date", "custom", "random"], "custom": "moni"},
            {"model": "realesr-animevideov3", "scale": 4, "tile": 0, "gpu": 0, "format": "png", "tta": False},
        )
        state = self._wait(res["id"])
        self.assertEqual(state["status"], "completed")
        f = state["files"][0]
        self.assertEqual(f["status"], "done")
        out = Path(state["output_dir"]) / f["output"]
        types = [c.decode() for c, _, _ in pub._iter_chunks(out.read_bytes())]
        self.assertIn("tEXt", types)  # 恢复原数据生效
        prefix = datetime.date.today().strftime("%Y%m%d")
        self.assertTrue(f["output"].startswith(f"{prefix}_moni_"))
        # 输出目录命名：时间戳-随机，且在 outputs/ 下；清理运行后输出仍保留
        self.assertEqual(Path(state["output_dir"]).parent, pub.OUTPUTS_DIR)
        folder_name = Path(state["output_dir"]).name
        self.assertRegex(folder_name, r"^\d{8}-\d{6}-[0-9a-f]{4}$")
        pub.delete_run(res["id"])
        self.assertTrue(Path(state["output_dir"]).exists())

    def test_wipe_only_neutral_name(self):
        res = pub.start_run(
            ["novelai_777.png"],
            {"upscale": False, "restore": False, "wipe": True, "rename": False},
            {},
            {},
        )
        state = self._wait(res["id"])
        f = state["files"][0]
        out = Path(state["output_dir"]) / f["output"]
        types = [c.decode() for c, _, _ in pub._iter_chunks(out.read_bytes())]
        # 抹除 = null 覆写：仅保留一条全 null 的 Comment 占位（NovelAI 官网读取为空）
        self.assertEqual(types.count("tEXt"), 1)
        meta = pub.extract_png_metadata(out)
        raw = base64.b64decode(meta["tEXt"][0])
        self.assertIn(b'"prompt": null', raw)
        self.assertNotIn(b'"1girl"', raw)
        self.assertEqual(len(Path(f["output"]).stem), 8)  # 随机中性名
        # 原图与暂存区不受影响（元数据仍在）
        original = self.library / "Treasure" / "Treasure-2026-08-11" / "novelai_777.png"
        self.assertIn("tEXt", pub.extract_png_metadata(original))
        pub.delete_run(res["id"])

    def test_node_validation(self):
        with self.assertRaises(ValueError):
            pub._validate_nodes({"upscale": False, "restore": True, "wipe": False, "rename": False})
        with self.assertRaises(ValueError):
            pub._validate_nodes({"upscale": True, "restore": True, "wipe": True, "rename": False})
        with self.assertRaises(ValueError):
            pub._validate_nodes({"upscale": False, "restore": False, "wipe": False, "rename": False})


class MosaicNodeTest(unittest.TestCase):
    """自动打码插件节点：启用校验、流水线顺序（超分→打码→恢复→抹除→重命名）。"""

    @classmethod
    def setUpClass(cls):
        set_up_temp_environment(cls)
        pub._engine_binary = lambda: MOCK_ENGINE  # type: ignore[method-assign]
        cls.staged = pub.stage_images(["Treasure/Treasure-2026-08-11/novelai_777.png"])

    def _wait(self, run_id: str) -> dict:
        for _ in range(100):
            state = pub.run_status(run_id)
            if state["status"] != "running":
                return state
            time.sleep(0.1)
        self.fail("任务超时")

    def test_mosaic_requires_enabled_plugin(self):
        # 插件未启用时，勾选打码节点应报错（即便其他节点合法）
        with self.assertRaises(ValueError):
            pub._validate_nodes({"upscale": False, "wipe": False, "rename": False, "mosaic": True})

    def test_mosaic_alone_with_rename(self):
        with mock.patch.object(pub.plugin_service, "is_enabled", return_value=True), mock.patch.object(
            pub, "_mosaic_process", side_effect=fake_mosaic
        ):
            res = pub.start_run(
                ["novelai_777.png"],
                {"upscale": False, "wipe": False, "rename": True, "mosaic": True},
                {"parts": ["custom", "random"], "custom": "mos"},
                {},
                {"method": "pixel", "parts": ["欧金金"]},
            )
            state = self._wait(res["id"])
        f = state["files"][0]
        self.assertEqual(f["status"], "done")
        self.assertIn("已检测并打码", f["message"])
        out = Path(state["output_dir"]) / f["output"]
        self.assertTrue(out.exists())
        self.assertTrue(f["output"].startswith("mos_"))
        # 打码确实改写了像素
        original = Image.open(self.library / "Treasure" / "Treasure-2026-08-11" / "novelai_777.png").convert("RGB")
        processed = Image.open(out).convert("RGB")
        self.assertNotEqual(original.getpixel((0, 0)), processed.getpixel((0, 0)))
        pub.delete_run(res["id"])

    def test_mosaic_restore_rename_order(self):
        # 超分 → 打码 → 恢复原数据：打码用 PIL 保存会抹掉元数据，恢复必须在其之后写回
        with mock.patch.object(pub.plugin_service, "is_enabled", return_value=True), mock.patch.object(
            pub, "_mosaic_process", side_effect=fake_mosaic
        ):
            res = pub.start_run(
                ["novelai_777.png"],
                {"upscale": True, "restore": True, "wipe": False, "rename": True, "mosaic": True},
                {"parts": ["random"], "custom": ""},
                {"model": "realesr-animevideov3", "scale": 4, "tile": 0, "gpu": 0, "format": "png", "tta": False},
                {"method": "pixel"},
            )
            state = self._wait(res["id"])
        f = state["files"][0]
        self.assertEqual(f["status"], "done")
        out = Path(state["output_dir"]) / f["output"]
        types = [c.decode() for c, _, _ in pub._iter_chunks(out.read_bytes())]
        self.assertIn("tEXt", types)  # 打码后恢复原数据仍生效
        meta = pub.extract_png_metadata(out)
        raw = base64.b64decode(meta["tEXt"][0])
        self.assertIn(b'"1girl"', raw)
        pub.delete_run(res["id"])

    def test_mosaic_wipe(self):
        # 打码 + 抹除：输出仍为 null 覆写，与不打码行为一致
        with mock.patch.object(pub.plugin_service, "is_enabled", return_value=True), mock.patch.object(
            pub, "_mosaic_process", side_effect=fake_mosaic
        ):
            res = pub.start_run(
                ["novelai_777.png"],
                {"upscale": False, "wipe": True, "rename": False, "mosaic": True},
                {},
                {},
            )
            state = self._wait(res["id"])
        f = state["files"][0]
        out = Path(state["output_dir"]) / f["output"]
        meta = pub.extract_png_metadata(out)
        raw = base64.b64decode(meta["tEXt"][0])
        self.assertIn(b'"prompt": null', raw)
        self.assertEqual(len(Path(f["output"]).stem), 8)  # 未重命名时中性名
        pub.delete_run(res["id"])


class PublishHttpSmokeTest(unittest.TestCase):
    """真实 HTTP 层冒烟：临时 uvicorn + 假引擎，覆盖暂存区与仅抹除场景。"""

    PORT = 11552

    @classmethod
    def setUpClass(cls):
        set_up_temp_environment(cls)
        pub._engine_binary = lambda: MOCK_ENGINE  # type: ignore[method-assign]
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            cls.PORT = probe.getsockname()[1]

        import uvicorn

        from app.main import app

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

    def test_staging_and_wipe_only_flow(self):
        engine = json.loads(self._get("/api/publish/engine"))
        self.assertIn("waifu2x-caffe", [e["id"] for e in engine["engines"]])

        staged = self._post(
            "/api/publish/staging",
            {"paths": ["Treasure/Treasure-2026-08-11/novelai_777.png"]},
        )
        self.assertEqual(staged["added"], 1)
        listing = json.loads(self._get("/api/publish/staging"))
        self.assertEqual(listing["count"], 1)
        name = listing["items"][0]["name"]
        image = self._get(f"/api/publish/staging/file?name={urllib.parse.quote(name)}")
        self.assertTrue(image.startswith(b"\x89PNG"))

        # 仅勾选抹除数据（用户报告的 Method Not Allowed 场景）
        started = self._post(
            "/api/publish/run",
            {
                "staged": [name],
                "nodes": {"upscale": False, "restore": False, "wipe": True, "rename": False},
                "rename": {},
                "engine_params": {},
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
        self.assertEqual(state["done"], 1)
        self.assertIsNotNone(state["files"][0]["output"])

        req = urllib.request.Request(
            f"http://127.0.0.1:{self.PORT}/api/publish/run/{run_id}",
            method="DELETE",
        )
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)


if __name__ == "__main__":
    unittest.main(verbosity=2)
