export type PromptBlock = {
  id: string;
  type: "prompt";
  text: string;
  weight?: number;
  /** 中文标注（来自本地词典，或用户手动填写） */
  cn?: string;
  /** 词典分类映射到卡包分类后的名称（角色/动作/画师串/负面/质量/场景/表情/服装） */
  category?: string;
  /** 用户备注（块级，保存在工作区） */
  note?: string;
};
export type CardBlock = { id: string; type: "card"; category: string; name: string };
export type Block = PromptBlock | CardBlock;
export type Zone = "positive" | "negative";

export type Section = {
  id: string;
  name: string;
  locked: boolean;
  blocks: Block[];
};

export type CardMeta = {
  name: string;
  preview: string;
  updated: number;
  image?: string | null;
};
export type Category = { name: string; count: number; cards: CardMeta[]; color?: number | null };

export type ThemeState = {
  mode: "light" | "dark";
  accent: string;
  /** 卡片玻璃强度：0-1，越低越通透。 */
  glass: number;
  /** 背景图模糊强度：0-100，100 对应 30px。 */
  background_blur: number;
};

export type Settings = {
  theme: ThemeState;
  library_path: string;
  recycle_reject: boolean;
  format_input: boolean;
  port: number;
  /** 多角色：角色分区逐块作为独立角色；关闭后并入正面提示词 */
  multi_character: boolean;
  /** 显示中文翻译（词典标注）；关闭后块上不显示，备注不受影响 */
  show_chinese: boolean;
  /** 自动备注：查词后按分类预填块备注；关闭后不预填 */
  auto_note: boolean;
  /** 仅隐藏顶部画风探索入口，侧边栏入口始终保留 */
  hide_style_explore_top_nav: boolean;
  /** 画风探索单张候选最多抽取的 Artist ID 数目（5-30） */
  style_explore_max_artist_count: number;
  /** 允许将本地文件或网页图片拖入普通图片库自动导入 */
  library_drag_import_enabled: boolean;
  effects: {
    background_rotation: boolean;
    review_particles: boolean;
    review_animations: boolean;
  };
};

export type WorkspaceData = {
  positive: Section[];
  negative: Section[];
  back_note?: string;
};

export type DictionaryStatus = {
  builtin_count: number;
  custom_count: number;
  folder: string;
  builtin_file: string;
  custom_file: string;
};

export type DictionaryEntry = {
  cn: string;
  source: string;
  category?: string;
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
  /** 已成功保存、可直接插入图片流的条目 */
  items?: LibraryImageItem[];
  /** 导入过程中自动创建的卡包分类 */
  created_categories?: string[];
  /** 因同名而自动加后缀（1）新建的卡片数 */
  renamed?: number;
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
  folder: string;
  folder_label: string;
  thumbnail: string;
  models: string[];
  default_strength: number;
  default_information_extracted: number;
  encodings: Record<string, number[]>;
};

