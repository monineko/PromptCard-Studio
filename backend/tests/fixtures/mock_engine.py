"""测试用假超分引擎：接受 realesrgan-ncnn-vulkan 风格参数，仅复制输入到输出。"""

import shutil
import sys

args = sys.argv[1:]
input_path = output_path = None
for i, a in enumerate(args):
    if a == "-i" and i + 1 < len(args):
        input_path = args[i + 1]
    elif a == "-o" and i + 1 < len(args):
        output_path = args[i + 1]
if not input_path or not output_path:
    print("missing -i/-o", file=sys.stderr)
    sys.exit(1)
shutil.copyfile(input_path, output_path)
print("mock upscale ok")
