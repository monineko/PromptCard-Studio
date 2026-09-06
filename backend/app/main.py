import asyncio
import os
import re
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager, suppress
from datetime import date
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import cards as cards_service
from . import batch as batch_service
from . import batch_covers as batch_cover_service
from . import backgrounds as backgrounds_service
from . import dictionary as dictionary_service
from . import generation_coordinator as generation_coordinator_service
from . import novelai as novelai_service
from . import png_send as png_send_service
from . import plugins as plugin_service
from . import publish as publish_service
from . import library as library_service
from . import migration as migration_service
from . import vibes as vibes_service
from . import workspace as workspace_service
from . import style_explore as style_explore_service
from . import terminal as terminal_log
from .config import PROJECT_ROOT, ensure_dirs, load_settings, save_settings
from .schemas import (
    BatchStartIn,
    BatchCoverAssignIn,
    BatchCoverStartIn,
    CardImageIn,
    CardIn,
    CardPinIn,
    CardUpdate,
    CategoryColor,
    CategoryOrder,
    CategoryIn,
    CategoryRename,
    DictionaryBatchIn,
    DictionarySaveIn,
    ExpandRequest,
    DeleteImagesIn,
    GenerateTokenIn,
    PngSendIn,
    VibeImportIn,
    ImportPathIn,
    ImportUrlsIn,
    MoveImagesIn,
    PublishEngineLocalPathIn,
    PublishEngineParamsIn,
    PublishRenamePreviewIn,
    PublishRunIn,
    PublishStageIn,
    ReviewApplyIn,
    ReviewUndoIn,
    SetCoverIn,
    StyleExploreCandidateUpdateIn,
    StyleExploreCandidateCardIn,
    StyleExploreCandidatesIn,
    StyleExplorePoolIn,
    StyleExplorePoolBackupRestoreIn,
    StyleExplorePoolUpdateIn,
    StyleExploreRunUpdateIn,
    StyleExploreResumeIn,
    StyleExploreReviewsIn,
    StyleExploreBasicRoundIn,
    StyleExploreAestheticBranchIn,
    StyleExploreDeepParentsIn,
    StyleExploreDeepPreferenceIn,
    StyleExploreDeepRoundIn,
    StyleExploreRunIn,
    Text2ImageIn,
    VibeRenameIn,
    VibeFolderIn,
    VibeFolderRenameIn,
    WorkspaceIn,
)

ensure_dirs()
cards_service.ensure_default_categories()
STATUS_HEARTBEAT_SECONDS = 15.0


async def _runtime_heartbeat() -> None:
    """定时确认本地服务与生成通道状态，不触发任何外部网络请求。"""
    while True:
        await asyncio.sleep(STATUS_HEARTBEAT_SECONDS)
        try:
            batch = batch_service.status()
            if batch.get("active") and batch.get("run"):
                run = batch["run"]
                status_label = {
                    "running": "运行中",
                    "paused": "已暂停",
                    "completed": "已完成",
                    "stopped": "已停止",
                }.get(str(run.get("status")), str(run.get("status")))
                terminal_log.log(
                    "状态",
                    f"服务在线 · 批量任务 {run.get('id')} {status_label} · 进度 [{run.get('done')}/{run.get('total')}]",
                )
                continue
            reservation = generation_coordinator_service.status().get("reservation")
            if reservation:
                task_id = str(reservation.get("task_id") or "")
                owner = str(reservation.get("owner") or "")
                if owner == "batch_cover":
                    cover = batch_cover_service.status().get("run") or {}
                    terminal_log.log(
                        "状态",
                        f"服务在线 · 批量卡面任务 {task_id} 运行中 · 进度 [{cover.get('done')}/{cover.get('total')}]",
                    )
                    continue
                try:
                    summary = style_explore_service.runtime_summary(task_id)
                    detail = f"任务 {summary.get('name') or task_id} · 进度 [{summary.get('done_count')}/{summary.get('candidate_count')}]"
                except (FileNotFoundError, ValueError):
                    detail = f"任务 {task_id}"
                terminal_log.log(
                    "状态",
                    f"服务在线 · 画风探索正在占用生成通道 · {detail}",
                )
                continue
            terminal_log.log("状态", "服务在线 · 生成通道空闲，安静待命中～")
        except Exception as error:  # noqa: BLE001
            terminal_log.log("警告", f"运行状态检查没有完成 · {terminal_log.compact_error(error)}")


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    cover = batch_cover_service.status()
    if cover.get("active") and (cover.get("run") or {}).get("status") == "paused":
        terminal_log.log("卡面", "服务重启，未完成的批量卡面任务已恢复为暂停状态")
    recovered = style_explore_service.recover_interrupted_runs()
    if recovered.get("recovered_count"):
        terminal_log.log(
            "探索",
            f"服务重启，检测到 {recovered['recovered_count']} 个未完成任务，又要打工了喵…已经全部恢复为暂停状态",
        )
    heartbeat = asyncio.create_task(_runtime_heartbeat())
    try:
        yield
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat


