"""NovelAI 接口封装（文生图）。

接口依据：本地 ANR 源码（Auto-NovelAI-Refactor-main），仅实现 text2image；
局部重绘 / 图生图 / 导演模式 / vibe 等暂不实现。
"""

import io
import json
import random
import string
import time
import urllib.error
import urllib.request
import zipfile
from datetime import date
from pathlib import Path

from .config import load_settings, save_settings
from .library import _library_root

API_BASE = "https://image.novelai.net"
GENERATE_URL = f"{API_BASE}/ai/generate-image"
SUBSCRIPTION_URL = f"{API_BASE}/user/subscription"

REQUEST_TIMEOUT = 180  # 生图请求较慢，放宽超时
SHORT_TIMEOUT = 30  # 点数查询

# ---------- 参数表（与 ANR utils/variable.py 一致） ----------

MODELS = [
    "nai-diffusion-4-5-full",
    "nai-diffusion-4-5-curated",
    "nai-diffusion-4-full",
    "nai-diffusion-4-curated-preview",
    "nai-diffusion-3",
    "nai-diffusion-furry-3",
]

SAMPLERS = [
    "k_euler",
    "k_euler_ancestral",
    "k_dpmpp_2s_ancestral",
    "k_dpmpp_2m",
    "k_dpmpp_sde",
    "k_dpmpp_2m_sde",
    "ddim_v3",
]

NOISE_SCHEDULES = ["native", "karras", "exponential", "polyexponential"]

UC_PRESETS = ["Heavy", "Light", "Furry Focus", "Human Focus", "None"]

RESOLUTIONS = [
    {"label": "832x1216", "width": 832, "height": 1216, "free": True},
    {"label": "1216x832", "width": 1216, "height": 832, "free": False},
    {"label": "1024x1024", "width": 1024, "height": 1024, "free": False},
    {"label": "1024x1536", "width": 1024, "height": 1536, "free": False},
    {"label": "1536x1024", "width": 1536, "height": 1024, "free": False},
    {"label": "1472x1472", "width": 1472, "height": 1472, "free": False},
    {"label": "1088x1920", "width": 1088, "height": 1920, "free": False},
    {"label": "1920x1088", "width": 1920, "height": 1088, "free": False},
    {"label": "512x768", "width": 512, "height": 768, "free": True},
    {"label": "768x768", "width": 768, "height": 768, "free": True},
    {"label": "640x640", "width": 640, "height": 640, "free": True},
]

FREE_RESOLUTIONS = [r["label"] for r in RESOLUTIONS if r["free"]]
FREE_MAX_STEPS = 28
FREE_N_SAMPLES = 1

# 各模型的可用采样器 / 调度器 / UC 预设（与 ANR update_components_for_models_change 一致）
_BASE_SAMPLERS = [s for s in SAMPLERS if s != "ddim_v3"]
_BASE_NOISE = [n for n in NOISE_SCHEDULES if n != "native"]

MODEL_RULES: dict[str, dict] = {
    "nai-diffusion-4-5-full": {
        "samplers": _BASE_SAMPLERS,
        "noise_schedules": _BASE_NOISE,
        "uc_presets": ["Heavy", "Light", "Furry Focus", "Human Focus", "None"],
        "features": {"sm": False, "decrisp": False, "legacy_uc": False, "furry": True, "characters": True},
    },
    "nai-diffusion-4-5-curated": {
        "samplers": _BASE_SAMPLERS,
        "noise_schedules": _BASE_NOISE,
        "uc_presets": ["Heavy", "Light", "Human Focus", "None"],
        "features": {"sm": False, "decrisp": False, "legacy_uc": False, "furry": True, "characters": True},
    },
    "nai-diffusion-4-full": {
        "samplers": _BASE_SAMPLERS,
        "noise_schedules": _BASE_NOISE,
        "uc_presets": ["Heavy", "Light", "None"],
        "features": {"sm": False, "decrisp": False, "legacy_uc": True, "furry": True, "characters": True},
    },
    "nai-diffusion-4-curated-preview": {
        "samplers": _BASE_SAMPLERS,
        "noise_schedules": _BASE_NOISE,
        "uc_presets": ["Heavy", "Light", "None"],
        "features": {"sm": False, "decrisp": False, "legacy_uc": True, "furry": True, "characters": True},
    },
    "nai-diffusion-3": {
        "samplers": SAMPLERS,
        "noise_schedules": NOISE_SCHEDULES,
        "uc_presets": ["Heavy", "Light", "Human Focus", "None"],
        "features": {"sm": True, "decrisp": True, "legacy_uc": False, "furry": False, "characters": False},
    },
    "nai-diffusion-furry-3": {
        "samplers": SAMPLERS,
        "noise_schedules": NOISE_SCHEDULES,
        "uc_presets": ["Heavy", "Light", "None"],
        "features": {"sm": True, "decrisp": True, "legacy_uc": False, "furry": False, "characters": False},
    },
}

