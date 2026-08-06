import type { Section } from "./types";

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

/** 把区域的分区列表序列化为提示词文本（卡片引用保留 <分类:名称>，展开在服务端完成）。 */
export function serializeSections(sections: Section[]): string {
  const parts: string[] = [];
  for (const section of sections) {
    if (!section.blocks.length) continue;
    const text =
      section.blocks
        .map((b) =>
          b.type === "card"
            ? `<${b.category}:${b.name}>`
            : b.weight && b.weight !== 1
              ? `${b.weight}::${b.text}::`
              : b.text
        )
        .join(" ") + ",";
    if (text.trim()) parts.push(text);
  }
  return parts.join("\n");
}
