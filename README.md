# PromptCard Studio for NovelAI

一款本地优先的 NovelAI 提示词管理工具。把提示词整理成可复用的「卡片」，在工作区里快速组合、分类、拖拽，管理图片库与参考图 Vibe，并支持卡片组合批量生成和发布前处理（超分降噪 / 数据抹除 / 批量重命名）。下载解压即可使用，所有数据只保存在你自己的电脑上。

## 快速开始

1. 下载并解压本项目（Windows 用户）。
2. 双击 **run.bat**：仅首次需要，自动创建运行环境并安装依赖（之后无需再运行）。
3. 以后每次双击 **start_local.cmd** 启动，浏览器会自动打开 http://127.0.0.1:14419。
4. 停止服务：应用内「设置 → 关闭本地服务」。

脚本说明：

- `run.bat`（Windows）/ `run.sh`（macOS / Linux）：首次初始化，准备环境后自动启动；
- `start_local.cmd`：日常启动入口（Windows），端口被占用时自动更换。

小提示：

- 端口 14419 被占用时会自动更换端口，无需手动设置；
- 使用 NovelAI 生图前，请先在「设置」中填入你的 NovelAI Token（仅保存在本机）。

## 功能模块

- **Prompt 工作区**：分区化块式工作区（提示词工作台 / 角色 / 动作 / 画师串 / 负面置底），卡片引用 + 自由文本块，支持拖拽排序、撤销/重做、提示词分块（自动中文标注）、合成卡片、多选移动、提示词合并、正面/背面切换。
- **Prompt 卡包**：按分类管理卡片，支持置顶；用内置 xlsx 模板批量导入（分类 / 名称 / 提示词 / 图片可选，同名自动加后缀），支持导出 zip。
- **提示词词典**：本地中文标注，按 Danbooru 标签分类自动着色与备注；未知词可手动添加。
- **NovelAI 生图**：单张生成，支持模型 / 分辨率 / 步数 / 采样器 / 负面预设 / 质量词 / Variety / Vibe 参考 / 多角色，参数自动记忆，免费档自动判定。
- **批量生成**：角色 × 动作 × 画师串（可加自定义维度）组合枚举、每卡系数、串行生成、点数停止阈值、断点续跑。
- **图片库**：瀑布流、日期分组、筛选模式（Treasure / Fine / Reject / 收藏）、读取 PNG 信息并完整还原到工作区、快速导入 / 移动 / 删除、分类封面。
- **发布处理**：勾选图片进入独立暂存区，按节点处理：超分降噪（Real-ESRGAN 或 waifu2x-caffe）→ 恢复原数据 → 数据抹除（NovelAI 等读取器读到为空）→ 批量重命名（日期 / 自定义段 / 随机数字段可拖动换序）；输出到 `outputs/` 独立文件夹。
- **Vibe 管理**：参考图 Vibe 库导入、重命名、预览。
- **设置**：主题、背景图、图库路径、NovelAI Token、特效开关、多角色、中文翻译、自动备注等。

## 参考来源

- NovelAI 接口与批量生成参考 **Auto-NovelAI-Refactor（ANR）**（https://github.com/zhulinyv/Auto-NovelAI-Refactor ，GPL-3.0）。依据 GPL-3.0，本项目以 GPL-3.0 整体开源（见 `LICENSE`）。
- 提示词中文词典由 **DanbooruSearchOnline（DSO）** 的标签库转换而来（https://github.com/SuzumiyaAkizuki/DanbooruSearchOnline ，标签数据完全开源）。
- 超分引擎：**Real-ESRGAN**（https://github.com/xinntao/Real-ESRGAN ，BSD-3-Clause，按需下载）；可选 **waifu2x-caffe**（https://github.com/lltcggie/waifu2x-caffe ，MIT，本地路径接入）。

## 隐私与安全

- 应用完全本地运行：除你主动触发的 NovelAI 生成请求外，不会向任何外部服务发送数据；超分引擎仅在勾选时从官方或镜像源下载。
- NovelAI Token 仅保存在本机配置文件中，不会出现在接口响应、日志或提交记录中；配置与全部用户数据目录均已加入 `.gitignore`，不会进入仓库。
- 请勿将你的 Token、配置或本地数据目录提交到任何公开仓库。