QUALITY_TAGS = {
    "nai-diffusion-4-5-full": ", very aesthetic, masterpiece, no text",
    "nai-diffusion-4-5-curated": ", very aesthetic, masterpiece, no text, -0.8::feet::, rating:general",
    "nai-diffusion-4-full": ", no text, best quality, very aesthetic, absurdres",
    "nai-diffusion-4-curated-preview": ", rating:general, best quality, very aesthetic, absurdres",
    "nai-diffusion-3": ", best quality, amazing quality, very aesthetic, absurdres",
    "nai-diffusion-furry-3": ", {best quality}, {amazing quality}",
}

UNDESIRED_PRESETS = {
    "nai-diffusion-4-5-full": {
        "Heavy": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page",
        "Light": "lowres, artistic error, scan artifacts, worst quality, bad quality, jpeg artifacts, multiple views, very displeasing, too many watermarks, negative space, blank page",
        "Furry Focus": "{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic",
        "Human Focus": "lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, @_@, mismatched pupils, glowing eyes, bad anatomy",
        "None": "",
    },
    "nai-diffusion-4-5-curated": {
        "Heavy": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page",
        "Light": "blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page",
        "Human Focus": "blurry, lowres, upscaled, artistic error, film grain, scan artifacts, bad anatomy, bad hands, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, @_@, mismatched pupils, glowing eyes, negative space, blank page",
        "None": "",
    },
    "nai-diffusion-4-full": {
        "Heavy": "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page",
        "Light": "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page",
        "None": "",
    },
    "nai-diffusion-4-curated-preview": {
        "Heavy": "blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page",
        "Light": "blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page",
        "None": "",
    },
    "nai-diffusion-3": {
        "Heavy": "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract]",
        "Light": "lowres, jpeg artifacts, worst quality, watermark, blurry, very displeasing",
        "Human Focus": "lowres, {bad}, error, fewer, extra, missing, worst quality, jpeg artifacts, bad quality, watermark, unfinished, displeasing, chromatic aberration, signature, extra digits, artistic error, username, scan, [abstract], bad anatomy, bad hands, @_@, mismatched pupils, heart-shaped pupils, glowing eyes",
        "None": "",
    },
    "nai-diffusion-furry-3": {
        "Heavy": "{{worst quality}}, [displeasing], {unusual pupils}, guide lines, {{unfinished}}, {bad}, url, artist name, {{tall image}}, mosaic, {sketch page}, comic panel, impact (font), [dated], {logo}, ych, {what}, {where is your god now}, {distorted text}, repeated text, {floating head}, {1994}, {widescreen}, absolutely everyone, sequence, {compression artifacts}, hard translated, {cropped}, {commissioner name}, unknown text, high contrast",
        "Light": "{worst quality}, guide lines, unfinished, bad, url, tall image, widescreen, compression artifacts, unknown text",
        "None": "",
    },
}

_UC_PRESET_INDEX = {
    "nai-diffusion-4-5-full": {"Heavy": 0, "Light": 1, "Furry Focus": 2, "Human Focus": 3, "None": 4},
    "nai-diffusion-4-5-curated": {"Heavy": 0, "Light": 1, "Human Focus": 2, "None": 3},
    "nai-diffusion-3": {"Heavy": 0, "Light": 1, "Human Focus": 2, "None": 3},
    "nai-diffusion-furry-3": {"Heavy": 0, "Light": 1, "None": 2},
    "nai-diffusion-4-curated-preview": {"Heavy": 0, "Light": 1, "None": 2},
    "nai-diffusion-4-full": {"Heavy": 0, "Light": 1, "None": 2},
}

_SKIP_CFG_ABOVE_SIGMA = {
    "nai-diffusion-4-5-full": 58,
    "nai-diffusion-4-5-curated": 36.158893609242725,
    "nai-diffusion-4-full": 19,
    "nai-diffusion-3": 19.343056794463642,
    "nai-diffusion-furry-3": 11.84515480302779,
    "nai-diffusion-4-curated-preview": 11.84515480302779,
}


