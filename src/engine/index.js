import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { BIN_DIR, MODELS_DIR } from "./paths.js";
import { detectSystem, describeSystem } from "./system.js";
import {
  MODELS,
  modelByFile,
  modelById,
  modelFitsSystem,
  modelTitle,
  modelUrl,
  recommendModel,
} from "./models.js";
import { defaultVariant, resolveEngineAsset, serverBinName } from "./platform.js";
import { downloadFile, unzip } from "./download.js";
import {
  loadEngineConfig,
  saveEngineConfig,
  isInstalled,
  modelPath,
  serverPath,
} from "./state.js";
import { Engine } from "./server.js";

const color = (c, s) => {
  const codes = { gray: 90, green: 32, cyan: 36, yellow: 33, bold: 1, dim: 2 };
  return `\x1b[${codes[c] || 0}m${s}\x1b[0m`;
};

// Entry point used by the CLI. Ensures a model + binary are installed (running
// the model picker if not), starts llama-server, and returns a live Engine plus
// a small config describing the chosen model.
export async function ensureEngineReady({ perf, force = false, ask = null } = {}) {
  let cfg = await loadEngineConfig();
  let installed = await isInstalled(cfg);

  if (force || !installed) {
    if (!stdin.isTTY && !ask) {
      throw new Error(
        "No model installed yet. Run `fcode` in an interactive terminal once to choose and download a model."
      );
    }
    cfg = await runModelPicker(cfg, ask);
    installed = true;
  }

  const model = modelFromConfig(cfg);
  const displayName = modelDisplayName(cfg, model);
  const ngl = cfg.variant === "cpu" ? 0 : perf?.num_gpu ?? 999;
  const engine = new Engine({
    modelPath: modelPath(cfg.modelFile),
    ngl,
    ctx: perf?.num_ctx ?? 8192,
    threads: perf?.num_thread ?? 0,
  });

  process.stdout.write(color("gray", `starting engine (${displayName}, ${cfg.variant})...\n`));
  await engine.start();
  return {
    engine,
    engineConfig: cfg,
    modelName: displayName,
  };
}

// Interactive model flow. With installed models present (/model), show those
// first and put "Get and add more models" at the bottom. First run goes straight
// to the catalog if nothing has been downloaded yet.
async function runModelPicker(existing, ask = null) {
  const sys = detectSystem();
  const recommended = recommendModel(sys);
  const variant = existing?.variant || defaultVariant(sys);

  console.log("");
  console.log(color("bold", existing ? "Free Code - model picker" : "Free Code - first-time setup"));
  console.log(color("gray", `Detected: ${describeSystem(sys)}`));
  console.log(color("gray", "Models run 100% locally through the bundled llama.cpp engine.\n"));

  let rl = null;
  const doAsk = ask || ((q) => (rl ??= readline.createInterface({ input: stdin, output: stdout })).question(q));

  try {
    while (true) {
      const installedModels = await listInstalledModels(existing);
      let selection = null;

      if (installedModels.length) {
        selection = await promptInstalledModel({
          doAsk,
          installedModels,
          activeFile: existing?.modelFile,
          recommended,
        });
      }

      if (!selection) {
        selection = await promptCatalogModel({ doAsk, sys, recommended, installedModels });
      }

      if (selection) {
        const cfg = await installSelection(selection, { existing, variant });
        console.log(color("green", "\nSetup complete.\n"));
        return cfg;
      }
    }
  } finally {
    rl?.close();
  }
}

