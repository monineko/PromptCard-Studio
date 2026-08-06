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
  recycle_reject: boolean;
  format_input: boolean;
  port: number;
};

export type LibraryCategoryKey = "all" | "treasure" | "fine" | "reject" | "favorites" | "unrated";

export type LibraryCategoryInfo = {
  key: LibraryCategoryKey;
  label: string;
  count: number;
  folder?: string | null;
};

export type LibrarySummary = {
  categories: LibraryCategoryInfo[];
  library_path: string;
};

export type LibraryImageItem = {
  path: string;
  name: string;
  category: LibraryCategoryKey;
  date: string;
  size: number;
  mtime: number;
  width: number;
  height: number;
};

export type LibraryImages = {
  category: LibraryCategoryKey;
  items: LibraryImageItem[];
  total: number;
};

export type PngSummary = {
  prompt?: string | null;
  uc?: string | null;
  width?: number | null;
  height?: number | null;
  seed?: number | string | null;
  sampler?: string | null;
  steps?: number | null;
  scale?: number | null;
  sm?: boolean | null;
  sm_dyn?: boolean | null;
  noise_schedule?: string | null;
  legacy_uc?: boolean | null;
};

export type PngInfoResult = {
  ok: boolean;
  parsed: Record<string, unknown> | null;
  raw: string | null;
  summary: PngSummary | null;
  width: number;
  height: number;
  source?: string | null;
  software?: string | null;
  generation_time?: string | null;
};

export type ReviewTag = "treasure" | "fine" | "reject" | "favorites";

export type ReviewApplyResult = {
  ok: boolean;
  applied: { path: string; tag: string; dest: string | null; undoable: boolean }[];
  skipped: { path: string; tag: string; reason: string }[];
  undo_token: string | null;
  message: string;
};

export type ImportResult = {
  imported: number;
  skipped: number;
  errors: string[];
};