# ---------- token ----------


def get_token() -> str:
    settings = load_settings()
    return str(settings.get("novelai_token") or "").strip()


def set_token(token: str) -> None:
    save_settings({"novelai_token": token.strip()})


def is_configured() -> bool:
    return bool(get_token())


# ---------- HTTP ----------


def build_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "*/*",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
        "Authorization": f"Bearer {token}" if token else "",
        "Content-type": "application/json",
        "Origin": "https://novelai.net",
        "Priority": "u=1, i",
        "Referer": "https://novelai.net/",
        "User-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36",
    }


def _request_json(url: str, payload: dict | None, timeout: int, token: str) -> tuple[int, bytes]:
    """发送请求，返回 (status, body)。非 2xx 不抛异常，由调用方解析错误。"""
    headers = build_headers(token)
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except urllib.error.URLError as e:
        raise RuntimeError(f"网络请求失败: {e.reason}") from e
    except TimeoutError as e:
        raise RuntimeError("请求超时") from e


def _response_error_message(status: int, body: bytes) -> str:
    try:
        parsed = json.loads(body.decode("utf-8", errors="replace"))
    except Exception:
        return body.decode("utf-8", errors="replace")[:500]
    if isinstance(parsed, dict):
        return str(parsed.get("message") or parsed.get("error") or parsed)
    return str(parsed)[:500]


def inquire_anlas(token: str | None = None) -> tuple[int | None, str | None]:
    """查询剩余点数。返回 (anlas, error)。"""
    token = token if token is not None else get_token()
    if not token:
        return None, "未配置 token"
    try:
        status, body = _request_json(SUBSCRIPTION_URL, None, SHORT_TIMEOUT, token)
    except Exception as e:
        return None, str(e)
    if status != 200:
        return None, _response_error_message(status, body)
    try:
        data = json.loads(body.decode("utf-8", errors="replace"))
        anlas = data.get("trainingStepsLeft", {}).get("fixedTrainingStepsLeft")
        if anlas is None:
            return None, "响应中未找到训练步数"
        return int(anlas), None
    except Exception as e:
        return None, f"解析点数失败: {e}"


# ---------- 参数校验与请求体构造 ----------


