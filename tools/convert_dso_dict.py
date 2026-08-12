"""把 DanbooruSearchOnline 的 tags_enhanced.csv 转换为本地词典 dictionary/tags.json。

由 DanbooruSearchOnline（DSO）的 tags_enhanced.csv 转换精简词典，供提示词块中文标注使用。
DSO 作者已确认完全开源标签数据文件，本项目（GPL-3.0）随仓库分发该词典；来源声明见 NOTICE.md。

输出格式（含分类）：
    {"term": {"cn": "中文名", "category": "角色"}}
其中 category 是 DSO 标签分类映射到本项目卡包分类后的名称（角色/动作/画师串/负面/质量/场景/表情/服装）。

用法：
    python tools/convert_dso_dict.py <tags_enhanced.csv路径> [输出路径]
    默认输出到项目根目录 dictionary/tags.json；分类数据默认读取 CSV 同目录的 tag_groups.json。

可选参数：
    --min-post-count N   只保留发帖量 >= N 的标签（默认 100，与 DSO 收录口径一致）
    --groups-path PATH   指定 tag_groups.json 路径（默认取 CSV 同目录）
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from pathlib import Path


# DSO（prompt_import.py）的 Tag Group -> 中文分类规则，保持与 DSO 一致的分类优先级：
# 更具体的 Tag Group 先于宽泛的外貌/表情集合。
GROUP_RULES: dict[str, set[str]] = {
    "主体/角色": {
        "tag_group:birds", "tag_group:cats", "tag_group:character_count",
        "tag_group:dogs", "tag_group:family_relationships", "tag_group:groups",
        "tag_group:jobs", "tag_group:legendary_creatures", "tag_group:people",
    },
    "服装": {
        "tag_group:accessories", "tag_group:attire", "tag_group:eyewear",
        "tag_group:fashion_style", "tag_group:handwear", "tag_group:headwear",
        "tag_group:legwear", "tag_group:neck_and_neckwear", "tag_group:nudity",
        "tag_group:patterns", "tag_group:sexual_attire", "tag_group:sleeves",
    },
    "动作/姿势": {
        "tag_group:bdsm_and_torture", "tag_group:covering", "tag_group:dances",
        "tag_group:gestures", "tag_group:holding_tags", "tag_group:posture",
        "tag_group:sex_acts", "tag_group:sexual_positions",
        "tag_group:simulated_sex_acts", "tag_group:sports",
        "tag_group:verbs_and_gerunds",
    },
    "场景/背景": {
        "tag_group:backgrounds", "tag_group:fire", "tag_group:flowers",
        "tag_group:holidays_and_celebrations", "tag_group:lighting",
        "tag_group:locations", "tag_group:real_world_locations",
        "tag_group:theme", "tag_group:water",
    },
    "构图/镜头": {
        "tag_group:artistic_license", "tag_group:focus_tags",
        "tag_group:image_composition", "tag_group:visual_aesthetic",
    },
    "外貌": {
        "tag_group:ass", "tag_group:body_parts", "tag_group:breasts_tags",
        "tag_group:ears_tags", "tag_group:eyes_tags", "tag_group:feet",
        "tag_group:hair", "tag_group:hair_color", "tag_group:hair_styles",
        "tag_group:hands", "tag_group:makeup", "tag_group:piercings",
        "tag_group:pussy", "tag_group:shoulders", "tag_group:skin_color",
        "tag_group:wings",
    },
    "表情": {"tag_group:face_tags"},
}

CLASSIFICATION_PRIORITY = (
    "主体/角色",
    "服装",
    "动作/姿势",
    "场景/背景",
    "构图/镜头",
    "外貌",
    "表情",
)

# DSO 标签分类 -> 本项目卡包分类（卡包为主；外貌并入表情，其他保留为“其他”，灰色不着色）
DSO_TO_CARD_CATEGORY = {
    "主体/角色": "角色",
    "动作/姿势": "动作",
    "画师": "画师串",
    "其他": "其他",
    "构图/镜头": "质量",
    "场景/背景": "场景",
    "表情": "表情",
    "外貌": "表情",
    "服装": "服装",
}


def classify_dso(category_num: str, groups: list[str] | set[str]) -> str:
    """按 DSO 的 classify_workspace_tag 逻辑返回中文标签分类。"""
    if category_num == "4":  # Danbooru Character
        return "主体/角色"
    matched = set(groups)
    for dim in CLASSIFICATION_PRIORITY:
        if matched.intersection(GROUP_RULES[dim]):
            return dim
    return "其他"


def main() -> int:
    parser = argparse.ArgumentParser(description="转换 tags_enhanced.csv 为本地词典 JSON")
    parser.add_argument("csv_path", help="tags_enhanced.csv 路径")
    parser.add_argument("out_path", nargs="?", default=None, help="输出 JSON 路径（默认 dictionary/tags.json）")
    parser.add_argument("--min-post-count", type=int, default=100, help="最小发帖量过滤（默认 100）")
    parser.add_argument("--groups-path", default=None, help="tag_groups.json 路径（默认取 CSV 同目录）")
    args = parser.parse_args()

    csv_file = Path(args.csv_path)
    if not csv_file.exists():
        print(f"找不到文件: {csv_file}", file=sys.stderr)
        return 1

    out_file = Path(args.out_path) if args.out_path else Path(__file__).resolve().parents[1] / "dictionary" / "tags.json"
    out_file.parent.mkdir(parents=True, exist_ok=True)

    raw = csv_file.read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("gb18030")  # DSO 发布的中文 CSV 可能是 GBK/GB18030 编码

    groups_path = Path(args.groups_path) if args.groups_path else csv_file.parent / "tag_groups.json"
    tag_to_groups: dict[str, list[str]] = {}
    if groups_path.exists():
        try:
            groups_data = json.loads(groups_path.read_text(encoding="utf-8"))
            tag_to_groups = groups_data.get("tag_to_groups") or {}
        except Exception as e:
            print(f"警告：读取 tag_groups.json 失败，将不写入分类：{e}", file=sys.stderr)

    table: dict[str, dict[str, str]] = {}
    with io.StringIO(text, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get("name") or "").strip()
            cn = (row.get("cn_name") or "").strip()
            if not name or not cn:
                continue
            try:
                post_count = int(row.get("post_count") or 0)
            except ValueError:
                post_count = 0
            if post_count < args.min_post_count:
                continue
            if tag_to_groups:
                dso_cat = classify_dso(
                    (row.get("category") or "").strip(),
                    tag_to_groups.get(name) or [],
                )
                card_cat = DSO_TO_CARD_CATEGORY.get(dso_cat, "")
                table[name] = {"cn": cn, "category": card_cat}
            else:
                table[name] = {"cn": cn}

    out_file.write_text(json.dumps(table, ensure_ascii=False, indent=0, separators=(",", ":")), encoding="utf-8")
    print(f"已转换 {len(table)} 条 → {out_file}" + ("（含分类）" if tag_to_groups else ""))
    print("提示：词典来源于 DanbooruSearchOnline 标签库（已获作者开源授权），声明见 NOTICE.md。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
