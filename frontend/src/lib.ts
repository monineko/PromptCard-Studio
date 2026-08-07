import type { Block, Section } from "./types";

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function categoryHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const el = document.createElement("textarea");
  el.value = text;
  document.body.appendChild(el);
  el.select();
  document.execCommand("copy");
  document.body.removeChild(el);
  return Promise.resolve();
}

/** 把块列表序列化为提示词文本（卡片引用保留 <分类:名称>，展开在服务端完成）。 */
export function serializeBlocks(blocks: Block[]): string {
  const text = blocks
    .map((b) =>
      b.type === "card"
        ? `<${b.category}:${b.name}>`
        : b.weight && b.weight !== 1
          ? `${b.weight}::${b.text}::`
          : b.text
    )
    .join(" ");
  return text.trim() ? text + "," : "";
}

/** 把区域的分区列表序列化为提示词文本。 */
export function serializeSections(sections: Section[]): string {
  return sections
    .map((s) => serializeBlocks(s.blocks))
    .filter(Boolean)
    .join("\n");
}

/**
 * 拆分工作区：名为"角色"的分区视为角色内容，其余为基础提示词。
 * 返回 { base, role } 两部分文本（均保留卡片引用，服务端展开）。
 */
export function splitWorkspaceRole(sections: Section[]): { base: string; role: string } {
  const base: string[] = [];
  const role: string[] = [];
  for (const s of sections) {
    const text = serializeBlocks(s.blocks);
    if (!text.trim()) continue;
    if (s.name === "角色") role.push(text);
    else base.push(text);
  }
  return { base: base.join("\n"), role: role.join("\n") };
}

/**
 * 提取工作区"角色"分区的逐块内容：每张卡片（或提示词块）作为一个独立角色单元，
 * 与 ANR 的 add character 语义一致 —— 一个卡片对应一个角色。
 */
export function extractRoleUnits(sections: Section[]): string[] {
  const role = sections.find((s) => s.name === "角色");
  if (!role) return [];
  return role.blocks
    .map((b) =>
      b.type === "card"
        ? `<${b.category}:${b.name}>`
        : b.weight && b.weight !== 1
          ? `${b.weight}::${b.text}::`
          : b.text
    )
    .map((t) => t.trim())
    .filter(Boolean);
}

export type WeightedTerm = { text: string; weight: number };

/** 顶层按分隔符切分（括号/方括号/花括号内的分隔符不生效）。 */
export function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of input) {
    if ("([{".includes(ch)) depth++;
    else if (")]}".includes(ch)) depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * 按 NovelAI 系数语法分词：
 * - 冒号本身不参与分词（不会把 "::" 当成提示词）；
 * - `2::ibuki,0.5::standing,` 与 `2::ibuki::,0.5::standing::,` 均解析为
 *   ibuki(2) 与 standing(0.5)；
 * - 无系数前缀的段权重为 1。
 */
export function splitWeightedPrompt(input: string): WeightedTerm[] {
  const terms: WeightedTerm[] = [];
  for (const raw of splitTopLevel(input, ",")) {
    let seg = raw.trim();
    if (!seg) continue;
    let weight = 1;
    const m = seg.match(/^(-?\d+(?:\.\d+)?)\s*::(.*)$/s);
    if (m) {
      weight = Math.min(10, Math.max(-10, Number(m[1])));
      seg = m[2];
    }
    // 去掉包裹提示词的成对冒号：2::ibuki:: → ibuki
    if (seg.startsWith("::")) seg = seg.slice(2);
    if (seg.endsWith("::")) seg = seg.slice(0, -2);
    seg = seg.trim();
    if (!seg) continue;
    terms.push({ text: seg, weight });
  }
  return terms;
}

/** 把分词结果规范化为卡片内容文本（带系数的词使用 N::text:: 包裹）。 */
export function normalizePromptTerms(terms: WeightedTerm[]): string {
  return terms.map((t) => (t.weight !== 1 ? `${t.weight}::${t.text}::` : t.text)).join(", ");
}