export type VibeFolder = {
  name: string;
  label: string;
  default: boolean;
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

export type GenerationOccupancy = {
  occupied: boolean;
  owner: "batch" | "style_explore" | string | null;
  task_id: string | null;
  task_name: string | null;
  status: string | null;
  acquired_at?: string | null;
};

export type BatchStartPayload = {
  base_positive: string;
  negative: string;
  dimensions: BatchDimension[];
  params: Record<string, unknown>;
  stop_anlas: number;
};

export type StyleExplorePhase = "basic" | "deep";
export type StyleExploreRunStatus =
  | "draft"
  | "running"
  | "paused"
  | "generated"
  | "reviewing"
  | "completed"
  | "cancelled";
export type StyleExploreCandidateStatus = "pending" | "generating" | "done" | "failed" | "skipped";
export type StyleExploreReviewLabel = "treasure" | "reject" | "special" | null;
export type StyleExplorePreliminaryLabel = "treasure" | "reject" | "special" | null;

export type StyleExplorePoolSummary = {
  id: string;
  name: string;
  source_name?: string;
  created_at: string;
  updated_at: string;
  count: number;
  input_count?: number;
  valid_count?: number;
  duplicate_count?: number;
  skipped_count?: number;
  skipped?: number;
  original_count?: number;
  duplicate_preview?: string[];
  skipped_preview?: { value: string; reason: string }[];
  normalized_preview?: string[];
  duplicate_preview_truncated?: boolean;
  skipped_preview_truncated?: boolean;
  normalized_preview_truncated?: boolean;
  normalized_content?: string;
  warnings?: string[];
  format_info?: {
    detected_format: string;
    accepted_formats: string[];
    accepted_extensions: string[];
    normalized_format: string;
    literal_comma_escape: string;
    comment_prefix: string;
  };
};

export type StyleExplorePool = StyleExplorePoolSummary & {
  content: string;
  ids: string[];
  skipped: number;
};

export type StyleExploreRunPool = {
  id: string;
  name: string;
  ids: string[];
};

export type StyleExploreCandidate = {
  id: string;
  round_id?: string;
  artist_string: string;
  ids: unknown[];
  generation: { status: StyleExploreCandidateStatus; [key: string]: unknown };
  review: { heart?: boolean; rating?: number | null; label: StyleExploreReviewLabel; preliminary_label?: StyleExplorePreliminaryLabel; [key: string]: unknown };
  lineage: Record<string, unknown>;
  prompt_snapshot?: { positive: string; negative: string; params: Record<string, unknown> };
};

export type StyleExploreDeepParent = {
  id: string;
  source: "candidate" | "custom";
  candidate_id?: string | null;
  representative_candidate_id?: string | null;
  artist_string: string;
  preference: number;
};

export type StyleExploreDeepPreference = {
  left_parent_id: string;
  right_parent_id: string;
  result: "left" | "right" | "neither" | "skip";
  created_at: string;
};

export type StyleExploreDeepBranch = {
  id: string;
  name: string;
  source_round_id: string;
  source_parent_set_id: string;
  root_parent_set_id?: string;
  family_id?: string;
  selected_candidate_ids: string[];
};

export type StyleExploreDeepParentSet = {
  id: string;
  number: number;
  family_id?: string;
  status: "active" | "used";
  created_at: string;
  updated_at: string;
  parents: StyleExploreDeepParent[];
  comparisons: StyleExploreDeepPreference[];
  suggested_target_count: number;
  used_round_ids?: string[];
  generation?: number;
  branch?: StyleExploreDeepBranch;
};

export type StyleExploreDeepFamily = {
  id: string;
  number: number;
  created_at: string;
  updated_at: string;
  root_parent_set_id: string;
  active_parent_set_id: string;
};

export type StyleExploreRound = {
  id: string;
  number: number;
  phase: "basic" | "deep";
  status: string;
  target_count: number;
  created_at: string;
  random_seed?: number;
  parent_set_id?: string;
  family_id?: string;
  suggested_next_parent_count?: number;
  candidate_ids?: string[];
  generation?: number;
  sibling_index?: number;
};

export type StyleExploreDeepState = {
  active_parent_set_id: string | null;
  active_family_id?: string | null;
  families?: StyleExploreDeepFamily[];
  parent_sets: StyleExploreDeepParentSet[];
};

export type StyleExploreRunSummary = {
  id: string;
  name: string;
  phase: StyleExplorePhase;
  status: StyleExploreRunStatus;
  status_reason: string | null;
  created_at: string;
  updated_at: string;
  target_count: number;
  pool: StyleExploreRunPool;
  candidate_count: number;
  done_count: number;
  reviewed_count: number;
  round_count?: number;
  archived_at?: string | null;
};

export type StyleExploreRun = StyleExploreRunSummary & {
  random_seed: number | null;
  prompt_snapshot: { positive: string; negative: string; params: Record<string, unknown> };
  algorithm: Record<string, unknown>;
  candidates: StyleExploreCandidate[];
  rounds?: StyleExploreRound[];
  deep?: StyleExploreDeepState;
};

export type StyleExploreRunCreatePayload = {
  name?: string;
  pool_id: string;
  target_count: number;
  positive: string;
  negative: string;
  params?: Record<string, unknown>;
  algorithm?: Record<string, unknown>;
  phase: StyleExplorePhase;
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

export type PublishEngineParamOption = {
  value: string | number;
  label: string;
};

export type PublishEngineParam = {
  key: string;
  label: string;
  type: "select" | "number" | "bool";
  options?: PublishEngineParamOption[];
  default?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
};

export type PublishEngineManifest = {
  id: string;
  name: string;
  version: string;
  homepage: string;
  params: PublishEngineParam[];
};

export type PublishEngineInfo = {
  id: string;
  name: string;
  version: string;
  downloadable: boolean;
};

export type PublishEngineStatus = {
  engines: PublishEngineInfo[];
  engine: string;
  engine_name: string;
  manifest: PublishEngineManifest;
  installed: boolean;
  installing: boolean;
  progress: number;
  message: string;
  binary: string | null;
  custom_path: string;
  params: Record<string, string | number | boolean>;
};

export type PublishNodes = {
  upscale: boolean;
  restore: boolean;
  wipe: boolean;
  rename: boolean;
  mosaic: boolean;
};

export type PublishPlugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  license: string;
  node: { key: keyof PublishNodes; label: string; desc: string; order: number };
  parts: { value: string; detect: string }[];
  methods: { value: string; label: string }[];
  model_size: number;
  enabled: boolean;
  installing: boolean;
  progress: number;
  message: string;
  installed_at: string;
};

export type PublishRunFile = {
  staged: string;
  output: string | null;
  status: "pending" | "running" | "done" | "failed";
  message: string;
};

export type PublishStagedItem = {
  name: string;
  library_path: string;
  added_at: string;
  size: number;
  mtime: number;
};

export type PublishRunStatus = {
  id: string;
  status: "running" | "completed" | "failed";
  nodes: PublishNodes;
  rename: { parts: string[]; custom?: string; random_length?: number };
  files: PublishRunFile[];
  output_dir: string;
  total: number;
  done: number;
  failed: number;
  active: boolean;
  message: string;
};
