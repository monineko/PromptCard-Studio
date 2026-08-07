import os
from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import cards as cards_service
from . import batch as batch_service
from . import backgrounds as backgrounds_service
from . import novelai as novelai_service
from . import png_send as png_send_service
from . import library as library_service
from . import vibes as vibes_service
from . import workspace as workspace_service
from .config import PROJECT_ROOT, ensure_dirs, load_settings, save_settings
from .schemas import (
    AnrImportIn,
    BatchStartIn,
    CardImageIn,
    CardIn,
    CardUpdate,
    CategoryColor,
    CategoryOrder,
    CategoryIn,
    CategoryRename,
    ExpandRequest,
    DeleteImagesIn,
    GenerateTokenIn,
    PngSendIn,
    VibeImportIn,
    ImportPathIn,
    MoveImagesIn,
    ReviewApplyIn,
    ReviewUndoIn,
    SetCoverIn,
    Text2ImageIn,
    VibeRenameIn,
    WorkspaceIn,
)

ensure_dirs()

app = FastAPI(title="Novelai Prompt Manager", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _as_http(e: Exception, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=str(e))


@app.get("/api/health")
def health():
    return {"ok": True}


# ---------- 分类 ----------


@app.get("/api/categories")
def get_categories():
    return cards_service.list_categories()


@app.post("/api/categories")
def add_category(body: CategoryIn):
    try:
        return cards_service.create_category(body.name)
    except Exception as e:
        raise _as_http(e)


@app.put("/api/categories")
def rename_category(body: CategoryRename):
    try:
        return cards_service.rename_category(body.old_name, body.new_name)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/categories")
def remove_category(name: str):
    try:
        cards_service.delete_category(name)
        return {"ok": True}
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e, 404)


@app.put("/api/categories/order")
def set_category_order(body: CategoryOrder):
    return save_settings({"category_order": body.names})


@app.put("/api/categories/color")
def set_category_color(body: CategoryColor):
    settings = load_settings()
    colors = settings.get("category_colors") or {}
    colors[body.name] = body.hue
    return save_settings({"category_colors": colors})


# ---------- 卡片 ----------


@app.get("/api/cards/content")
def card_content(category: str, name: str):
    card = cards_service.get_card(category, name)
    if card is None:
        raise HTTPException(404, f"卡片不存在: <{category}:{name}>")
    return card


@app.post("/api/cards")
def add_card(body: CardIn):
    try:
        return cards_service.create_card(body.category, body.name, body.content)
    except FileExistsError as e:
        raise _as_http(e, 409)
    except Exception as e:
        raise _as_http(e)