app = FastAPI(title="PromptCard Studio for NovelAI", version="1.2.3", lifespan=_lifespan)

# 本地 Web 应用：只允许本机来源（127.0.0.1 / localhost 任意端口，含前端开发服务器），
# 防止外部网页跨域读取本地数据或触发关闭等操作
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_failed_http_requests(request: Request, call_next):
    """成功读取请求保持安静；所有失败请求至少留下状态码与真实路径。"""
    try:
        response = await call_next(request)
    except Exception as error:  # noqa: BLE001
        terminal_log.log(
            "错误",
            f"接口异常 · {request.method} {request.url.path} · {terminal_log.compact_error(error)}",
        )
        raise
    if response.status_code >= 400:
        terminal_log.log("警告", f"接口返回 HTTP {response.status_code} · {request.method} {request.url.path}")
    return response

_LOCAL_ORIGIN_RE = re.compile(r"^https?://(127\.0\.0\.1|localhost)(:\d+)?$", re.IGNORECASE)


def _is_local_origin(headers) -> bool:
    """校验请求来源：无 Origin/Referer（curl、本地进程）视为本机；否则必须是本机来源。"""
    origin = headers.get("origin") or headers.get("referer") or ""
    return not origin or bool(_LOCAL_ORIGIN_RE.match(origin))


def _as_http(e: Exception, status: int = 400) -> HTTPException:
    return HTTPException(status_code=status, detail=str(e))


def _shutdown_now() -> None:
    """响应发送完成后再退出进程（延迟 0.5s）。"""
    os._exit(0)


def _restart_now(port: int) -> None:
    """等待旧服务释放端口后，用当前 Python 环境重新启动项目。"""
    time.sleep(1.2)
    popen_kwargs = {"cwd": str(PROJECT_ROOT)}
    if os.name == "nt":
        popen_kwargs["creationflags"] = subprocess.DETACHED_PROCESS
    else:
        popen_kwargs["start_new_session"] = True
    subprocess.Popen(
        [sys.executable, str(PROJECT_ROOT / "start.py"), "--no-browser", "--port", str(port)],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
        **popen_kwargs,
    )
    os._exit(0)


@app.post("/api/system/shutdown")
def system_shutdown(request: Request):
    if not _is_local_origin(request.headers):
        raise HTTPException(403, "拒绝来自外部来源的关闭请求")
    terminal_log.log("服务", "收到关闭请求，正在把手头工作收好，马上休息啦")
    threading.Timer(0.5, _shutdown_now).start()
    return {"ok": True, "message": "本地服务正在关闭，可关闭本页面；再次使用时重新运行启动脚本"}


@app.post("/api/system/restart")
def system_restart(request: Request):
    if not _is_local_origin(request.headers):
        raise HTTPException(403, "拒绝来自外部来源的重启请求")
    port = request.url.port
    if not port:
        raise HTTPException(400, "无法确定当前服务端口")
    terminal_log.log("服务", f"收到重启请求 · 将继续使用端口 {port}，稍等我回来～")
    threading.Thread(target=_restart_now, args=(port,), daemon=True).start()
    return {"ok": True, "message": "本地服务正在快速重启"}


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/migration/user-data")
async def migration_user_data(files: list[UploadFile] = File(...), paths: str = Form(...)):
    try:
        return await migration_service.migrate_uploads(files, migration_service.parse_paths(paths))
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e)


# ---------- 分类 ----------


@app.get("/api/categories")
def get_categories():
    return cards_service.list_categories()


@app.post("/api/categories")
def add_category(body: CategoryIn):
    try:
        result = cards_service.create_category(body.name)
        terminal_log.log("分类", f"新分类「{result.get('name') or body.name}」建好了，卡片可以住进来了～")
        return result
    except Exception as e:
        raise _as_http(e)


@app.put("/api/categories")
def rename_category(body: CategoryRename):
    try:
        result = cards_service.rename_category(body.old_name, body.new_name)
        terminal_log.log("分类", f"分类已改名 · 「{body.old_name}」→「{result.get('name') or body.new_name}」")
        return result
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/categories")
def remove_category(name: str):
    try:
        cards_service.delete_category(name)
        terminal_log.log("分类", f"分类「{name}」已删除，相关记录处理完成")
        return {"ok": True}
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e, 404)


