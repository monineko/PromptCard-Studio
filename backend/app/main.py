import os
from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import cards as cards_service
from . import library as library_service
from . import workspace as workspace_service
from .config import PROJECT_ROOT, ensure_dirs, load_settings, save_settings
from .schemas import (
    AnrImportIn,
    CardIn,
    CardUpdate,
    CategoryColor,
    CategoryOrder,
    CategoryIn,
    CategoryRename,
    ExpandRequest,
    DeleteImagesIn,
    ImportPathIn,
    MoveImagesIn,
    ReviewApplyIn,
    ReviewUndoIn,
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
    return load_settings()


@app.put("/api/settings")
def put_settings(body: dict):
    return save_settings(body)


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
