// Supported open-weight coding models Free Code can download directly as GGUF.
// Keep entries limited to chat/instruct models that work with llama.cpp's
// built-in chat template path (`--jinja`) and have stable direct file URLs.
export const MODEL_FAMILY = "qwen2.5-coder";

export const MODELS = [
  {
    id: "tiny",
    label: "Tiny",
    family: "Qwen2.5-Coder",
    param: "0.5B",
    repo: "Qwen/Qwen2.5-Coder-0.5B-Instruct-GGUF",
    file: "qwen2.5-coder-0.5b-instruct-q4_k_m.gguf",
    sizeGB: 0.4,
    minRamGB: 4,
    note: "Smallest download. Useful on very low-memory machines; weakest for multi-file edits.",
  },
  {
    id: "light",
    label: "Light",
    family: "Qwen2.5-Coder",
    param: "1.5B",
    repo: "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
    file: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    sizeGB: 1.1,
    minRamGB: 6,
    note: "Fastest small coding model. Good for 8GB RAM and CPU-only machines.",
  },
  {
    id: "balanced",
    label: "Balanced",
    family: "Qwen2.5-Coder",
    param: "3B",
    repo: "Qwen/Qwen2.5-Coder-3B-Instruct-GGUF",
    file: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    sizeGB: 2.0,
    minRamGB: 8,
    note: "Good default for 16GB RAM. Better instruction following than Light.",
  },
  {
    id: "full",
    label: "Full",
    family: "Qwen2.5-Coder",
    param: "7B",
    repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    file: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    sizeGB: 4.7,
    minRamGB: 16,
    note: "Best local default when a GPU or enough RAM is available.",
  },
  {
    id: "large",
    label: "Large",
    family: "Qwen2.5-Coder",
    param: "14B",
    repo: "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
    file: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    sizeGB: 9.0,
    minRamGB: 24,
    note: "Stronger reasoning and repair; expect slower CPU-only performance.",
  },
  {
    id: "xl",
    label: "XL",
    family: "Qwen2.5-Coder",
    param: "32B",
    repo: "Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
    file: "qwen2.5-coder-32b-instruct-q4_k_m.gguf",
    sizeGB: 19.0,
    minRamGB: 48,
    note: "Highest quality supported catalog model; intended for high-memory systems.",
  },
];

// Backward-compatible names: older code/config called these entries "tiers".
export const TIERS = MODELS;

export function modelById(id) {
  return MODELS.find((m) => m.id === id) || null;
}

export function tierById(id) {
  return modelById(id);
}

export function modelByFile(file) {
  return MODELS.find((m) => m.file === file) || null;
}

export function modelTitle(model) {
  if (!model) return "";
  return `${model.label} - ${model.family} ${model.param}`;
}

// Direct download URL for a catalog model's GGUF on Hugging Face.
export function modelUrl(model) {
  return `https://huggingface.co/${model.repo}/resolve/main/${model.file}?download=true`;
}

export function modelFitsSystem(model, sys) {
  return (sys?.totalGB ?? 0) >= model.minRamGB;
}

// Recommend one model from detected system resources. GPUs shift the target up
// because llama.cpp can offload layers; CPU-only machines stay conservative.
export function recommendModel(sys) {
  const total = sys?.totalGB ?? 0;
  const vram = sys?.gpu?.vramGB ?? 0;
  const metal = sys?.gpu?.kind === "metal";

  let id = "tiny";
  if (vram >= 24 || (metal && total >= 64)) id = "xl";
  else if (vram >= 12 || (metal && total >= 32)) id = "large";
  else if (vram >= 6 || (metal && total >= 16)) id = "full";
  else if (total >= 15) id = "balanced";
  else if (total >= 8) id = "light";

  return modelById(id) || MODELS[0];
}

// Backward-compatible API used by the old picker: return the recommended index.
export function recommendTier(sys) {
  const model = recommendModel(sys);
  return Math.max(0, MODELS.findIndex((m) => m.id === model.id));
}