@app.put("/api/categories/order")
def set_category_order(body: CategoryOrder):
    result = save_settings({"category_order": body.names})
    terminal_log.log("分类", f"分类顺序已保存 · 共 {len(body.names)} 项")
    return result


@app.put("/api/categories/color")
def set_category_color(body: CategoryColor):
    settings = load_settings()
    colors = settings.get("category_colors") or {}
    colors[body.name] = body.hue
    result = save_settings({"category_colors": colors})
    terminal_log.log("分类", f"分类「{body.name}」的颜色已保存")
    return result


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
        result = cards_service.create_card(body.category, body.name, body.content)
        terminal_log.log("卡片", f"新卡片 <{result['category']}:{result['name']}> 已收好，放到分类最前面了喵")
        return result
    except FileExistsError as e:
        raise _as_http(e, 409)
    except Exception as e:
        raise _as_http(e)


@app.put("/api/cards")
def edit_card(body: CardUpdate):
    try:
        result = cards_service.update_card(
            body.category,
            body.name,
            body.content,
            body.new_category,
            body.new_name,
        )
        terminal_log.log(
            "卡片",
            f"卡片已更新 · <{body.category}:{body.name}> → <{result['category']}:{result['name']}>",
        )
        return result
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/cards")
def remove_card(category: str, name: str):
    try:
        cards_service.delete_card(category, name)
        terminal_log.log("卡片", f"卡片 <{category}:{name}> 已移入回收处理，收拾好了")
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
async def import_cards(file: UploadFile = File(...)):
    data = await file.read()
    try:
        result = cards_service.import_template_xlsx(data)
        terminal_log.log(
            "卡片",
            f"卡片表格导入完成 · 新增 {result.get('imported', 0)} · 跳过 {result.get('skipped', 0)} · 重命名 {result.get('renamed', 0)}",
        )
        for error in result.get("errors") or []:
            terminal_log.log("警告", f"卡片导入有一项没处理好 · {terminal_log.compact_error(error)}")
        return result
    except Exception as e:
        raise _as_http(e)


@app.get("/api/cards/import-template")
def import_template_download():
    try:
        file = cards_service.template_file()
        if not file.exists() or not file.is_file():
            raise HTTPException(404, "导入模板不存在")
        return FileResponse(
            file,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            filename=file.name,
        )
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
        result = cards_service.set_card_image(body.category, body.name, body.path)
        terminal_log.log("卡片", f"卡片 <{body.category}:{body.name}> 的演示图已设置 · {Path(body.path).name}")
        return result
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/cards/image")
def remove_card_image(category: str, name: str):
    try:
        result = cards_service.remove_card_image(category, name)
        terminal_log.log("卡片", f"卡片 <{category}:{name}> 的演示图已移除")
        return result
    except Exception as e:
        raise _as_http(e)


@app.post("/api/cards/pin")
def toggle_card_pin(body: CardPinIn):
    try:
        return cards_service.pin_card_to_front(body.category, body.name)
    except FileNotFoundError as e:
        raise _as_http(e, 404)


# ---------- 工作区 ----------


@app.get("/api/workspace")
def get_workspace():
    return workspace_service.load_workspace()


@app.put("/api/workspace")
def put_workspace(body: WorkspaceIn):
    return workspace_service.save_workspace(body.positive, body.negative, body.back_note or "")


# ---------- 提示词标注词典 ----------


@app.post("/api/dictionary/batch")
def dictionary_batch(body: DictionaryBatchIn):
    return dictionary_service.lookup_batch(body.terms)


@app.post("/api/dictionary/save")
def dictionary_save(body: DictionarySaveIn):
    try:
        return dictionary_service.save_custom(body.term, body.cn)
    except ValueError as e:
        raise _as_http(e, 400)


@app.get("/api/dictionary/status")
def dictionary_status():
    return dictionary_service.status()


@app.post("/api/dictionary/open-folder")
def dictionary_open_folder():
    try:
        return dictionary_service.open_dictionary_folder()
    except Exception as e:
        raise _as_http(e)


# ---------- 设置 ----------


@app.get("/api/settings")
def get_settings():
    settings = load_settings()
    settings.pop("novelai_token", None)  # 敏感凭据绝不返回前端
    return settings


