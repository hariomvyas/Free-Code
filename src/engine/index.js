import fs from "node:fs/promises";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { BIN_DIR, MODELS_DIR } from "./paths.js";
import { detectSystem, describeSystem } from "./system.js";
import { TIERS, tierById, modelUrl, recommendTier } from "./models.js";
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
// the first-run wizard if not), starts llama-server, and returns a live Engine
// plus a small config describing the chosen model.
//   force:true re-runs the wizard even if something is already installed (/model).
//   ask: optional (question)=>Promise<string> the wizard uses for input. When
//   omitted it opens its own readline — fine at first-run, but callers that
//   already own stdin (the classic REPL, or a suspended TUI) must pass one so a
//   second reader doesn't fight for keystrokes.
export async function ensureEngineReady({ perf, force = false, ask = null } = {}) {
  let cfg = await loadEngineConfig();

  if (force || !(await isInstalled(cfg))) {
    if (!stdin.isTTY && !ask) {
      throw new Error(
        "No model installed yet. Run `fcode` in an interactive terminal once to choose and download a model."
      );
    }
    cfg = await runWizard(cfg, ask);
  }

  const tier = tierById(cfg.tierId);
  const ngl = cfg.variant === "cpu" ? 0 : perf?.num_gpu ?? 999;
  const engine = new Engine({
    modelPath: modelPath(cfg.modelFile),
    ngl,
    ctx: perf?.num_ctx ?? 8192,
    threads: perf?.num_thread ?? 0,
  });

  process.stdout.write(color("gray", `starting engine (${tier?.label} ${tier?.param}, ${cfg.variant})…\n`));
  await engine.start();
  return {
    engine,
    engineConfig: cfg,
    modelName: tier ? `${tier.label} · Qwen2.5-Coder ${tier.param}` : cfg.modelFile,
  };
}

// Interactive first-run flow: analyze the system, present three options, let the
// user pick, then download whatever's missing (binary + model) and record it.
async function runWizard(existing, ask = null) {
  const sys = detectSystem();
  const recommended = recommendTier(sys);

  console.log("");
  console.log(color("bold", "Free Code — first-time setup"));
  console.log(color("gray", `Detected: ${describeSystem(sys)}`));
  console.log(color("gray", "Pick a model to install. It runs 100% locally — no Ollama, no cloud.\n"));

  TIERS.forEach((t, i) => {
    const star = i === recommended ? color("green", "  ★ recommended") : "";
    const tight = sys.totalGB < t.minRamGB ? color("yellow", `  ⚠ needs ~${t.minRamGB}GB RAM`) : "";
    console.log(
      `  ${color("cyan", String(i + 1))}. ${color("bold", `${t.label} — Qwen2.5-Coder ${t.param}`)}` +
        ` ${color("gray", `(~${t.sizeGB}GB)`)}${star}${tight}`
    );
    console.log(`     ${color("gray", t.note)}`);
  });
  console.log("");

  // Use the caller's input function if given; otherwise own a short-lived
  // readline (first-run, when nothing else holds stdin).
  let rl = null;
  const doAsk = ask || ((q) => (rl ??= readline.createInterface({ input: stdin, output: stdout })).question(q));
  let idx;
  try {
    while (idx === undefined) {
      const ans = (await doAsk(`Choose 1-${TIERS.length} [${recommended + 1}]: `)).trim();
      if (ans === "") {
        idx = recommended;
        break;
      }
      const n = parseInt(ans, 10);
      if (n >= 1 && n <= TIERS.length) idx = n - 1;
      else console.log(color("yellow", `Enter a number 1-${TIERS.length}.`));
    }
  } finally {
    rl?.close();
  }

  const tier = TIERS[idx];
  const variant = existing?.variant || defaultVariant(sys);

  await fs.mkdir(BIN_DIR, { recursive: true });
  await fs.mkdir(MODELS_DIR, { recursive: true });

  // 1) Engine binary (skip if already present, e.g. switching models).
  let engineTag = existing?.engineTag;
  if (!(await fileExists(serverPath()))) {
    engineTag = await installEngine(variant);
  }

  // 2) Model file.
  const dest = modelPath(tier.file);
  if (!(await fileExists(dest))) {
    console.log(color("gray", `Downloading ${tier.label} model (~${tier.sizeGB}GB)…`));
    await downloadWithProgress(modelUrl(tier), dest);
  }

  const cfg = { tierId: tier.id, modelFile: tier.file, variant, engineTag };
  await saveEngineConfig(cfg);
  console.log(color("green", "\n✓ Setup complete.\n"));
  return cfg;
}

// Download + extract the llama.cpp release for `variant`, placing llama-server
// (and its shared libraries) into BIN_DIR.
async function installEngine(variant) {
  console.log(color("gray", `Fetching llama.cpp engine (${variant})…`));
  const asset = await resolveEngineAsset(variant);
  const zipPath = modelPath(asset.name); // reuse models dir as scratch
  await downloadWithProgress(asset.url, zipPath);
  process.stdout.write(color("gray", "extracting…\n"));

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
  return "[" + "█".repeat(filled) + "░".repeat(width - filled) + "]";
}

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
