import { create } from "zustand";
import type { BatchRun } from "../types";

const CONFIG_KEY = "npm_batch_config";

export type CustomSectionMode = "dim" | "shared";

export type BatchConfig = {
  cardCoeffs: Record<string, number>;
  customModes: Record<string, CustomSectionMode>;
  stopDelta: number;
};

const DEFAULT_CONFIG: BatchConfig = {
  cardCoeffs: {},
  customModes: {},
  stopDelta: -1000,
};

function loadConfig(): BatchConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        cardCoeffs: parsed.cardCoeffs || {},
        customModes: parsed.customModes || {},
        stopDelta: typeof parsed.stopDelta === "number" ? parsed.stopDelta : -1000,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_CONFIG };
}

interface BatchState {
  run: BatchRun | null;
  config: BatchConfig;
  setRun: (run: BatchRun | null) => void;
  setCardCoeff: (blockId: string, value: number) => void;
  setAllCardCoeff: (blockIds: string[], value: number) => void;
  setCustomMode: (sectionId: string, mode: CustomSectionMode) => void;
  setStopDelta: (value: number) => void;
}

function persist(config: BatchConfig) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}

export const useBatchStore = create<BatchState>((set, get) => ({
  run: null,
  config: loadConfig(),

  setRun(run) {
    set({ run });
  },

  setCardCoeff(blockId, value) {
    const config = { ...get().config, cardCoeffs: { ...get().config.cardCoeffs, [blockId]: value } };
    persist(config);
    set({ config });
  },

  setAllCardCoeff(blockIds, value) {
    const cardCoeffs = { ...get().config.cardCoeffs };
    for (const id of blockIds) cardCoeffs[id] = value;
    const config = { ...get().config, cardCoeffs };
    persist(config);
    set({ config });
  },

  setCustomMode(sectionId, mode) {
    const config = { ...get().config, customModes: { ...get().config.customModes, [sectionId]: mode } };
    persist(config);
    set({ config });
  },

  setStopDelta(value) {
    const config = { ...get().config, stopDelta: value };
    persist(config);
    set({ config });
  },
}));