@app.put("/api/settings")
def put_settings(body: dict):
    body.pop("novelai_token", None)  # 仅允许通过专用接口修改 token
    body.pop("hide_backend_panel", None)  # 兼容旧前端：该功能已移除
    result = save_settings(body)
    changed = "、".join(sorted(body)) or "无字段变更"
    terminal_log.log("设置", f"设置已保存 · {changed}，记住啦～")
    return result


# ---------- NovelAI 生成 ----------


@app.get("/api/generate/meta")
def generate_meta():
    return novelai_service.meta()


@app.get("/api/vibes")
def list_vibes():
    return vibes_service.list_vibes()


@app.get("/api/vibes/folders")
def list_vibe_folders():
    return vibes_service.list_vibe_folders()


@app.post("/api/vibes/folders")
def vibe_folder_create(body: VibeFolderIn):
    try:
        return vibes_service.create_vibe_folder(body.name)
    except FileExistsError as e:
        raise _as_http(e, 409)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/vibes/folders/rename")
def vibe_folder_rename(body: VibeFolderRenameIn):
    try:
        return vibes_service.rename_vibe_folder(body.name, body.new_name)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except FileExistsError as e:
        raise _as_http(e, 409)
    except ValueError as e:
        raise _as_http(e, 400)


@app.delete("/api/vibes/folders")
def vibe_folder_delete(name: str):
    try:
        return vibes_service.delete_vibe_folder(name)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


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


@app.post("/api/vibes/import-file")
async def vibe_import_file(file: UploadFile = File(...), folder: str = Form("")):
    try:
        content = await file.read()
        return vibes_service.import_vibe_file_upload(file.filename or "", content, folder)
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
            body.folder,
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
    configured = novelai_service.is_configured()
    terminal_log.log("设置", "NovelAI Token 已安全保存，内容不会出现在日志里；连接状态会由点数查询确认")
    return {"ok": True, "configured": configured}


@app.post("/api/generate/text2image")
def generate_text2image(body: Text2ImageIn):
    params = body.params or {}
    model = str(params.get("model") or "默认模型")
    size = f"{params.get('width') or '?'}×{params.get('height') or '?'}"
    terminal_log.log("生成", f"单张生图开工啦 · {model} · {size}")
    try:
        prompt = cards_service.expand(body.prompt)
        negative_prompt = cards_service.expand(body.negative_prompt)
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
        result = novelai_service.generate_text2image(
            prompt, negative_prompt, params
        )
        terminal_log.log(
            "成功",
            f"单张生图完成，收好啦 · {result.get('name') or result.get('path')} · {result.get('elapsed_ms', 0) / 1000:.1f} 秒",
        )
        return result
    except ValueError as e:
        terminal_log.log("错误", f"单张生图未执行 · {terminal_log.compact_error(e)}")
        raise _as_http(e, 400)
    except RuntimeError as e:
        terminal_log.log("错误", f"单张生图失败 · {terminal_log.compact_error(e)}")
        raise _as_http(e, 502)


# ---------- 批量生成 ----------


@app.get("/api/generate/batch")
def batch_status():
    return batch_service.status()


@app.get("/api/generate/occupancy")
def generation_occupancy():
    """统一展示普通批量、批量卡面与画风探索对生成通道的占用。"""
    batch = batch_service.status()
    if batch.get("active") and batch.get("run"):
        run = batch["run"]
        return {
            "occupied": True,
            "owner": "batch",
            "task_id": run.get("id"),
            "task_name": "普通批量生成",
            "status": run.get("status"),
        }
    reservation = generation_coordinator_service.status().get("reservation")
    if reservation:
        task_name = reservation.get("task_id") or "画风探索任务"
        if reservation.get("owner") == "style_explore":
            try:
                task_name = style_explore_service.get_run(str(reservation.get("task_id"))).get("name") or task_name
            except (FileNotFoundError, ValueError):
                pass
        elif reservation.get("owner") == "batch_cover":
            task_name = "批量卡面"
        task_status = "running"
        if reservation.get("owner") == "batch_cover":
            task_status = (batch_cover_service.status().get("run") or {}).get(
                "status", "running"
            )
        return {
            "occupied": True,
            "owner": reservation.get("owner"),
            "task_id": reservation.get("task_id"),
            "task_name": task_name,
            "status": task_status,
            "acquired_at": reservation.get("acquired_at"),
        }
    return {"occupied": False, "owner": None, "task_id": None, "task_name": None, "status": None}


@app.post("/api/generate/batch")
def batch_start(body: BatchStartIn):
    try:
        generation_coordinator_service.assert_available_for_batch()
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


# ---------- 批量卡面 ----------


@app.get("/api/generate/batch-cover")
def batch_cover_status():
    return batch_cover_service.status()


