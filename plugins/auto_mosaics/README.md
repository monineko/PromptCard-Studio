# 自动打码插件（auto_mosaics）

为「发布处理」页面提供的可选处理节点：自动检测动漫图片中的敏感部位（欧金金 / 欧芒果 / 欧派派）并按所选方式打码。

## 启用方式

1. 打开「发布处理」页面；
2. 在「可选插件」区域点击「下载并启用」，确认后自动下载检测模型（约 42.5 MB，YOLOv8 ONNX）并安装 ONNX Runtime 依赖；
3. 启用成功后，节点列表出现「自动打码」，勾选后配置部位与打码方式即可随发布流程处理。

卸载插件会删除已下载的模型与启用状态，节点随之消失；插件代码仍在 `plugins/auto_mosaics/`，可随时重新启用。

## 打码方式

- **像素**：把检测区域按「像素大小」做块平均的马赛克；
- **模糊**：对检测区域做高斯模糊；
- **线条**：按检测区域宽高自动选择横/竖线条遮挡，线条颜色随图片亮度自动选黑/白；
- **纯色**：用指定颜色整块覆盖检测区域。

## 检测模型

- 模型：`censor_detect_v1.0_s`（YOLOv8），来自 [deepghs/anime_censor_detection](https://huggingface.co/deepghs/anime_censor_detection)（HuggingFace，MIT 许可）；
- 类别：`nipple_f`（欧派派）、`penis`（欧金金）、`pussy`（欧芒果）；
- 运行时：ONNX Runtime（CPU），检测在本地完成，图片不会上传。

## 依赖与许可

- ONNX Runtime（MIT）：https://github.com/microsoft/onnxruntime
- YOLOv8 / ultralytics（AGPL-3.0，仅用于导出模型）：https://github.com/ultralytics/ultralytics
- 打码算法参考 Auto-NovelAI-Refactor 的 `anr_plugin_auto_mosaics` 插件（GPL-3.0）：https://github.com/zhulinyv/Auto-NovelAI-Refactor

## 常见问题

- **提示「依赖 onnxruntime 安装失败 / No matching distribution found」**：
  1. 先确认运行环境是标准版 Python——free-threading（无 GIL，如 python3.13t）构建没有
     onnxruntime 的预编译 wheel。删除项目根目录的 `.venv` 后重新运行 `run.bat` / `run.sh`，
     启动脚本会自动用标准版 Python 重建运行环境；
  2. 若网络需要代理（如 Clash），请保持代理开启；插件安装时会自动继承系统代理，
     并依次尝试官方源与国内镜像源；
  3. 仍失败时可按提示手动执行 pip 安装命令后重启应用。
