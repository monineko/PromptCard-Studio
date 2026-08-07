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
