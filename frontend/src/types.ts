export type PromptBlock = { id: string; type: "prompt"; text: string; weight?: number };
export type CardBlock = { id: string; type: "card"; category: string; name: string };
export type Block = PromptBlock | CardBlock;
export type Zone = "positive" | "negative";

export type Section = {
  id: string;
  name: string;
  locked: boolean;
  blocks: Block[];
};

export type CardMeta = { name: string; preview: string; updated: number };
export type Category = { name: string; count: number; cards: CardMeta[]; color?: number | null };

export type ThemeState = {
  mode: "light" | "dark";
  accent: string;
  glass: number;
};

export type Settings = {
  theme: ThemeState;
  library_path: string;
  format_input: boolean;
  port: number;
};
