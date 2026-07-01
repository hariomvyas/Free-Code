import path from "node:path";

// Preference order when FREECODE_MODEL isn't set — strongest coder model the
// user actually has installed wins. 7B builds far more reliably than 3B; 3B is
// the low-RAM fallback for 8GB machines.
export const MODEL_PREFERENCE = [
  "qwen2.5-coder:14b",
  "qwen2.5-coder:7b",
  "qwen2.5-coder:3b",
  "qwen2.5-coder:1.5b",
];

export const FALLBACK_MODEL = "qwen2.5-coder:3b";

// Given the list of installed models, pick the best available per preference,
// else the first installed coder model, else the fallback name.
export function pickModel(installed = []) {
  if (process.env.FREECODE_MODEL) return process.env.FREECODE_MODEL;
  for (const m of MODEL_PREFERENCE) {
    if (installed.includes(m)) return m;
  }
  const anyCoder = installed.find((m) => /coder|code|deepseek|starcoder/i.test(m));
  return anyCoder || FALLBACK_MODEL;
}

// Runtime perf knobs passed straight to Ollama's `options`. Defaults are tuned
// to use ALL available hardware:
//   num_gpu: 999  -> offload every model layer that fits in VRAM (Ollama caps
//                    this to what actually fits, so it's safe on any GPU size;
//                    with no usable GPU it simply runs on CPU).
//   num_thread: 0 -> let Ollama pick (uses all physical CPU cores).
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

export const DEFAULT_CONFIG = {
  model: process.env.FREECODE_MODEL || FALLBACK_MODEL,
  host: process.env.FREECODE_HOST || "http://127.0.0.1:11434",
  maxIterations: 25,
  requestTimeoutMs: 180_000,
  perf: PERF,
};

export const PROJECT_DIR = path.join(process.cwd(), ".freecode");
export const PERMISSIONS_FILE = path.join(PROJECT_DIR, "permissions.json");
export const LOG_DIR = path.join(PROJECT_DIR, "logs");
