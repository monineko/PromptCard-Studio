# M4 生图请求规范（含多角色控制）

> 依据：官网出图 PNG 元数据对比（无角色 vs Add Character 放入 Char1）+ ANR 源码。
> 用途：明确后端 `POST /api/generate/text2image` 的请求语义，多角色逻辑不依赖前端具体形态。

## 1. 请求体

```json
{
  "prompt": "<基础正面提示词>",
  "negative_prompt": "<用户负面词>",
  "params": {
    "model": "nai-diffusion-4-5-full",
    "...": "其他生成参数",
    "characters": [
      {
        "positive": "no_lineart, ibuki_(blue_archive), 1girl, ...",
        "negative": "",
        "center": { "x": 0.5, "y": 0.5 }
      }
    ]
  }
}
```

## 2. 核心规则（官网元数据实证）

- **基础提示词（`prompt` / `v4_prompt.caption.base_caption`）必须排除全部角色词**。官网"Add Character"后，主提示词只保留动作、画师串等非角色内容；角色词整体移入角色槽。
- 每个角色一条 `char_captions` 记录：
  - 正面：`v4_prompt.caption.char_captions[i].char_caption`
  - 负面：`v4_negative_prompt.caption.char_captions[i].char_caption`（可为空字符串，但条目必须存在）
  - 位置：`centers: [{ "x": 0.5, "y": 0.5 }]`（默认画面中心；ANR 的 A1~E5 映射到 0.1~0.9）
- 请求同时携带 `parameters.characterPrompts`（`[{ prompt, uc, center, enabled: true }]`，ANR 必发；服务端回写元数据不回显该字段，但请求需要）。
- `v4_prompt` 使用 `use_coords: true`、`use_order: true`。

## 3. 模型支持

- 支持角色：`nai-diffusion-4-5-full`、`nai-diffusion-4-5-curated`、`nai-diffusion-4-full`、`nai-diffusion-4-curated-preview`。
- 不支持角色：`nai-diffusion-3`、`nai-diffusion-furry-3`（ANR 对这两类模型固定 `characterPrompts: []`，无 char_captions 字段）。

## 4. 后端职责

- `backend/app/novelai.py::build_text2image_payload`：把 `params.characters` 映射进 `v4_prompt/v4_negative_prompt.char_captions` 与 `characterPrompts`；角色词不进入 `input` / `base_caption`（由前端保证主提示词已分离，后端不额外拆分）。
- `cards.expand` 会展开基础提示词与角色文本中的 `<分类:名称>` 引用后再发送。

## 5. 前端角色槽语义（当前实现）

- 基础提示词 = 工作区正面/负面区内容，**排除名为"角色"的分区**。
- 角色提示词 = 生成面板"角色提示词"区的角色卡片（正向/负向文本框）。
- 工作区中旧"角色"分区的卡片引用会自动作为角色 1 的初始内容（一次性填充，避免历史数据丢失）。

## 6. Vibe 请求（2026-08-08 起）

- 资源：`vibes/*.naiv4vibe`（JSON：`encodings[模型键][哈希] = {encoding, params.information_extracted}`；显示名取文件名）。
- 枚举：`GET /api/vibes` 返回 id/name/thumbnail/models/默认强度与信息提取度/各模型可用变体。
- 管理：`POST /api/vibes/rename`（重命名文件，文件名即显示名）、`POST /api/vibes/open-folder`（资源管理器打开目录）。
- 请求：`params.vibes = [{ id, strength, information_extracted }]`；后端按当前模型选最接近的编码并写入：
  - `parameters.reference_image_multiple`（base64 编码）
  - `parameters.reference_strength_multiple`（0.01~1）
  - `parameters.reference_information_extracted_multiple`（0.01~1，文件版 Vibe 可调）
- 实证：官网带 Vibe 出图元数据中 `reference_information_extracted_multiple` 为空、仅强度可调（图片元数据版）；`.naiv4vibe` 文件版可同时调整两项。已用「平开学狐狸」免费参数实测：请求三字段均被官网回写，点数不扣。
- 模型映射键：`v4-5full / v4-5curated / v4full / v4curated`（ANR model_vibe_map）。

## 7. 分辨率分类（2026-08-08 起）

| 类别 | 预设 |
| --- | --- |
| NORMAL | Portrait 832×1216（免费）、Landscape 1216×832、Square 1024×1024 |
| LARGE | Portrait 1024×1536、Landscape 1536×1024、Normal Landscape 1472×1472 |
| WALLPAPER | Portrait 1088×1920、Landscape 1920×1088 |
| SMALL | Portrait 512×768（免费）、Landscape 768×512（免费）、Square 640×640（免费） |
| CUSTOM | 任意宽高（64 的倍数，后端 `return_x64` 对齐） |

前端：悬停弹出横向分类窗选择预设；分辨率旁双数字输入框直接改数即切换为 Custom。
