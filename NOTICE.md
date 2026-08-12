# NOTICE

本项目的开源合规声明（对应根目录 `LICENSE`，GPL-3.0）。

## 参考与借鉴来源

### Auto-NovelAI-Refactor（ANR）

- 仓库：https://github.com/zhulinyv/Auto-NovelAI-Refactor
- 协议：GPL-3.0（`pyproject.toml` 与 `LICENSE` 均为 GPL-3.0）
- 本项目在以下方面参考了 ANR 的设计与实现：NovelAI 请求体构造、批量生成主流程（组合枚举、冷却节流、停止条件）、参数表结构。
- 依据 GPL-3.0 第 5~6 条，本项目以 GPL-3.0 整体开源，保留本声明即可，无需另行向作者申请授权。

## DanbooruSearchOnline（DSO）

- 仓库：https://github.com/SuzumiyaAkizuki/DanbooruSearchOnline
- 本项目参考了 DSO 的提示词分区/分组逻辑与单词块结构形式，并在 UI 上借鉴了其提示词块的中文标注展示形态。
- DSO 作者本人维护标签库，并已确认完全开源标签数据文件；本项目据此将 DSO 的
  `tags_enhanced.csv` 转换为精简词典 `dictionary/tags.json`（仅保留 英文标签名 -> 中文名 映射，供提示词块中文标注使用）。
- 依据本项目 GPL-3.0 协议，词典数据随仓库一并开源，并保留上述来源声明。

## 提示词中文标注词典

为给提示词块提供本地中文标注，本项目的词典机制支持在 `dictionary/` 文件夹放置
`tags.json`（内置词典，只读）与 `custom.json`（用户词典，应用内写入）。

- `tags.json`：由 DSO 的 `tags_enhanced.csv` 转换而来（`name` + `cn_name` 两列），随仓库分发；
- `custom.json`：应用内「保存到词典」写入的用户词条，属个人数据，不提交仓库。

转换脚本见 `tools/convert_dso_dict.py`，格式与更新方式见 `dictionary/README.md`。

## 其他

- Danbooru 标签数据的官方 API 与站点条款请在自行抓取前确认。
- 本声明只覆盖来源归属；具体权利与义务以各来源的授权条款为准。
