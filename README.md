# Novelai Prompt Manager

本地优先的 NovelAI 提示词管理与图片整理工具。v1 包含**提示词工作区**（M1）与**图片库**（M2，规划中），纯本地运行，不接入 NovelAI API；提示词以"分类 + 卡片"形式管理，兼容 ANR 的 wildcards 目录结构（`<分类>/<名称>.txt`）。

## 快速开始（用户）

只需要安装 Python 3.10+：

- Windows：双击 `run.bat`，自动创建虚拟环境、安装依赖并启动，浏览器自动打开 http://127.0.0.1:11451
- macOS / Linux：终端执行 `bash run.sh`

> 首次运行时若前端尚未构建，脚本会自动调用 Node.js 构建（需要提前安装 Node.js）。发行版会直接内置构建产物，用户无需 Node。

## 开发者模式

```bash
# 后端
.venv\Scripts\activate          # Windows
python -m uvicorn app.main:app --app-dir backend --port 11451 --reload

# 前端（另开终端）
cd frontend
npm install
npm run dev                     # http://127.0.0.1:5173，API 自动代理到后端
npm run build                   # 构建产物输出到 frontend/dist，由后端托管
```

## M1 功能

- 卡片分类管理：新建/重命名/删除分类与卡片（删除进回收站），即时生效无需刷新
- 块式工作区：正面/负面两个区域，卡片引用（实时关联）+ 自由文本块，拖拽排序、悬停高亮、撤销/重做、一键清空
- 复制规范化：块间以英文逗号连接、卡片引用展开为完整内容、嵌套引用 `<分类:名称>` 递归展开（带循环检测）
- 自动分块：粘贴时按逗号自动拆分（可开关），或手动拆分自由文本块
- 导入导出：CSV 模板 / JSON / ANR wildcards 目录 / zip 导出
- 主题：明暗模式、主色、玻璃强度、自定义样式

## 目录结构

```
backend/    FastAPI 后端（卡片/工作区/设置 API）
frontend/   React + TypeScript 前端（Vite + Tailwind + Framer Motion）
dist/       前端构建产物（发行时随仓库提供）
wildcards/  卡片数据 <分类>/<名称>.txt
library/    图片库（M2）
docs/       设计文档（CONTEXT 术语表、ROADMAP、ADR）
```

## 文档

- [CONTEXT.md](CONTEXT.md) — 术语表
- [docs/ROADMAP.md](docs/ROADMAP.md) — 里程碑与 M1 验收标准
- [docs/adr/](docs/adr/) — 架构决策记录
