# PNG 信息 → 工作区完整发送

> 图库功能：读取 PNG 信息后，把图片的全部可恢复内容发送到工作区与生成参数，而不是只发正负提示词。

## 1. 还原内容

- **工作区**：
  - 正面基础（`v4_prompt.caption.base_caption`，v3 用顶层 `prompt`）→ 清空后放入「提示词工作台」；
  - 角色（`char_captions`，反转义 `\(` `\)` `\,`）→ 清空后逐条放入正面区「角色」分区；
  - 角色负面（非空时）→ 放入负面区「角色」分区（与正面角色逐条对齐，供生成面板使用）；
  - 负面（`v4_negative_prompt.caption.base_caption` / `uc`）→ 清空后放入「负面」分区。
- **生成参数**（写入 `npm_generate_params`，立即生效并持久化）：
  `steps / width / height / scale / cfg_rescale / sampler / noise_schedule / seed / sm / sm_dyn / decrisp（dynamic_thresholding）/ legacy_uc / variety（存在 skip_cfg_above_sigma 即开）/ quality_toggle / furry_mode（fur dataset 前缀）/ uc_preset（推断）`。
  - 模型不在 PNG 元数据中，保持当前选择。
  - 质量词：命中当前模型 `QUALITY_TAGS` 后缀则剥离并开启开关；未命中则保留原文并关闭开关（避免重复追加）。
  - 负面预设：官方元数据会把 uc 中的逗号去掉，按归一化文本匹配 `UNDESIRED_PRESETS` 前缀，推断出 `uc_preset` 与用户负面。
- **Vibe**：直接把 `reference_image_multiple` 编码作为**临时 Vibe** 放入参数区（缩略图即元数据中的 base64 编码，无需匹配库文件），生成时直接携带编码请求；**不会自动写入 `vibes/` 库**。用户可在参数面板点「存入库」主动保存（`POST /api/vibes/import`）。
- **无完整 JSON 的图片**（外部导入、无元数据）：无法还原提示词/参数/Vibe；发送按钮不会出现，弹窗提示该图片不含完整元数据。

## 2. 交互

- 点击「发送到工作区」打开项目内居中弹窗（不再使用浏览器 confirm），警告会替换工作区现有全部提示词，并列出将恢复的参数与 Vibe；确认后才执行。
- 执行后：工作区可 Ctrl+Z 撤销；参数写入生成参数；跳回提示词工作区。

## 3. 接口

`POST /api/generate/from-png`

```json
{ "png": { "…": "完整 PNG Comment JSON" }, "model": "nai-diffusion-4-5-full" }
```

返回 `{ positive, negative, uc_preset, characters[], params{}, vibes[] }`；vibes 为临时条目（含 `encoding`）。

实现：`backend/app/png_send.py`、`vibes.py::import_vibe_file`、`novelai.py`（临时编码直传）；前端 `components/gallery/SendToWorkspaceModal.tsx`、`store.ts::overwriteZonesFromPng`。
