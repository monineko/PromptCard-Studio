# PromptCard Studio for NovelAI

本地优先的 NovelAI 提示词分类管理工具，一切围绕「卡片」：把提示词拆成可复用、可分类的 **PromptCard**，在工作区里快速解析、分块、组合，用舒适的拖拽 / 选取 / 分类交互管理卡片、图库与 Vibe，并支持卡片组合批量生成与发布前处理（超分降噪 / 数据抹除 / 批量重命名）。

## 功能模块

- **Prompt 工作区**：分区化块式工作区（提示词工作台 / 角色 / 动作 / 画师串 / 负面置底），卡片引用 + 自由文本块，拖拽排序、撤销/重做、提示词分块（分块后自动本地词典中文标注）、合成 Card、多选整组移动、分区复制/清空、提示词合并、复制正面、正面/背面切换（背面为自由文本区）。
- **Prompt 卡包**：分类卡片堆视图，卡片按添加顺序排列，支持置顶；批量导入使用内置 xlsx 模板（分类/名称/提示词/图片可选，仅第 1 行表头，分类自动创建，同名自动加后缀（1），图片复制进图库并自动设为演示图）；支持导出 zip。
- **提示词词典**：本地中文标注（`dictionary/`），DSO 标签分类映射到卡包分类；查词自动按分类着色并预填备注（可关闭）；未知词可手动填写保存。
- **NovelAI 生图**：单张生成，支持模型/分辨率/步数/引导/采样器/调度器/UC 预设/质量词/Variety/Vibe 参考/多角色；参数自动记忆；免费档判定；Token 仅存本地。
- **批量生成**：角色 × 动作 × 画师串（可加自定义维度）组合枚举、每卡系数、总张数实时计算、串行生成、点数停止阈值、请求节流与失败重试、断点续跑（暂停/继续/结束）。
- **图片库**：瀑布流、日期分组、筛选模式（Treasure / Fine / Reject / 收藏）、PNG 信息读取、**PNG 完整发送到工作区**（还原提示词/角色/参数/临时 Vibe）、快速导入/移动/删除、分类封面、卡片演示图选择。
- **发布处理**：独立页面 + 发布暂存区（`publish_staging/`，与图库隔离）。图库勾选图片后点「快捷选取 → 发布处理」，图片以硬链接秒级复制进暂存区（图库原图不动），仅提示成功；发布页可预览、删除、清空暂存图片，也可「添加图片」回到图库继续勾选。勾选节点后开始处理，节点固定顺序：**超分降噪 → 恢复原数据 → 数据抹除 → 批量重命名**：
  - **超分降噪**：插件式引擎——内置 Real-ESRGAN（ncnn-Vulkan，可自动下载）与 waifu2x-caffe（本地路径），按可执行文件名自动识别，参数面板按对应引擎清单渲染；引擎输出会抹掉 PNG 元数据但文件名不变。
  - **恢复原数据**：仅在勾选超分后可用；超分前提取 PNG 元数据、超分后写回，只想要超分但保留提示词/参数时使用。与数据抹除互斥。
  - **数据抹除**：以全 null 占位覆写 PNG 元数据（NovelAI 官网等按字段读取的读取器会读到空），像素不变并自动校验；JPEG 同时清除 EXIF/XMP 段；未勾选重命名时文件名改为随机中性名，隐藏文件名里的提示词。
  - **批量重命名**：日期（可选，YYYYMMDD）_ 自定义段（可选）_ 随机数字段（6 位）三部分，可拖动换序并实时预览命名效果；默认「日期_随机数字段」，随机段避免同日多次输出重名。
  - 处理全程有进度条提示；每次处理输出到独立文件夹 `outputs/<时间戳>-<随机>/`，完成后点「打开输出文件」直接查看，图库与暂存区原图都不受影响。