@app.post("/api/generate/batch-cover")
def batch_cover_start(body: BatchCoverStartIn):
    try:
        return batch_cover_service.start(
            body.base_positive,
            body.negative,
            [dimension.model_dump() for dimension in body.dimensions],
            [card.model_dump() for card in body.shared_cards],
            [card.model_dump() for card in body.target_cards],
            body.params,
            body.stop_anlas,
        )
    except ValueError as error:
        raise _as_http(error, 400)
    except RuntimeError as error:
        raise _as_http(error, 502)


@app.post("/api/generate/batch-cover/pause")
def batch_cover_pause():
    try:
        return batch_cover_service.pause()
    except ValueError as error:
        raise _as_http(error, 400)


@app.post("/api/generate/batch-cover/resume")
def batch_cover_resume():
    try:
        return batch_cover_service.resume()
    except ValueError as error:
        raise _as_http(error, 400)
    except RuntimeError as error:
        raise _as_http(error, 502)


@app.post("/api/generate/batch-cover/end")
def batch_cover_end():
    return batch_cover_service.end()


@app.get("/api/generate/batch-cover/candidates")
def batch_cover_candidates(category: str, name: str):
    try:
        return batch_cover_service.candidates(category, name)
    except ValueError as error:
        raise _as_http(error, 404)


@app.post("/api/generate/batch-cover/assign")
def batch_cover_assign(body: BatchCoverAssignIn):
    try:
        return batch_cover_service.assign(body.category, body.name, body.path)
    except FileNotFoundError as error:
        raise _as_http(error, 404)
    except ValueError as error:
        raise _as_http(error, 400)


@app.post("/api/generate/batch-cover/assign-defaults")
def batch_cover_assign_defaults():
    try:
        return batch_cover_service.assign_defaults()
    except ValueError as error:
        raise _as_http(error, 400)


# ---------- 画风探索（首轮基础设施） ----------


@app.get("/api/style-explore/pools")
def style_explore_pools():
    return style_explore_service.list_pools()


@app.get("/api/style-explore/pools/{pool_id}")
def style_explore_pool(pool_id: str):
    try:
        return style_explore_service.get_pool(pool_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)


@app.post("/api/style-explore/pools")
def style_explore_pool_create(body: StyleExplorePoolIn):
    try:
        return style_explore_service.create_pool(body.name, body.content)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/pools/import")
async def style_explore_pool_import(file: UploadFile = File(...), name: str = Form("")):
    try:
        content = (await file.read()).decode("utf-8-sig")
        return style_explore_service.create_pool(name or Path(file.filename or "ArtistPool").stem, content, file.filename or "")
    except UnicodeDecodeError as e:
        raise _as_http(ValueError("ArtistPool 文件必须为 UTF-8 编码"), 400)
    except ValueError as e:
        raise _as_http(e, 400)


@app.put("/api/style-explore/pools/{pool_id}")
def style_explore_pool_update(pool_id: str, body: StyleExplorePoolUpdateIn):
    try:
        return style_explore_service.update_pool(pool_id, body.content, body.name)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.delete("/api/style-explore/pools/{pool_id}")
