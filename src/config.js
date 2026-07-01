import path from "node:path";

export const DEFAULT_CONFIG = {
  model: process.env.FREECODE_MODEL || "qwen2.5-coder:3b",
  host: process.env.FREECODE_HOST || "http://127.0.0.1:11434",
  maxIterations: 25,
  requestTimeoutMs: 180_000,
};

export const PROJECT_DIR = path.join(process.cwd(), ".freecode");
export const PERMISSIONS_FILE = path.join(PROJECT_DIR, "permissions.json");
export const LOG_DIR = path.join(PROJECT_DIR, "logs");
