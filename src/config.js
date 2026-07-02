import path from "node:path";

// Runtime perf knobs for the bundled llama.cpp engine. Translated to
// llama-server launch flags in src/engine/ (num_gpu → -ngl, num_thread → -t,
// num_ctx → -c). Defaults use ALL available hardware:
//   num_gpu: 999  -> offload every model layer that fits in VRAM (llama.cpp caps
//                    this to what actually fits; ignored by CPU-only builds).
//   num_thread: 0 -> let llama.cpp pick (uses all physical CPU cores).
// Override any of these via env vars for tuning.
export const PERF = {
  num_gpu: intEnv("FREECODE_NUM_GPU", 999),
  num_thread: intEnv("FREECODE_NUM_THREAD", 0),
  num_ctx: intEnv("FREECODE_NUM_CTX", 8192),
};

function intEnv(name, fallback) {
  const v = parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) ? v : fallback;
}

// `model` and `host` are filled in at startup once the engine is running:
// host = the local llama-server base URL, model = the chosen model's label.
export const DEFAULT_CONFIG = {
  model: null,
  host: null,
  maxIterations: 25,
  requestTimeoutMs: 180_000,
  perf: PERF,
};

export const PROJECT_DIR = path.join(process.cwd(), ".freecode");
export const PERMISSIONS_FILE = path.join(PROJECT_DIR, "permissions.json");
export const LOG_DIR = path.join(PROJECT_DIR, "logs");
