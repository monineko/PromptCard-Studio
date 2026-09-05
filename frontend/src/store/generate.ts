import { create } from "zustand";
import type { GenerateParamsPayload, GenerateVibe, Text2ImageResult } from "../types";

const PARAMS_KEY = "npm_generate_params";
const VIBES_KEY = "npm_generate_vibes";
const PROMPTS_KEY = "npm_generate_prompts";

export interface GeneratePromptCharacter {
  positive: string;
  negative: string;
}

export interface GeneratePromptDraft {
  positive: string;
  negative: string;
  characters: GeneratePromptCharacter[];
}

interface StoredPromptState {
  syncWorkspace: boolean;
  draft: GeneratePromptDraft;
}

const EMPTY_PROMPT_DRAFT: GeneratePromptDraft = {
  positive: "",
  negative: "",
  characters: [],
};

export const DEFAULT_PARAMS: GenerateParamsPayload = {
  model: "nai-diffusion-4-5-full",
  width: 832,
  height: 1216,
  steps: 28,
  scale: 5.5,
  cfg_rescale: 0,
  sampler: "k_euler_ancestral",
  noise_schedule: "karras",
  seed: -1,
  uc_preset: "Heavy",
  quality_toggle: true,
  variety: true,
  sm: false,
  sm_dyn: false,
  decrisp: false,
  legacy_uc: false,
  furry_mode: false,
};

function loadParams(): GenerateParamsPayload {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (raw) return { ...DEFAULT_PARAMS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PARAMS };
}

function loadVibes(): GenerateVibe[] {
  try {
    const raw = localStorage.getItem(VIBES_KEY);
    const arr = JSON.parse(raw || "[]");
    if (Array.isArray(arr)) return arr;
  } catch {
    /* ignore */
  }
  return [];
}

function loadPromptState(): StoredPromptState {
  try {
    const raw = localStorage.getItem(PROMPTS_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as Partial<StoredPromptState>;
      const draft = stored.draft;
      return {
        syncWorkspace: stored.syncWorkspace !== false,
        draft: {
          positive: typeof draft?.positive === "string" ? draft.positive : "",
          negative: typeof draft?.negative === "string" ? draft.negative : "",
          characters: Array.isArray(draft?.characters)
            ? draft.characters.map((character) => ({
                positive: typeof character?.positive === "string" ? character.positive : "",
                negative: typeof character?.negative === "string" ? character.negative : "",
              }))
            : [],
        },
      };
    }
  } catch {
    /* ignore */
  }
  return { syncWorkspace: true, draft: { ...EMPTY_PROMPT_DRAFT } };
}

const initialPromptState = loadPromptState();

interface GenerateState {
  params: GenerateParamsPayload;
  vibes: GenerateVibe[];
  syncWorkspacePrompts: boolean;
  promptDraft: GeneratePromptDraft;
  result: Text2ImageResult | null;
  setParam: (patch: Partial<GenerateParamsPayload>) => void;
  resetParams: () => void;
  setVibes: (vibes: GenerateVibe[]) => void;
  updateVibe: (id: string, patch: Partial<GenerateVibe>) => void;
  removeVibe: (id: string) => void;
  syncPromptDraft: (draft: GeneratePromptDraft) => void;
  editPromptDraft: (draft: GeneratePromptDraft) => void;
  setPromptSync: (enabled: boolean, workspaceDraft: GeneratePromptDraft) => void;
  setResult: (r: Text2ImageResult | null) => void;
}

function persistParams(params: GenerateParamsPayload) {
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify(params));
  } catch {
    /* ignore */
  }
}

function persistVibes(vibes: GenerateVibe[]) {
  try {
    localStorage.setItem(VIBES_KEY, JSON.stringify(vibes));
  } catch {
    /* ignore */
  }
}

function persistPromptState(state: StoredPromptState) {
  try {
    localStorage.setItem(PROMPTS_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export const useGenerateStore = create<GenerateState>((set, get) => ({
  params: loadParams(),
  vibes: loadVibes(),
  syncWorkspacePrompts: initialPromptState.syncWorkspace,
  promptDraft: initialPromptState.draft,
  result: null,

  setParam(patch) {
    const next = { ...get().params, ...patch };
    persistParams(next);
    set({ params: next });
  },

  resetParams() {
    persistParams(DEFAULT_PARAMS);
    set({ params: { ...DEFAULT_PARAMS } });
  },

  setVibes(vibes) {
    persistVibes(vibes);
    set({ vibes });
  },

  updateVibe(id, patch) {
    const vibes = get().vibes.map((v) => (v.id === id ? { ...v, ...patch } : v));
    persistVibes(vibes);
    set({ vibes });
  },

  removeVibe(id) {
    const vibes = get().vibes.filter((v) => v.id !== id);
    persistVibes(vibes);
    set({ vibes });
  },

  syncPromptDraft(draft) {
    if (!get().syncWorkspacePrompts) return;
    persistPromptState({ syncWorkspace: true, draft });
    set({ promptDraft: draft });
  },

  editPromptDraft(draft) {
    persistPromptState({ syncWorkspace: false, draft });
    set({ syncWorkspacePrompts: false, promptDraft: draft });
  },

  setPromptSync(enabled, workspaceDraft) {
    const draft = enabled ? workspaceDraft : get().promptDraft;
    persistPromptState({ syncWorkspace: enabled, draft });
    set({ syncWorkspacePrompts: enabled, promptDraft: draft });
  },

  // 结果仅保存在内存（页面切换保留；刷新/重启后清空）
  setResult(result) {
    set({ result });
  },
}));
