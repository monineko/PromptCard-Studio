# 词典目录说明

这个文件夹用于存放提示词中文标注词典，应用启动时会自动创建。

## 文件

- `custom.json`：用户词典。在提示词块编辑弹窗点「保存到词典」时写入，应用内维护，**不要手工编辑格式**。
- `tags.json`：内置词典（只读），由 DanbooruSearchOnline（DSO）的 `tags_enhanced.csv` 转换而来，
  保留「英文标签名 → 中文名 + 分类」映射（见 `tools/convert_dso_dict.py`），供提示词块中文标注使用。

内置词典的格式是 JSON 对象，值为 `{"cn": 中文名, "category": 卡包分类}`：

```json
{
  "sitting": { "cn": "坐着,坐姿,姿势", "category": "动作" },
  "blue_eyes": { "cn": "蓝眼睛,碧眸", "category": "表情" }
}
```

键为英文提示词（大小写、空格、连字符会自动归一化），中文名内多个同义词用英文逗号分隔。
`category` 是 DSO 标签分类映射到本项目卡包分类后的名称：

| 本项目卡包分类 | DSO 标签分类 |
| --- | --- |
| 角色 | 主体/角色 |
| 动作 | 动作/姿势 |
| 画师串 | 画师 |
| 其他 | 其他 |
| 质量 | 构图/镜头 |
| 场景 | 场景/背景 |
| 表情 | 表情、外貌 |
| 服装 | 服装 |

工作区会依据 `category` 预填提示词块的「备注」（如 `动作`），并把备注框染成该卡包分类的颜色；
`其他` 分类与未命中词典的标签保持灰色，不做颜色区分（可在设置中关闭「自动备注」）。

`custom.json` 仍是 `term -> 中文名` 的扁平格式，用户词条不携带分类，命中后保持灰色。

## 升级 / 迁移项目时

把整个 `dictionary/` 文件夹复制到新项目根目录即可，你的自定义词条不会丢失。

## 重新生成 / 更新内置词典

仓库内置了转换脚本 `tools/convert_dso_dict.py`，可以把 DanbooruSearchOnline 的
`tags_enhanced.csv` 转成 `tags.json`：

```bash
python tools/convert_dso_dict.py <tags_enhanced.csv路径>
```

DSO 作者已确认完全开源标签数据文件，本项目（GPL-3.0）据此随仓库分发该词典；来源声明见根目录 `NOTICE.md`。
生成时请使用作者发布的最新 `tags_enhanced.csv`，保持词典与上游同步。