- **Vibe 管理**：参考图 Vibe 库（`.naiv4vibe`）导入、重命名、预览。
- **设置**：主题（明暗/主色/玻璃强度）、背景图、图库路径、NovelAI Token、特效开关（背景轮换/筛选粒子/筛选动效）、多角色开关、显示中文翻译开关、自动备注开关、关闭本地服务。

## 快速开始

Windows：双击 `start_local.cmd`（后端完全隐藏，健康检查通过后自动打开 http://127.0.0.1:11451；停止可在设置页「关闭本地服务」）。
也可使用 `run.bat` / `run.sh`（自动创建虚拟环境并启动）。前端构建产物已内置，无需 Node。

## 开发

```bash
# 后端
.venv\Scripts\activate
python -m uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 11451

# 前端（另开终端）
cd frontend
npm install
npm run dev        # 热更新，代理到后端
npm run build      # 产物输出 frontend/dist，由后端托管
```

后端自测：`python backend/tests/test_library.py`、`python backend/tests/test_publish.py`。

## 目录结构

```
backend/    FastAPI 后端（路由/卡片/工作区/词典/生图/批量/图库/Vibe/PNG 发送/发布处理）
frontend/   React 18 + TypeScript + Vite + Tailwind v4 + Zustand + framer-motion
docs/       ROADMAP、生图请求规范、批量生成规范、PNG 发送规范、ADR
templates/  卡片导入模板（xlsx）
wildcards/  卡片数据（<分类>/<名称>.txt + 图片/创建时间/顺序/置顶元数据）
library/    图片库（<前缀>/<前缀>-<日期>/ 目录 + 封面）
vibes/      参考图 Vibe 库（.naiv4vibe）
batch_runs/ 批量断点记录（gitignore）
publish_runs/ 发布处理运行内部暂存（gitignore）
publish_staging/ 发布处理用户暂存区（gitignore）
outputs/    发布处理输出（按时间-随机命名独立文件夹，gitignore）
engines/    超分引擎清单（backend/app/engines/）与运行时下载（engines/runtime/，gitignore）
backgrounds/ 背景素材
dictionary/ 提示词中文标注词典（tags.json 内置 / custom.json 用户词条）
tools/      辅助脚本（个人使用）
```

## 文档

- [CONTEXT.md](CONTEXT.md) — 术语表
- [docs/ROADMAP.md](docs/ROADMAP.md) — 里程碑（M1 工作区 / M2 图库 / M3 发布处理 / M4 生图）
- [docs/m4-generation-request.md](docs/m4-generation-request.md) — 生图请求规范
- [docs/m5-batch-generation.md](docs/m5-batch-generation.md) — 批量生图规范
- [docs/png-send-to-workspace.md](docs/png-send-to-workspace.md) — PNG 完整发送规范
- [docs/adr/](docs/adr/) — 架构决策记录

## 参考来源

NovelAI 接口构造、批量生成流程与参数表参考开源项目 **Auto-NovelAI-Refactor（ANR）**（仓库：https://github.com/zhulinyv/Auto-NovelAI-Refactor ，GPL-3.0）。依据 GPL-3.0，本项目以 GPL-3.0 整体开源（见根目录 `LICENSE`），归属与声明详见 `NOTICE.md`。

提示词中文标注使用本地词典（`dictionary/tags.json`），词典由 **DanbooruSearchOnline（DSO）** 的标签库转换而来
（DSO 作者已确认完全开源标签数据文件，来源与参考声明见 `NOTICE.md`）；本项目同时参考了 DSO 的提示词分区逻辑与单词块结构。

超分引擎使用开源项目 **Real-ESRGAN**（ncnn-Vulkan 预编译版，https://github.com/xinntao/Real-ESRGAN ，BSD-3-Clause），仅在用户勾选超分节点时按需下载，不随仓库分发。

本地超分引擎可选 **waifu2x-caffe**（https://github.com/lltcggie/waifu2x-caffe ，MIT），由用户自备程序与模型，通过「指定本地引擎路径」接入。

## 安全

`config.json` 中的 `novelai_token` 仅存本地（已 gitignore），不会出现在接口响应或提交记录中。
