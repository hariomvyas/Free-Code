import fs from "node:fs/promises";
import path from "node:path";
import { ENGINE_CONFIG, MODELS_DIR, BIN_DIR } from "./paths.js";
import { serverBinName } from "./platform.js";

// engine.json records the user's one chosen model plus the installed binary's
// details, so subsequent launches skip the wizard and start straight up.
//   { tierId, modelFile, variant, engineTag }
export async function loadEngineConfig() {
  try {
    return JSON.parse(await fs.readFile(ENGINE_CONFIG, "utf8"));
  } catch {
    return null;
  }
}

export async function saveEngineConfig(cfg) {
  await fs.mkdir(path.dirname(ENGINE_CONFIG), { recursive: true });
  await fs.writeFile(ENGINE_CONFIG, JSON.stringify(cfg, null, 2), "utf8");
}

export function modelPath(modelFile) {
  return path.join(MODELS_DIR, modelFile);
}

export function serverPath() {
  return path.join(BIN_DIR, serverBinName());
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// True when both the binary and the chosen model file are present on disk.
export async function isInstalled(cfg) {
  if (!cfg?.modelFile) return false;
  return (await exists(serverPath())) && (await exists(modelPath(cfg.modelFile)));
}