def style_explore_pool_delete(pool_id: str):
    try:
        return style_explore_service.delete_pool(pool_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.get("/api/style-explore/pools/{pool_id}/backups")
def style_explore_pool_backups(pool_id: str):
    try:
        return style_explore_service.list_pool_backups(pool_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)


@app.post("/api/style-explore/pools/{pool_id}/backups/restore")
def style_explore_pool_restore_backup(pool_id: str, body: StyleExplorePoolBackupRestoreIn):
    try:
        return style_explore_service.restore_pool_backup(pool_id, body.name)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.get("/api/style-explore/runs")
def style_explore_runs(archived: bool = False):
    return style_explore_service.list_runs(archived)


@app.get("/api/style-explore/runs/{run_id}")
def style_explore_run(run_id: str):
    try:
        return style_explore_service.get_run(run_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs")
def style_explore_run_create(body: StyleExploreRunIn):
    try:
        return style_explore_service.create_run(
            body.pool_id, body.target_count, body.positive, body.negative, body.params, body.algorithm, body.phase, body.name
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.patch("/api/style-explore/runs/{run_id}")
def style_explore_run_rename(run_id: str, body: StyleExploreRunUpdateIn):
    try:
        return style_explore_service.rename_run(run_id, body.name)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/archive")
def style_explore_run_archive(run_id: str, archived: bool = True):
    try:
        return style_explore_service.archive_run(run_id, archived)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.delete("/api/style-explore/runs/{run_id}")
def style_explore_run_delete(run_id: str):
    try:
        return style_explore_service.delete_run(run_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/rounds/basic")
def style_explore_round_append(run_id: str, body: StyleExploreBasicRoundIn):
    try:
        return style_explore_service.append_basic_round(
            run_id, body.target_count, body.positive, body.negative, body.params, body.algorithm
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.put("/api/style-explore/runs/{run_id}/deep/parents")
def style_explore_deep_parents_set(run_id: str, body: StyleExploreDeepParentsIn):
    try:
        return style_explore_service.set_deep_parent_set(
            run_id,
            body.candidate_ids,
            body.custom_artist_strings,
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/deep/branches")
def style_explore_aesthetic_branch_create(run_id: str, body: StyleExploreAestheticBranchIn):
    try:
        return style_explore_service.create_aesthetic_branch(
            run_id,
            body.source_round_id,
            body.name,
            body.candidate_ids,
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.delete("/api/style-explore/runs/{run_id}/deep/families/{family_id}")
def style_explore_deep_family_delete(run_id: str, family_id: str):
    try:
        return style_explore_service.delete_deep_family(run_id, family_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.delete("/api/style-explore/runs/{run_id}/deep/parents/{parent_set_id}")
def style_explore_deep_parent_set_delete(run_id: str, parent_set_id: str):
    try:
        return style_explore_service.delete_deep_parent_set(run_id, parent_set_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/deep/parents/{parent_set_id}/preferences")
def style_explore_deep_preference_record(
    run_id: str,
    parent_set_id: str,
    body: StyleExploreDeepPreferenceIn,
):
    try:
        return style_explore_service.record_deep_preference(
            run_id,
            parent_set_id,
            body.left_parent_id,
            body.right_parent_id,
            body.result,
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/rounds/deep")
def style_explore_deep_round_append(run_id: str, body: StyleExploreDeepRoundIn):
    try:
        return style_explore_service.append_deep_round(
            run_id,
            body.target_count,
            body.positive,
            body.negative,
            body.params,
            body.algorithm,
            body.parent_set_id,
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.delete("/api/style-explore/runs/{run_id}/rounds/deep/{round_id}")
def style_explore_deep_round_delete(run_id: str, round_id: str):
    try:
        return style_explore_service.delete_deep_round(run_id, round_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/retry-failed")
def style_explore_run_retry_failed(run_id: str):
    try:
        return style_explore_service.retry_failed_candidates(run_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/start")
def style_explore_run_start(run_id: str):
    try:
        return style_explore_service.start_run(run_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/pause")
def style_explore_run_pause(run_id: str):
    try:
        return style_explore_service.pause_run(run_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/resume")
def style_explore_run_resume(run_id: str, body: StyleExploreResumeIn):
    try:
        return style_explore_service.resume_run(run_id, body.params)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/cancel")
def style_explore_run_cancel(run_id: str):
    try:
        return style_explore_service.cancel_run(run_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/candidates")
def style_explore_candidates_add(run_id: str, body: StyleExploreCandidatesIn):
    try:
        return style_explore_service.add_candidates(run_id, body.candidates)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.patch("/api/style-explore/runs/{run_id}/candidates/{candidate_id}")
def style_explore_candidate_update(run_id: str, candidate_id: str, body: StyleExploreCandidateUpdateIn):
    try:
        return style_explore_service.update_candidate(run_id, candidate_id, body.model_dump(exclude_none=True))
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/reviews")
def style_explore_reviews_apply(run_id: str, body: StyleExploreReviewsIn):
    try:
        return style_explore_service.apply_candidate_reviews(
            run_id,
            [move.model_dump() for move in body.moves],
        )
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.get("/api/style-explore/runs/{run_id}/image")
def style_explore_candidate_image(run_id: str, candidate_id: str):
    try:
        return FileResponse(style_explore_service.candidate_image_file(run_id, candidate_id))
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/candidates/{candidate_id}/copy-to-library")
def style_explore_candidate_copy_to_library(run_id: str, candidate_id: str):
    try:
        return style_explore_service.copy_candidate_to_library(run_id, candidate_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.delete("/api/style-explore/runs/{run_id}/candidates/{candidate_id}/image")
def style_explore_candidate_delete_image(run_id: str, candidate_id: str):
    try:
        return style_explore_service.delete_candidate_image(run_id, candidate_id)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/style-explore/runs/{run_id}/candidates/{candidate_id}/card")
def style_explore_candidate_create_card(run_id: str, candidate_id: str, body: StyleExploreCandidateCardIn):
    try:
        result = style_explore_service.create_candidate_card(run_id, candidate_id, body.name)
        card = result.get("card") or {}
        terminal_log.log("卡片", f"探索候选 {candidate_id} 已做成卡片 <{card.get('category')}:{card.get('name')}>，灵感收好啦")
        return result
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except FileExistsError as e:
        raise _as_http(e, 409)
    except ValueError as e:
        raise _as_http(e, 400)


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


@app.get("/api/library/thumbnail")
def library_thumbnail(path: str):
    try:
        file = library_service.thumbnail(path)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except ValueError as e:
        raise _as_http(e, 400)
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
        result = library_service.apply_review(
            [move.model_dump() for move in body.moves],
            recycle_reject=body.recycle_reject,
        )
        terminal_log.log(
            "图库",
            f"图库筛选完成 · 已处理 {len(result.get('applied') or [])} 张 · 跳过 {len(result.get('skipped') or [])} 张",
        )
        for skipped in result.get("skipped") or []:
            terminal_log.log(
                "警告",
                f"图片 {Path(str(skipped.get('path') or '未知文件')).name} 没能完成筛选移动 · {terminal_log.compact_error(skipped.get('reason'))}",
            )
        return result
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/review/undo")
def library_review_undo(body: ReviewUndoIn):
    try:
        result = library_service.undo_review(body.token)
        terminal_log.log("图库", f"筛选撤销完成 · 恢复 {len(result.get('restored') or [])} 张 · 失败 {len(result.get('failed') or [])} 张")
        return result
    except ValueError as e:
        raise _as_http(e, 404)


@app.post("/api/library/import")
async def library_import(files: list[UploadFile] = File(...), target: str = Form("unrated")):
    terminal_log.log("图库", f"收到 {len(files)} 张本地图片，开始导入到「{target}」")
    try:
        result = await library_service.import_uploaded_streams(files, target)
        terminal_log.log("图库", f"本地图片导入完成 · 成功 {result.get('imported', 0)} 张 · 跳过 {result.get('skipped', 0)} 张")
        for error in result.get("errors") or []:
            terminal_log.log("警告", f"本地图片有一项没导入 · {terminal_log.compact_error(error)}")
        return result
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/import-urls")
async def library_import_urls(body: ImportUrlsIn):
    terminal_log.log("下载", f"收到 {len(body.urls)} 个网页图片地址，准备下载到「{body.target}」")
    try:
        result = await asyncio.to_thread(library_service.import_remote_urls, body.urls, body.target)
        terminal_log.log("下载", f"网页图片下载完成 · 成功 {result.get('imported', 0)} 张 · 跳过 {result.get('skipped', 0)} 张")
        return result
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/import-path")
def library_import_path(body: ImportPathIn):
    terminal_log.log("图库", f"开始从本地路径导入 · {body.path}")
    try:
        result = library_service.import_from_path(body.path)
        terminal_log.log("图库", f"路径导入完成 · 成功 {result.get('imported', 0)} 张 · 跳过 {result.get('skipped', 0)} 张")
        for error in result.get("errors") or []:
            terminal_log.log("警告", f"路径导入有一项没处理好 · {terminal_log.compact_error(error)}")
        return result
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
        result = library_service.move_images(body.paths, body.target)
        terminal_log.log(
            "移动",
            f"图库移动完成 · 目标「{body.target}」· 成功 {len(result.get('applied') or [])} 张 · 跳过 {len(result.get('skipped') or [])} 张",
        )
        for skipped in result.get("skipped") or []:
            terminal_log.log(
                "警告",
                f"移动失败：{Path(str(skipped.get('path') or '未知文件')).name} 没能移到目标位置 · {terminal_log.compact_error(skipped.get('reason'))}，已记录，稍后看一眼哦",
            )
        return result
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e)


@app.post("/api/library/delete")
def library_delete(body: DeleteImagesIn):
    try:
        result = library_service.delete_images(body.paths)
        terminal_log.log("图库", f"图片清理完成 · 删除 {len(result.get('deleted') or [])} 张 · 跳过 {len(result.get('skipped') or [])} 张")
        return result
    except Exception as e:
        raise _as_http(e)


@app.get("/api/library/covers")
def library_covers():
    return library_service.list_covers()


@app.put("/api/library/covers")
def library_set_cover(body: SetCoverIn):
    try:
        result = library_service.set_cover(body.category, body.path)
        terminal_log.log("图库", f"图库「{body.category}」的封面已换好 · {Path(body.path).name}")
        return result
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/library/covers")
def library_remove_cover(category: str):
    try:
        result = library_service.remove_cover(category)
        terminal_log.log("图库", f"图库「{category}」的自定义封面已移除")
        return result
    except ValueError as e:
        raise _as_http(e, 400)


# ---------- 发布处理 ----------


@app.get("/api/publish/engine")
def publish_engine_status():
    return publish_service.engine_status()


@app.post("/api/publish/engine/install")
def publish_engine_install():
    try:
        return publish_service.install_engine()
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e, 502)


@app.post("/api/publish/engine/local-path")
def publish_engine_local_path(body: PublishEngineLocalPathIn):
    try:
        return publish_service.set_engine_local_path(body.path)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/publish/engine/params")
def publish_engine_params(body: PublishEngineParamsIn):
    try:
        return publish_service.save_engine_params(body.engine, body.params)
    except Exception as e:
        raise _as_http(e)


@app.post("/api/publish/rename-preview")
def publish_rename_preview(body: PublishRenamePreviewIn):
    try:
        return {"samples": publish_service.rename_samples(body.rename)}
    except Exception as e:
        raise _as_http(e)


@app.post("/api/publish/run")
def publish_run(body: PublishRunIn):
    try:
        return publish_service.start_run(
            body.staged,
            body.nodes or {},
            body.rename or {},
            body.engine_params or {},
            body.mosaic_params or {},
        )
    except ValueError as e:
        raise _as_http(e, 400)
    except RuntimeError as e:
        raise _as_http(e, 502)


@app.get("/api/publish/run/{run_id}")
def publish_run_status(run_id: str):
    try:
        return publish_service.run_status(run_id)
    except ValueError as e:
        raise _as_http(e, 404)


@app.post("/api/publish/run/{run_id}/open-folder")
def publish_run_open(run_id: str):
    try:
        return publish_service.open_output_folder(run_id)
    except ValueError as e:
        raise _as_http(e, 404)
    except Exception as e:
        raise _as_http(e)


@app.get("/api/publish/run/{run_id}/file")
def publish_run_file(run_id: str, name: str):
    try:
        file = publish_service.resolve_output_file(run_id, name)
    except ValueError as e:
        raise _as_http(e, 400)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    if not file.exists():
        raise HTTPException(404, "输出文件不存在")
    return FileResponse(file)


@app.delete("/api/publish/run/{run_id}")
def publish_run_delete(run_id: str):
    try:
        return publish_service.delete_run(run_id)
    except ValueError as e:
        raise _as_http(e, 400)


@app.get("/api/publish/staging")
def publish_staging_list():
    return publish_service.list_staging()


@app.post("/api/publish/staging")
def publish_staging_add(body: PublishStageIn):
    try:
        return publish_service.stage_images(body.paths)
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e)


@app.delete("/api/publish/staging")
def publish_staging_remove(name: str):
    try:
        return publish_service.remove_staged(name)
    except ValueError as e:
        raise _as_http(e, 400)


@app.post("/api/publish/staging/clear")
def publish_staging_clear():
    return publish_service.clear_staging()


@app.get("/api/publish/staging/file")
def publish_staging_file(name: str):
    try:
        file = publish_service.resolve_staged_file(name)
    except ValueError as e:
        raise _as_http(e, 400)
    except FileNotFoundError as e:
        raise _as_http(e, 404)
    return FileResponse(file)


# ---------- 发布处理插件 ----------


@app.get("/api/plugins")
def plugins_list():
    try:
        return plugin_service.list_plugins()
    except Exception as e:
        raise _as_http(e)


@app.post("/api/plugins/{plugin_id}/install")
def plugin_install(plugin_id: str):
    try:
        return plugin_service.install_plugin(plugin_id)
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e, 502)


@app.post("/api/plugins/{plugin_id}/uninstall")
def plugin_uninstall(plugin_id: str):
    try:
        return plugin_service.uninstall_plugin(plugin_id)
    except ValueError as e:
        raise _as_http(e, 400)
    except Exception as e:
        raise _as_http(e, 502)


# ---------- 静态前端 ----------

DIST = PROJECT_ROOT / "frontend" / "dist"
if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/")
def index():
    index_file = DIST / "index.html"
    if index_file.exists():
        return FileResponse(index_file, headers={"Cache-Control": "no-cache"})
    return {"message": "backend running; frontend not built yet"}


@app.get("/{full_path:path}")
def spa(full_path: str):
    index_file = DIST / "index.html"
    if index_file.exists() and not full_path.startswith("api/"):
        return FileResponse(index_file, headers={"Cache-Control": "no-cache"})
    raise HTTPException(404, "not found")
