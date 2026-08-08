# NovelAI Prompt Manager

本地优先的 NovelAI 提示词管理与图片整理工具：卡片化的提示词工作区 + 图库整理 + NovelAI 生图（单张 / 批量）。

> 本文档为进度同步版，非最终版。详细规格见 `docs/` 与 `CONTEXT.md`（术语表）。

## 功能模块

- **Prompt 工作区**：分区化块式工作区（提示词工作台 / 角色 / 动作 / 画师串 / 负面），卡片引用 + 自由文本块，拖拽排序、撤销/重做、提示词分块、合成 Card、复制规范化。
- **Prompt 卡包**：分类卡片堆视图（4 列 × 2 行，滚动翻页），卡包弹窗一行 5 卡；卡片按添加顺序排列，支持置顶（移到首位作为封面）；导入（CSV/JSON/ANR 目录）、导出 zip。
- **参数设置（生图）**：模型/分辨率/步数/引导/采样器/调度器/UC 预设/质量词/Variety/Vibe 参考/多角色；参数自动记忆；免费档判定。
- **批量生成**：角色×动作×画师串（可加自定义维度）组合枚举、每卡系数、总张数实时计算、串行生成、点数停止阈值、请求节流与失败重试、断点续跑（暂停/继续/结束）。
- **图片库**：瀑布流、日期分组、筛选模式（Treasure/Fine/Reject/收藏）、PNG 信息读取、**PNG 完整发送到工作区**（还原提示词/角色/参数/临时 Vibe）、快速导入/移动/删除、卡片演示图选择。
- **设置**：主题（明暗/主色/玻璃强度）、背景图、NovelAI Token、特效开关（背景轮换/筛选粒子/筛选动效）、关闭本地服务。
- **发布处理**：预留（M3，暂未开发）。

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

## 目录结构

```
backend/    FastAPI 后端（路由/卡片/工作区/生图/批量/图库/Vibe/PNG 发送）
frontend/   React 18 + TypeScript + Vite + Tailwind v4 + Zustand + framer-motion
docs/       ROADMAP、生图请求规范、批量生成规范、PNG 发送规范、ADR
wildcards/  卡片数据（<分类>/<名称>.txt + 图片/创建时间/顺序元数据）
library/    图片库（分类/日期目录 + 封面）
vibes/      参考图 Vibe 库（.naiv4vibe）
batch_runs/ 批量断点记录
backgrounds/ 背景素材
```

## 文档

- [CONTEXT.md](CONTEXT.md) — 术语表
- [docs/ROADMAP.md](docs/ROADMAP.md) — 里程碑（M1 工作区 / M2 图库 / M3 发布处理 / M4 生图）
- [docs/m4-generation-request.md](docs/m4-generation-request.md) — 生图请求规范
- [docs/m5-batch-generation.md](docs/m5-batch-generation.md) — 批量生图规范
- [docs/png-send-to-workspace.md](docs/png-send-to-workspace.md) — PNG 完整发送规范
- [docs/adr/](docs/adr/) — 架构决策记录

## 参考来源

NovelAI 接口构造、批量生成流程与参数表参考开源项目 **Auto-NovelAI-Refactor（ANR）**（本地镜像：`E:\NAI\ANR\Auto-NovelAI-Refactor-main`，重点见其 `src/generate_images.py`、`utils/models/`、`utils/variable.py`、`utils/generator.py`）。正式开源发布前需按其许可证补充声明。

## 安全

`config.json` 中的 `novelai_token` 仅存本地（已 gitignore），不会出现在接口响应或提交记录中。