@app.put("/api/cards")
def edit_card(body: CardUpdate):
    try:
        return cards_service.update_card(
            body.category,
            body.name,
            body.content,
            body.new_category,
            body.new_name,
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/cards")
def remove_card(category: str, name: str):
    try:
        cards_service.delete_card(category, name)
        return {"ok": True}
    except Exception as e:
        raise _as_http(e, 404)


@app.post("/api/cards/expand")
def expand_text(body: ExpandRequest):
    settings = load_settings()
    text = body.text
    if settings.get("format_input", True):
        text = cards_service.expand(text)
    return {"text": text}


@app.post("/api/cards/import")
async def import_cards(kind: str = Form(...), file: UploadFile = File(...)):
    data = await file.read()
    try:
        if kind == "csv":
            return cards_service.import_csv_file(data)
        if kind == "json":
            return cards_service.import_json_file(data)
        raise HTTPException(400, f"不支持的导入类型: {kind}")
    except Exception as e:
        raise _as_http(e)


@app.post("/api/cards/import-anr")
def import_anr(body: AnrImportIn):
    try:
        return cards_service.import_anr_directory(body.path)
    except Exception as e:
        raise _as_http(e)


@app.get("/api/cards/export")
def export_cards():
    return StreamingResponse(
        iter([cards_service.export_zip()]),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="cards_export_{date.today():%Y%m%d}.zip"'},
    )


@app.get("/api/cards/images")
def cards_images():
    return cards_service.list_cards_images()


@app.put("/api/cards/image")
def set_card_image(body: CardImageIn):
    try:
        return cards_service.set_card_image(body.category, body.name, body.path)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/cards/image")
def remove_card_image(category: str, name: str):
    try:
        return cards_service.remove_card_image(category, name)
    except Exception as e:
        raise _as_http(e)


# ---------- 工作区 ----------


@app.get("/api/workspace")
def get_workspace():
    return workspace_service.load_workspace()


@app.put("/api/workspace")
def put_workspace(body: WorkspaceIn):
    return workspace_service.save_workspace(body.positive, body.negative)


# ---------- 设置 ----------


@app.get("/api/settings")
def get_settings():
    settings = load_settings()
    settings.pop("novelai_token", None)  # 敏感凭据绝不返回前端
    return settings


@app.put("/api/settings")
def put_settings(body: dict):
    body.pop("novelai_token", None)  # 仅允许通过专用接口修改 token
    return save_settings(body)


# ---------- NovelAI 生成 ----------


@app.get("/api/generate/meta")
def generate_meta():
    return novelai_service.meta()


@app.get("/api/vibes")
def list_vibes():
    return vibes_service.list_vibes()


@app.post("/api/vibes/rename")
def vibe_rename(body: VibeRenameIn):
    try:
        return vibes_service.rename_vibe(body.id, body.name)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except FileExistsError as e:
        raise _as_http(e, 409)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/vibes/open-folder")
def vibe_open_folder():
    try:
        return vibes_service.open_vibes_folder()
    except Exception as e:
        raise _as_http(e)


@app.post("/api/vibes/import")
def vibe_import(body: VibeImportIn):
    try:
        return vibes_service.import_vibe_file(
            body.encoding,
            body.strength,
            float(body.information_extracted)
            if body.information_extracted is not None
            else 0.7,
            body.model,
            body.name,
        )
    except ValueError as e:
        raise _as_http(e, 400)


@app.get("/api/generate/status")
def generate_status():
    configured = novelai_service.is_configured()
    anlas = None
    error = None
    if configured:
        anlas, error = novelai_service.inquire_anlas()
    return {"configured": configured, "anlas": anlas, "anlas_error": error}


@app.get("/api/generate/anlas")
def generate_anlas():
    anlas, error = novelai_service.inquire_anlas()
    return {"anlas": anlas, "error": error}


@app.post("/api/generate/token")
def generate_token(body: GenerateTokenIn):
    novelai_service.set_token(body.token)
    return {"ok": True, "configured": novelai_service.is_configured()}


@app.post("/api/generate/text2image")
def generate_text2image(body: Text2ImageIn):
    try:
        prompt = cards_service.expand(body.prompt)
        negative_prompt = cards_service.expand(body.negative_prompt)
        params = body.params or {}
        characters = params.get("characters") or []
        if characters:
            expanded = []
            for c in characters:
                if not isinstance(c, dict):
                    continue
                expanded.append(
                    {
                        **c,
                        "positive": cards_service.expand(str(c.get("positive") or "")),
                        "negative": cards_service.expand(str(c.get("negative") or "")),
                    }
                )
            params = {**params, "characters": expanded}
        return novelai_service.generate_text2image(
            prompt, negative_prompt, params
        )
    except ValueError as e:
        raise _as_http(e, 400)
    except RuntimeError as e:
        raise _as_http(e, 502)


# ---------- 批量生成 ----------


@app.get("/api/generate/batch")
def batch_status():
    return batch_service.status()


@app.post("/api/generate/batch")
def batch_start(body: BatchStartIn):
    try:
        return batch_service.start_batch(
            body.base_positive,
            body.negative,
            [d.model_dump() for d in body.dimensions],
            body.params,
            body.stop_anlas,
        )
    except ValueError as e:
        raise _as_http(e, 400)
    except RuntimeError as e:
        raise _as_http(e, 502)


@app.post("/api/generate/batch/pause")
def batch_pause():
    try:
        return batch_service.pause_batch()
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/generate/batch/resume")
def batch_resume():
    try:
        return batch_service.resume_batch()
    except ValueError as e:
        raise _as_http(e, 400)
    except RuntimeError as e:
        raise _as_http(e, 502)


@app.post("/api/generate/batch/end")
def batch_end():
    try:
        return batch_service.end_batch()
    except Exception as e:
        raise _as_http(e, 400)


@app.post("/api/generate/from-png")
def generate_from_png(body: PngSendIn):
    try:
        return png_send_service.build_send_payload(body.png, body.model)
    except ValueError as e:
        raise _as_http(e, 400)


# ---------- 背景图 ----------


@app.get("/api/backgrounds")
def backgrounds_list():
    return backgrounds_service.list_backgrounds()


@app.get("/api/backgrounds/image")
def backgrounds_image(name: str):
    try:
        file = backgrounds_service.resolve_background(name)
    except ValueError as e:
        raise _as_http(e, 400)
    if not file.exists() or not file.is_file():
        raise HTTPException(404, "背景图不存在")
    return FileResponse(file)


@app.post("/api/backgrounds/open-folder")
def backgrounds_open_folder():
    try:
        return backgrounds_service.open_backgrounds_folder()
    except Exception as e:
        raise _as_http(e)


# ---------- 图片库 ----------


@app.get("/api/library/summary")
def library_summary():
    return library_service.summary()


@app.get("/api/library/images")
def library_images(category: str = "all"):
    try:
        return library_service.list_images(category)
    except ValueError as e:
        raise _as_http(e, 404)


@app.get("/api/library/image")
def library_image(path: str):
    try:
        file = library_service.resolve_image(path)
    except ValueError as e:
        raise _as_http(e, 400)
    if not file.exists() or not file.is_file():
        raise HTTPException(404, "图片不存在")
    return FileResponse(file)


@app.get("/api/library/png-info")
def library_png_info(path: str):
    try:
        return library_service.read_png_info(path)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/library/review/apply")
def library_review_apply(body: ReviewApplyIn):
    try:
        return library_service.apply_review(
            [move.model_dump() for move in body.moves],
            recycle_reject=body.recycle_reject,
        )
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/review/undo")
def library_review_undo(body: ReviewUndoIn):
    try:
        return library_service.undo_review(body.token)
    except ValueError as e:
        raise _as_http(e, 404)


@app.post("/api/library/import")
async def library_import(files: list[UploadFile] = File(...)):
    try:
        return library_service.import_uploaded_files(
            [(f.filename or "", await f.read()) for f in files]
        )
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/import-path")
def library_import_path(body: ImportPathIn):
    try:
        return library_service.import_from_path(body.path)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/open-folder")
def library_open_folder():
    try:
        return library_service.open_library_folder()
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/move")
def library_move(body: MoveImagesIn):
    try:
        return library_service.move_images(body.paths, body.target)
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/delete")
def library_delete(body: DeleteImagesIn):
    try:
        return library_service.delete_images(body.paths)
    except Exception as e:
        raise _as_http(e)


@app.get("/api/library/covers")
def library_covers():
    return library_service.list_covers()


@app.put("/api/library/covers")
def library_set_cover(body: SetCoverIn):
    try:
        return library_service.set_cover(body.category, body.path)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/library/covers")
def library_remove_cover(category: str):
    try:
        return library_service.remove_cover(category)
    except ValueError as e:
        raise _as_http(e, 400)


# ---------- 静态前端 ----------

DIST = PROJECT_ROOT / "frontend" / "dist"
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
def index():
    index_file = DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file)
    return {"message": "backend running; frontend not built yet"}


@app.get("/{full_path:path}")
def spa(full_path: str):
    index_file = DIST / "index.html"
    if index_file.exists() and not full_path.startswith("api/"):
        return FileResponse(index_file)
    raise HTTPException(404, "not found")
