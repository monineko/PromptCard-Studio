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

export type CardMeta = { name: string; preview: string; updated: number; image?: string | null };
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
  effects: {
    background_rotation: boolean;
    review_particles: boolean;
    review_animations: boolean;
  };
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

export type MoveImagesResult = {
  ok: boolean;
  applied: { path: string; dest: string }[];
  skipped: { path: string; reason: string }[];
  undo_token: string | null;
  message: string;
};

export type GenerateResolution = {
  label: string;
  category: string;
  width: number;
  height: number;
  free: boolean;
};

export type GenerateModelRules = {
  samplers: string[];
  noise_schedules: string[];
  uc_presets: string[];
  features: {
    sm: boolean;
    decrisp: boolean;
    legacy_uc: boolean;
    furry: boolean;
    characters: boolean;
  };
};

export type GenerateMeta = {
  models: string[];
  samplers: string[];
  noise_schedules: string[];
  uc_presets: string[];
  resolutions: GenerateResolution[];
  model_rules: Record<string, GenerateModelRules>;
  free: { max_steps: number; resolutions: string[]; n_samples: number };
  quality_tags: Record<string, string>;
};

export type GenerateStatus = {
  configured: boolean;
  anlas: number | null;
  anlas_error: string | null;
};

export type GenerateParamsPayload = {
  model: string;
  width: number;
  height: number;
  steps: number;
  scale: number;
  cfg_rescale: number;
  sampler: string;
  noise_schedule: string;
  seed: number;
  uc_preset: string;
  quality_toggle: boolean;
  variety: boolean;
  sm: boolean;
  sm_dyn: boolean;
  decrisp: boolean;
  legacy_uc: boolean;
  furry_mode: boolean;
};

export type GenerateVibe = {
  id: string;
  name: string;
  thumbnail: string;
  strength: number;
  information_extracted: number;
  /** 来自 PNG 的临时 Vibe：直接携带编码，不依赖库文件 */
  encoding?: string;
};

export type VibeItem = {
  id: string;
  name: string;
  file: string;
  thumbnail: string;
  models: string[];
  default_strength: number;
  default_information_extracted: number;
  encodings: Record<string, number[]>;
};

export type GenerateCharacter = {
  id: string;
  name: string;
  positive: string;
  negative: string;
  center: { x: number; y: number };
};

export type Text2ImageResult = {
  ok: boolean;
  path: string;
  name: string;
  seed: number;
  width: number;
  height: number;
  anlas: number | null;
  elapsed_ms: number;
};

export type BatchCardSpec = {
  category: string;
  name: string;
  coefficient: number;
};

export type BatchDimension = {
  name: string;
  cards: BatchCardSpec[];
};

export type BatchLastImage = {
  path: string;
  name: string;
  seed: number;
  width?: number;
  height?: number;
};

export type BatchRun = {
  id: string;
  status: "running" | "paused" | "stopped" | "completed";
  stop_reason: string | null;
  created_at: string;
  updated_at: string;
  total: number;
  done: number;
  failed: number;
  remaining: number;
  current_index: number | null;
  current_combo: Record<string, string> | null;
  last_image: BatchLastImage | null;
  anlas: number | null;
  estimate_sec: number;
  eta_sec: number;
  free: boolean;
  stop_anlas: number;
  dimensions: BatchDimension[];
  base_positive: string;
  negative: string;
  params: {
    model?: string;
    width?: number;
    height?: number;
    steps?: number;
    sampler?: string;
    noise_schedule?: string;
    uc_preset?: string;
    seed?: number;
    quality_toggle?: boolean;
    variety?: boolean;
    furry_mode?: boolean;
    decrisp?: boolean;
    sm?: boolean;
    sm_dyn?: boolean;
    legacy_uc?: boolean;
    vibes?: string[];
  };
};

export type BatchStatusResponse = {
  active: boolean;
  run: BatchRun | null;
};

export type BatchStartPayload = {
  base_positive: string;
  negative: string;
  dimensions: BatchDimension[];
  params: Record<string, unknown>;
  stop_anlas: number;
};

export type PngSendCharacter = {
  positive: string;
  negative: string;
};

export type PngSendVibe = {
  id: string;
  name: string;
  thumbnail: string;
  strength: number;
  information_extracted: number;
  encoding: string;
};

export type PngSendResult = {
  positive: string;
  negative: string;
  uc_preset: string;
  characters: PngSendCharacter[];
  params: Partial<GenerateParamsPayload>;
  vibes: PngSendVibe[];
};