async function promptInstalledModel({ doAsk, installedModels, activeFile, recommended }) {
  console.log(color("bold", "Installed models"));
  installedModels.forEach((item, i) => {
    const active = item.file === activeFile ? color("green", " [active]") : "";
    const rec = item.model?.id === recommended.id ? color("green", " [recommended]") : "";
    console.log(`  ${color("cyan", String(i + 1))}. ${color("bold", item.name)}${active}${rec}`);
    console.log(color("gray", `     ${item.file}`));
  });

  const getMore = installedModels.length + 1;
  console.log(`  ${color("cyan", String(getMore))}. ${color("bold", "Get and add more models")}`);
  console.log("");

  const activeIdx = installedModels.findIndex((m) => m.file === activeFile);
  const def = activeIdx >= 0 ? activeIdx + 1 : 1;
  while (true) {
    const ans = (await doAsk(`Choose 1-${getMore} [${def}]: `)).trim();
    const n = ans === "" ? def : parseInt(ans, 10);
    if (n >= 1 && n <= installedModels.length) return { kind: "installed", ...installedModels[n - 1] };
    if (n === getMore) return null;
    console.log(color("yellow", `Enter a number 1-${getMore}.`));
  }
}

async function promptCatalogModel({ doAsk, sys, recommended, installedModels }) {
  const installedFiles = new Set(installedModels.map((m) => m.file));
  console.log(color("bold", "Open-source models available to download"));
  MODELS.forEach((model, i) => {
    const rec = model.id === recommended.id ? color("green", " [recommended]") : "";
    const installed = installedFiles.has(model.file) ? color("cyan", " [installed]") : "";
    const tight = modelFitsSystem(model, sys)
      ? ""
      : color("yellow", ` [needs ~${model.minRamGB}GB RAM]`);
    console.log(
      `  ${color("cyan", String(i + 1))}. ${color("bold", modelTitle(model))}` +
        ` ${color("gray", `(~${model.sizeGB}GB)`)}` +
        `${rec}${installed}${tight}`
    );
    console.log(`     ${color("gray", model.note)}`);
  });

  const custom = MODELS.length + 1;
  console.log(`  ${color("cyan", String(custom))}. ${color("bold", "Add a custom GGUF URL")}`);
  console.log("");

  const def = Math.max(1, MODELS.findIndex((m) => m.id === recommended.id) + 1);
  while (true) {
    const ans = (await doAsk(`Choose 1-${custom} [${def}]: `)).trim();
    const n = ans === "" ? def : parseInt(ans, 10);
    if (n >= 1 && n <= MODELS.length) return { kind: "catalog", model: MODELS[n - 1] };
    if (n === custom) return promptCustomModel(doAsk);
    console.log(color("yellow", `Enter a number 1-${custom}.`));
  }
}

async function promptCustomModel(doAsk) {
  console.log(color("gray", "Paste a direct http(s) URL to a .gguf file. Blank cancels."));
  while (true) {
    const url = (await doAsk("GGUF URL: ")).trim();
    if (!url) return null;

    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      console.log(color("yellow", "Enter a valid URL."));
      continue;
    }

    if (!/^https?:$/.test(parsed.protocol)) {
      console.log(color("yellow", "URL must start with http:// or https://."));
      continue;
    }

    const fromUrl = decodeURIComponent(parsed.pathname.split("/").pop() || "model.gguf");
    if (!fromUrl.toLowerCase().endsWith(".gguf")) {
      console.log(color("yellow", "URL path must end in .gguf."));
      continue;
    }

    const file = sanitizeFileName(fromUrl);
    const name = (await doAsk(`Display name [${file}]: `)).trim() || file;
    return { kind: "custom", url, file, name };
  }
}

async function installSelection(selection, { existing, variant }) {
  await fs.mkdir(BIN_DIR, { recursive: true });
  await fs.mkdir(MODELS_DIR, { recursive: true });

  let engineTag = existing?.engineTag;
  if (!(await fileExists(serverPath()))) {
    engineTag = await installEngine(variant);
  }

  if (selection.kind === "installed") {
    return saveSelectedConfig({
      model: selection.model,
      modelFile: selection.file,
      modelName: selection.name,
      variant,
      engineTag,
    });
  }

  if (selection.kind === "catalog") {
    const model = selection.model;
    const dest = modelPath(model.file);
    if (!(await fileExists(dest))) {
      console.log(color("gray", `Downloading ${modelTitle(model)} (~${model.sizeGB}GB)...`));
      await downloadWithProgress(modelUrl(model), dest);
    }
    return saveSelectedConfig({
      model,
      modelFile: model.file,
      modelName: modelTitle(model),
      variant,
      engineTag,
    });
  }

  if (selection.kind === "custom") {
    const dest = modelPath(selection.file);
    if (!(await fileExists(dest))) {
      console.log(color("gray", `Downloading ${selection.name}...`));
      await downloadWithProgress(selection.url, dest);
    }
    return saveSelectedConfig({
      model: null,
      modelFile: selection.file,
      modelName: selection.name,
      modelUrl: selection.url,
      variant,
      engineTag,
    });
  }

  throw new Error("No model selected.");
}

