// Free Code runs ONE model family — Qwen2.5-Coder — offered in three sizes.
// The first-run wizard shows all three and recommends one based on the host's
// RAM/VRAM. Each tier is a single GGUF file (Q4_K_M quant) pulled straight from
// Qwen's official Hugging Face GGUF repos. No Ollama, no registry.
export const MODEL_FAMILY = "qwen2.5-coder";

export const TIERS = [
  {
    id: "light",
    label: "Light",
    param: "1.5B",
    repo: "Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF",
    file: "qwen2.5-coder-1.5b-instruct-q4_k_m.gguf",
    sizeGB: 1.1,
    minRamGB: 6,
    note: "Fastest & lightest. Fine on 8GB RAM with no GPU. May skip steps on complex multi-file tasks.",
  },
  {
    id: "balanced",
    label: "Balanced",
    param: "3B",
    repo: "Qwen/Qwen2.5-Coder-3B-Instruct-GGUF",
    file: "qwen2.5-coder-3b-instruct-q4_k_m.gguf",
    sizeGB: 2.0,
    minRamGB: 8,
    note: "Good all-rounder (~2GB). Recommended for 16GB RAM.",
  },
  {
    id: "full",
    label: "Full",
    param: "7B",
    repo: "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
    file: "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
    sizeGB: 4.7,
    minRamGB: 16,
    note: "Most reliable at multi-file work. Best with a GPU or 16GB+ RAM; slow on CPU-only.",
  },
];

export function tierById(id) {
  return TIERS.find((t) => t.id === id) || null;
}

// Direct download URL for a tier's GGUF on Hugging Face.
export function modelUrl(tier) {
  return `https://huggingface.co/${tier.repo}/resolve/main/${tier.file}?download=true`;
}

// Recommend a tier index (0..2) from detected system resources. GPUs shift the
// recommendation up because offloaded layers make the bigger models usable.
export function recommendTier(sys) {
  const vram = sys.gpu?.vramGB ?? 0;
  const metal = sys.gpu?.kind === "metal";
  // Discrete GPU with >=6GB VRAM, or Apple Silicon with >=16GB unified memory.
  if (vram >= 6 || (metal && sys.totalGB >= 16)) return 2; // Full 7B
  if (sys.totalGB >= 15) return 1; // 16GB-class → Balanced 3B
  return 0; // Light 1.5B
}
