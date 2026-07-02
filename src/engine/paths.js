import os from "node:os";
import path from "node:path";

// Global (per-user) Free Code home. Holds the bundled llama.cpp binary, the
// downloaded model file(s), and the engine config that records which model the
// user chose. This is distinct from the per-project ".freecode/" directory
// (sessions, logs, permissions) defined in config.js — that one lives in the
// working directory; this one is shared across every project.
export const HOME_DIR = process.env.FREECODE_HOME || path.join(os.homedir(), ".freecode");
export const BIN_DIR = path.join(HOME_DIR, "bin");
export const MODELS_DIR = path.join(HOME_DIR, "models");
export const ENGINE_CONFIG = path.join(HOME_DIR, "engine.json");
// Tree-sitter runtime + grammar wasm files for the built-in code graph.
export const GRAMMARS_DIR = path.join(HOME_DIR, "grammars");