async function saveSelectedConfig({ model, modelFile, modelName, modelUrl: url, variant, engineTag }) {
  const cfg = {
    tierId: model?.id || null,
    modelId: model?.id || null,
    modelFile,
    modelName: modelName || modelFile,
    variant,
    engineTag,
  };
  if (url) cfg.modelUrl = url;
  await saveEngineConfig(cfg);
  return cfg;
}

async function listInstalledModels(existing) {
  let files = [];
  try {
    files = (await fs.readdir(MODELS_DIR)).filter((f) => f.toLowerCase().endsWith(".gguf"));
  } catch {
    return [];
  }

  return files.sort().map((file) => {
    const model = modelByFile(file);
    const activeCustomName = file === existing?.modelFile ? existing?.modelName : null;
    return {
      file,
      model,
      name: model ? modelTitle(model) : activeCustomName || file,
    };
  });
}

function modelFromConfig(cfg) {
  return modelById(cfg?.modelId || cfg?.tierId) || modelByFile(cfg?.modelFile) || null;
}

function modelDisplayName(cfg, model) {
  return model ? modelTitle(model) : cfg?.modelName || cfg?.modelFile || "unknown model";
}

function sanitizeFileName(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

// Download + extract the llama.cpp release for `variant`, placing llama-server
// (and its shared libraries) into BIN_DIR.
async function installEngine(variant) {
  console.log(color("gray", `Fetching llama.cpp engine (${variant})...`));
  const asset = await resolveEngineAsset(variant);
  const zipPath = modelPath(asset.name); // reuse models dir as scratch
  await downloadWithProgress(asset.url, zipPath);
  process.stdout.write(color("gray", "extracting...\n"));

  // Extract into a temp dir, then flatten every file into BIN_DIR (release zips
  // nest binaries under build/bin/). Keep the DLLs/dylibs next to the binary.
  const tmp = zipPath + ".dir";
  const written = await unzip(zipPath, tmp);
  for (const f of written) {
    const base = f.split(/[\\/]/).pop();
    await fs.rename(f, `${BIN_DIR}/${base}`).catch(async () => {
      await fs.copyFile(f, `${BIN_DIR}/${base}`);
    });
  }
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  await fs.rm(zipPath, { force: true }).catch(() => {});

  // Make the server executable on Unix.
  if (process.platform !== "win32") {
    await fs.chmod(serverPath(), 0o755).catch(() => {});
  }
  if (!(await fileExists(serverPath()))) {
    throw new Error(`Extracted engine but ${serverBinName()} not found in the archive.`);
  }
  return asset.tag;
}

async function downloadWithProgress(url, dest) {
  let last = 0;
  await downloadFile(url, dest, (recv, total) => {
    const now = Date.now();
    if (now - last < 200) return; // throttle redraws
    last = now;
    const mb = (recv / 1024 / 1024).toFixed(0);
    if (total) {
      const pct = Math.floor((recv / total) * 100);
      const totMb = (total / 1024 / 1024).toFixed(0);
      stdout.write(`\r  ${bar(pct)} ${pct}%  ${mb}/${totMb} MB   `);
    } else {
      stdout.write(`\r  ${mb} MB   `);
    }
  });
  stdout.write("\r" + " ".repeat(48) + "\r");
}

function bar(pct, width = 24) {
  const filled = Math.round((pct / 100) * width);
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