def return_x64(num: int) -> int:
    """与 ANR return_x64 一致：向上/向下取整到 64 的倍数（最小 64）。"""
    if num <= 64:
        return 64
    if num % 64 == 0:
        return num
    if (num / 64) % 1 >= 0.5:
        return (num // 64 + 1) * 64
    return (num // 64) * 64


class GenerationParams:
    """面板提交的生图参数（不含提示词）。"""

    def __init__(self, data: dict):
        self.model = str(data.get("model") or "nai-diffusion-4-5-full")
        self.width = int(data.get("width") or 832)
        self.height = int(data.get("height") or 1216)
        self.steps = int(data.get("steps") or 23)
        self.scale = float(data.get("scale") or 5)
        self.cfg_rescale = float(data.get("cfg_rescale") or 0)
        self.sampler = str(data.get("sampler") or "k_euler_ancestral")
        self.noise_schedule = str(data.get("noise_schedule") or "karras")
        self.seed = int(data.get("seed") or -1)
        self.uc_preset = str(data.get("uc_preset") or "Heavy")
        self.quality_toggle = bool(data.get("quality_toggle", True))
        self.variety = bool(data.get("variety", True))
        self.sm = bool(data.get("sm", False))
        self.sm_dyn = bool(data.get("sm_dyn", False))
        self.decrisp = bool(data.get("decrisp", False))
        self.legacy_uc = bool(data.get("legacy_uc", False))
        self.furry_mode = bool(data.get("furry_mode", False))
        self.characters = data.get("characters") or []
        self.use_coords = bool(data.get("use_coords", True))

    def validate(self) -> None:
        if self.model not in MODEL_RULES:
            raise ValueError(f"未知模型: {self.model}")
        rules = MODEL_RULES[self.model]
        if self.sampler not in rules["samplers"]:
            raise ValueError(f"模型 {self.model} 不支持采样器 {self.sampler}")
        if self.noise_schedule not in rules["noise_schedules"]:
            raise ValueError(f"模型 {self.model} 不支持调度器 {self.noise_schedule}")
        if self.uc_preset not in rules["uc_presets"]:
            raise ValueError(f"模型 {self.model} 不支持 UC 预设 {self.uc_preset}")
        if not (1 <= self.steps <= 50):
            raise ValueError("采样步数需在 1~50 之间")
        if not (0 <= self.scale <= 10):
            raise ValueError("提示词指导系数需在 0~10 之间")
        if not (0 <= self.cfg_rescale <= 1):
            raise ValueError("提示词重采样系数需在 0~1 之间")
        if not (self.width > 0 and self.height > 0):
            raise ValueError("分辨率必须大于 0")
        if self.seed < -1:
            raise ValueError("种子需为 -1（随机）或非负整数")

    @property
    def effective_seed(self) -> int:
        return random.randint(1000000000, 9999999999) if self.seed == -1 else self.seed


def build_text2image_payload(params: GenerationParams, prompt: str, negative_prompt: str) -> dict:
    """按 ANR 各模型函数构造 text2image 请求体。"""
    model = params.model
    rules = MODEL_RULES[model]
    is_v3 = model in ("nai-diffusion-3", "nai-diffusion-furry-3")

    _input = prompt.strip()
    if params.furry_mode and not is_v3:
        _input = "fur dataset, " + _input
    if params.quality_toggle:
        _input += QUALITY_TAGS.get(model, "")

    uc_preset_words = UNDESIRED_PRESETS.get(model, {}).get(params.uc_preset, "")
    user_negative = negative_prompt.strip()
    if uc_preset_words and user_negative:
        combined_negative = f"{uc_preset_words}, {user_negative}"
    else:
        combined_negative = uc_preset_words or user_negative

    seed = params.effective_seed
    skip_cfg = _SKIP_CFG_ABOVE_SIGMA.get(model) if params.variety else None

    characters: list[dict] = []
    for c in params.characters:
        if not isinstance(c, dict):
            continue
        pos = c.get("center") or {}
        characters.append(
            {
                "positive": str(c.get("positive") or "").strip(),
                "negative": str(c.get("negative") or "").strip(),
                "center": {"x": float(pos.get("x", 0.5)), "y": float(pos.get("y", 0.5))},
            }
        )

    base = {
        "input": _input,
        "model": model,
        "action": "generate",
        "parameters": {
            "params_version": 3,
            "width": return_x64(params.width),
            "height": return_x64(params.height),
            "scale": params.scale,
            "sampler": params.sampler,
            "steps": params.steps,
            "n_samples": 1,
            "ucPreset": _UC_PRESET_INDEX[model][params.uc_preset],
            "qualityToggle": params.quality_toggle,
            "autoSmea": False,
            "dynamic_thresholding": params.decrisp,
            "controlnet_strength": 1,
            "legacy": False,
            "add_original_image": True,
            "cfg_rescale": params.cfg_rescale,
            "legacy_v3_extend": False,
            "skip_cfg_above_sigma": skip_cfg,
            "seed": seed,
            "characterPrompts": [
                {
                    "prompt": c["positive"],
                    "uc": c["negative"],
                    "center": c["center"],
                    "enabled": True,
                }
                for c in characters
            ],
            "negative_prompt": combined_negative,
        },
        "use_new_shared_trial": True,
    }

    if not is_v3:
        base["parameters"]["noise_schedule"] = params.noise_schedule
        base["parameters"]["use_coords"] = params.use_coords
        base["parameters"]["normalize_reference_strength_multiple"] = True
        base["parameters"]["inpaintImg2ImgStrength"] = 1
        base["parameters"]["v4_prompt"] = {
            "caption": {
                "base_caption": _input,
                "char_captions": [
                    {"char_caption": c["positive"], "centers": [c["center"]]} for c in characters
                ],
            },
            "use_coords": params.use_coords,
            "use_order": True,
        }
        base["parameters"]["v4_negative_prompt"] = {
            "caption": {
                "base_caption": combined_negative,
                "char_captions": [
                    {"char_caption": c["negative"], "centers": [c["center"]]} for c in characters
                ],
            },
            "legacy_uc": params.legacy_uc,
        }
        base["parameters"]["legacy_uc"] = params.legacy_uc
        base["parameters"]["stream"] = "msgpack"
    else:
        base["parameters"]["sm"] = params.sm
        base["parameters"]["sm_dyn"] = params.sm_dyn
        if params.sampler != "ddim_v3":
            base["parameters"]["noise_schedule"] = params.noise_schedule

    if params.sampler == "k_euler_ancestral":
        base["parameters"]["deliberate_euler_ancestral_bug"] = False
        base["parameters"]["prefer_brownian"] = True

    return base


def generate_image(token: str, payload: dict) -> bytes:
    """调用 NovelAI 生图接口，返回 PNG 字节。"""
    status, body = _request_json(GENERATE_URL, payload, REQUEST_TIMEOUT, token)
    if status != 200:
        raise RuntimeError(f"NovelAI 返回 HTTP {status}: {_response_error_message(status, body)}")
    try:
        with zipfile.ZipFile(io.BytesIO(body), mode="r") as zf:
            with zf.open("image_0.png") as img:
                return img.read()
    except zipfile.BadZipFile as e:
        raise RuntimeError("NovelAI 返回了非 zip 数据") from e


# ---------- 存图 ----------


def _random_str(length: int = 6) -> str:
    base = string.ascii_letters + string.digits
    return "".join(random.choice(base) for _ in range(length))


def _save_to_library(data: bytes, seed: int, payload: dict) -> dict:
    """保存到图库未评分目录 library/<日期>/<种子>_<随机6位>.png，并回填元数据。"""
    root = _library_root()
    folder = root / date.today().isoformat()
    folder.mkdir(parents=True, exist_ok=True)
    name = f"{seed}_{_random_str(6)}.png"
    dest = folder / name
    dest.write_bytes(data)

    _ensure_png_metadata(dest, payload)
    return {
        "path": dest.relative_to(root).as_posix(),
        "name": name,
        "seed": seed,
        "width": payload["parameters"]["width"],
        "height": payload["parameters"]["height"],
    }


def _ensure_png_metadata(path: Path, payload: dict) -> None:
    """NovelAI 出图通常自带 Comment 元数据；缺失时用请求体回填，保证图库可解析。"""
    try:
        from PIL import Image
        from PIL.PngImagePlugin import PngInfo
    except ImportError:
        return

    params = payload["parameters"]
    try:
        with Image.open(path) as img:
            if img.info.get("Comment"):
                return
        meta = PngInfo()
        comment = {
            "prompt": payload.get("input", ""),
            "uc": params.get("negative_prompt", ""),
            "width": params.get("width"),
            "height": params.get("height"),
            "seed": params.get("seed"),
            "sampler": params.get("sampler"),
            "steps": params.get("steps"),
            "scale": params.get("scale"),
            "cfg_rescale": params.get("cfg_rescale"),
            "noise_schedule": params.get("noise_schedule"),
            "sm": params.get("sm", False),
            "sm_dyn": params.get("sm_dyn", False),
            "legacy_uc": params.get("legacy_uc", False),
            "v4_prompt": params.get("v4_prompt"),
            "v4_negative_prompt": params.get("v4_negative_prompt"),
        }
        meta.add_text("Comment", json.dumps(comment, ensure_ascii=False))
        meta.add_text("Software", "NovelAI")
        with Image.open(path) as img:
            img.save(path, pnginfo=meta)
    except Exception:
        pass


def generate_text2image(prompt: str, negative_prompt: str, params_data: dict) -> dict:
    """单张文生图完整流程：校验 → 构造 → 调用 → 存图。返回结果摘要。"""
    token = get_token()
    if not token:
        raise ValueError("尚未配置 NovelAI token，请先在「设置」中配置")

    params = GenerationParams(params_data)
    params.validate()

    if not prompt.strip():
        raise ValueError("正面提示词为空，无法生成")

    start = time.monotonic()
    payload = build_text2image_payload(params, prompt, negative_prompt)
    image_data = generate_image(token, payload)
    saved = _save_to_library(image_data, payload["parameters"]["seed"], payload)
    saved["ok"] = True
    saved["elapsed_ms"] = int((time.monotonic() - start) * 1000)
    anlas, _ = inquire_anlas(token)
    saved["anlas"] = anlas
    return saved


def meta() -> dict:
    return {
        "models": MODELS,
        "samplers": SAMPLERS,
        "noise_schedules": NOISE_SCHEDULES,
        "uc_presets": UC_PRESETS,
        "resolutions": RESOLUTIONS,
        "model_rules": MODEL_RULES,
        "free": {
            "max_steps": FREE_MAX_STEPS,
            "resolutions": FREE_RESOLUTIONS,
            "n_samples": FREE_N_SAMPLES,
        },
        "quality_tags": QUALITY_TAGS,
    }
