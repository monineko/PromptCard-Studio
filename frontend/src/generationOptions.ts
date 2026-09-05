export const SAMPLER_LABELS: Record<string, string> = {
  k_euler_ancestral: "Euler Ancestral",
  k_euler: "Euler",
  k_dpmpp_2s_ancestral: "DPM++ 2S Ancestral",
  k_dpmpp_2m_sde: "DPM++ 2M SDE",
  k_dpmpp_2m: "DPM++ 2M",
  k_dpmpp_sde: "DPM++ SDE",
  ddim_v3: "DDIM",
};

export const NOISE_SCHEDULE_LABELS: Record<string, string> = {
  native: "Native",
  karras: "Karras",
  exponential: "Exponential",
  polyexponential: "Polyexponential",
};

export const QUALITY_PRESET_LABELS: Record<string, string> = {
  standard: "Standard",
  light: "Light",
  none: "关闭",
};

export function optionLabel(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}
