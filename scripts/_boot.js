import { ensureEngineReady } from "../src/engine/index.js";
import { DEFAULT_CONFIG } from "../src/config.js";

// Shared helper for the smoke scripts: boots the local llama.cpp engine and
// returns a config pointing at it (host = the llama-server URL, model = label).
// Requires a model to already be installed — run `fcode` once to set one up.
// Call `engine.stop()` when the script is done so the process can exit.
export async function bootConfig(overrides = {}) {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const { engine, modelName } = await ensureEngineReady({ perf: config.perf });
  config.host = engine.baseUrl;
  config.model = modelName;
  return { config, engine };
}
