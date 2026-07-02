import readline from "node:readline/promises";
import fs from "node:fs/promises";
import { stdin, stdout } from "node:process";
import { DEFAULT_CONFIG } from "./config.js";
import { PermissionGate } from "./permission.js";
import { Agent } from "./agent.js";
import { Session } from "./session.js";
import { ToolRegistry } from "./toolRegistry.js";
import { spawnSync } from "node:child_process";
import { LLMError, engineProps } from "./llm.js";
import { ensureEngineReady } from "./engine/index.js";
import { MODELS_DIR } from "./engine/paths.js";
import { buildAndRefresh } from "./codegraph/tools.js";
import { search as cgSearch, callers as cgCallers, callees as cgCallees } from "./codegraph/query.js";
import { Spinner, printToolCall, printToolResult, printAnswer, printBanner, color } from "./ui.js";
import { Tui, c } from "./tui.js";
import { autoUpdate, entryScript } from "./update.js";

const COMMANDS = "/model  /models  /gpu  /index  /graph <name>  /tools  /update  /sessions  /resume <id>  /reset  exit";

// Handles slash commands + exit. Returns "quit", "handled", or "pass".
// `print(text)` writes a line to the active surface (console or TUI).
async function handleCommand(input, { config, registry, holder, permissionGate, print, ui }) {
  if (input === "exit" || input === "quit") return "quit";

  if (input === "/sessions") {
    const sessions = await Session.list();
    if (!sessions.length) print(color("gray", "no saved sessions yet"));
    else
      for (const s of sessions.slice(0, 20))
        print(color("cyan", s.id) + color("gray", `  ${s.turns} turn(s)  ${s.model || "?"}  — ${s.title}`));
    return "handled";
  }
  if (input.startsWith("/resume ")) {
    const id = input.slice("/resume ".length).trim();
    try {
      const loaded = await Session.load(id);
      holder.agent = new Agent({ config, permissionGate, session: loaded, toolRegistry: registry });
      print(color("gray", `(resumed ${id} — ${loaded.messages.length} messages)`));
    } catch {
      print(color("yellow", `couldn't load session "${id}" — see /sessions`));
    }
    return "handled";
  }
  if (input === "/reset") {
    holder.agent = new Agent({ config, permissionGate, toolRegistry: registry });
    print(color("gray", `(new session ${holder.agent.session.id})`));
    return "handled";
  }
  if (input === "/tools") {
    print(color("gray", holder.agent._describeTools()));
    return "handled";
  }
  if (input === "/update") {
    const res = await autoUpdate((line) => print(color("gray", `[update] ${line}`)));
    print(color(res.updated ? "green" : "gray", `[update] ${res.message || (res.updated ? "updated" : "no update")}`));
    if (res.updated) print(color("yellow", "restart fcode to apply the update"));
    return "handled";
  }
  if (input === "/models") {
    let files = [];
    try {
      files = (await fs.readdir(MODELS_DIR)).filter((f) => f.endsWith(".gguf"));
    } catch {}
    print(color("gray", `installed models: ${files.join(", ") || "none"}`));
    print(color("gray", `active: ${config.model}   (use /model to change)`));
    return "handled";
  }
  if (input === "/gpu") {
    const cfg = holder.engineConfig || {};
    const variant = cfg.variant || "cpu";
    if (variant === "cpu") {
      print(color("yellow", "engine build: CPU-only (no GPU offload)."));
      print(color("gray", "For GPU acceleration, reinstall with FREECODE_ENGINE_VARIANT=cuda (NVIDIA) or vulkan, then /model."));
    } else {
      const ngl = config.perf?.num_gpu ?? 999;
      print(color("green", `engine build: ${variant} · offloading up to ${ngl} layers to GPU.`));
    }
    const props = await engineProps(config.host);
    if (props?.default_generation_settings?.n_ctx)
      print(color("gray", `context: ${props.default_generation_settings.n_ctx} tokens`));
    return "handled";
  }
  if (input === "/model") {
    // Re-run the setup wizard to pick/install a different model, then restart
    // the engine and rebuild the agent against it. The wizard needs stdin: in
    // the TUI we suspend it and run on the bare terminal; in classic we hand the
    // wizard the existing readline so a second reader doesn't fight for input.
    if (!stdin.isTTY) {
      print(color("yellow", "run /model in an interactive terminal to switch models"));
      return "handled";
    }
    try {
      ui?.suspend?.();
      holder.engine?.stop();
      const { engine, engineConfig, modelName } = await ensureEngineReady({
        perf: config.perf,
        force: true,
        ask: ui?.ask,
      });
      holder.engine = engine;
      holder.engineConfig = engineConfig;
      config.host = engine.baseUrl;
      config.model = modelName;
      holder.agent = new Agent({ config, permissionGate, toolRegistry: registry });
      print(color("green", `(switched to ${modelName})`));
    } catch (err) {
      print(color("yellow", `model switch failed: ${err.message}`));
    } finally {
      ui?.resume?.();
    }
    return "handled";
  }
  if (input === "/index") {
    try {
      const s = await buildAndRefresh({ root: process.cwd(), onLog: (m) => print(color("gray", `  ${m}`)) });
      print(color("green", `code graph: ${s.nodes} symbols, ${s.edges} edges (${s.files} files, ${s.parsed} parsed, ${s.reused} cached, ${s.ms}ms)`));
    } catch (err) {
      print(color("yellow", `indexing failed: ${err.message}`));
    }
    return "handled";
  }
  if (input.startsWith("/graph ")) {
    const name = input.slice("/graph ".length).trim();
    const hits = await cgSearch(name, 8);
    if (!hits.length) {
      print(color("gray", `no symbol matching "${name}" — try /index to (re)build the graph`));
      return "handled";
    }
    for (const h of hits.slice(0, 5)) {
      print(color("cyan", `${h.name}`) + color("gray", ` ${h.kind} · ${h.file}:${h.line}`));
    }
    const top = hits[0].name;
    const cr = await cgCallers(top);
    const ce = await cgCallees(top);
    print(color("gray", `callers of ${top}: `) + (cr.callers.map((c) => c.name).join(", ") || "none"));
    print(color("gray", `${top} calls: `) + (ce.callees.map((c) => c.name).join(", ") || "none"));
    return "handled";
  }
  return "pass";
}

async function setup() {
  const config = { ...DEFAULT_CONFIG };
  // Ensure the bundled llama.cpp engine + a chosen model are installed (running
  // the first-run wizard if not), then boot llama-server and point config at it.
  let engine, engineConfig, modelName;
  try {
    ({ engine, engineConfig, modelName } = await ensureEngineReady({ perf: config.perf }));
  } catch (err) {
    console.error(color("red", `\nFree Code couldn't start its engine: ${err.message}`));
    process.exit(1);
  }
  config.host = engine.baseUrl;
  config.model = modelName;

  const registry = new ToolRegistry();
  const mcpSummary = await registry.loadMcpServers((line) => console.log(color("gray", `  ${line}`)));

  // Build the code graph so the code_* tools work from the first message. First
  // run downloads the tree-sitter runtime + grammars (~7MB); later runs are
  // incremental and fast. Non-fatal — a failure just leaves the graph empty.
  try {
    process.stdout.write(color("gray", "indexing code graph…\n"));
    const gs = await buildAndRefresh({
      root: process.cwd(),
      onLog: (m) => process.stdout.write(color("gray", `  ${m}\n`)),
    });
    console.log(color("gray", `  code graph: ${gs.nodes} symbols · ${gs.edges} edges · ${gs.files} files (${gs.ms}ms)`));
  } catch (err) {
    console.log(color("yellow", `  code graph unavailable: ${err.message}`));
  }

  return { config, registry, mcpSummary, engine, engineConfig };
}

export async function main() {
  // Auto-update: check GitHub, fast-forward a git checkout, and relaunch with
  // the new code so the user always runs the latest. Best-effort + throttled.
  const upd = await autoUpdate((line) => console.log(color("gray", `[update] ${line}`)));
  if (upd.updated && upd.restartNeeded) {
    console.log(color("green", "[update] " + upd.message));
    const r = spawnSync(process.execPath, [entryScript(), ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, FREECODE_UPDATED: "1" },
    });
    process.exit(r.status ?? 0);
  }

  const classic = process.argv.includes("--classic") || !process.stdout.isTTY;
  const ctx = await setup();
  // Always shut the llama-server process down when Free Code exits.
  const stopEngine = () => ctx.engine?.stop();
  process.on("exit", stopEngine);
  process.on("SIGINT", () => {
    stopEngine();
    process.exit(0);
  });

  if (classic) return runClassic(ctx);
  try {
    return await runTui(ctx);
  } catch (err) {
    // If the TUI fails to init for any reason, fall back to the classic REPL.
    console.error(color("yellow", `TUI unavailable (${err.message}); falling back to classic mode.`));
    return runClassic(ctx);
  }
}

// ---- Full-screen TUI mode ----
async function runTui({ config, registry, mcpSummary, engine, engineConfig }) {
  const holder = { engine, engineConfig };
  let tuiRef;
  const permissionGate = new PermissionGate(async (label, preview) => {
    tuiRef.println(color("gray", preview));
    return tuiRef.ask(label);
  });
  await permissionGate.load();
  holder.agent = new Agent({ config, permissionGate, toolRegistry: registry });

  const tui = new Tui({
    title: `Free Code · ${config.model}${mcpSummary.length ? " · mcp:" + mcpSummary.map((s) => s.server).join(",") : ""}`,
    onSubmit: async (input, signal) => {
      const res = await handleCommand(input, {
        config,
        registry,
        holder,
        permissionGate,
        print: (t) => tui.println(t),
        // For /model: suspend the TUI so the wizard's readline owns the terminal.
        ui: { suspend: () => tui.suspend(), resume: () => tui.resume() },
      });
      if (res === "quit") return tui._quit();
      if (res === "handled") return;

      const reply = await holder.agent.send(
        input,
        {
          onToken: (_p, count) => tui.setTokens(count),
          onToolCall: (name, args) => tui.println(fmtToolCall(name, args)),
          onToolResult: (name, resultText, ok) => tui.println(fmtToolResult(name, resultText, ok)),
          onDiagnostics: (_n, errors) => tui.println(c("yellow", "  ⚠ " + errors.split("\n")[0])),
          onDenied: (name) => tui.println(c("yellow", "  ✗ " + name + " denied")),
          onCompact: (n) => tui.println(color("gray", `  ⟳ compacting ${n} older messages…`)),
          onSubagent: (desc) => tui.println(c("blue", "🤖 subagent: ") + desc),
        },
        signal
      );
      tui.println(c("green", "◆ ") + reply);
    },
  });
  tuiRef = tui;
  tui.start();
  tui.println(color("gray", `session ${holder.agent.session.id} · ${COMMANDS}`));
}

// Compact single-line tool renderings for the TUI transcript.
function fmtToolCall(name, args) {
  if (name === "edit_file" && args.old_string != null)
    return c("magenta", "✏ " + name) + " " + color("gray", args.path || "");
  const s = JSON.stringify(args);
  return c("magenta", "🔧 " + name) + " " + color("gray", s.length > 100 ? s.slice(0, 100) + "…" : s);
}
function fmtToolResult(name, resultText, ok) {
  try {
    const p = JSON.parse(resultText);
    if (p.error) return c("red", "  ✗ " + p.error.split("\n")[0]);
  } catch {}
  return c("green", "  ✓ " + name);
}

// ---- Classic REPL mode ----
function runTurnHooks() {
  let spinner = null;
  return {
    onThinkStart: (step) => {
      spinner = new Spinner(`thinking (step ${step})`);
      spinner.begin();
    },
    onToken: (_p, count) => spinner?.setTokens(count),
    onThinkEnd: () => {
      spinner?.end();
      spinner = null;
    },
    onToolCall: (name, args) => printToolCall(name, args),
    onToolResult: (name, resultText, ok) => printToolResult(name, resultText, ok),
    onDiagnostics: (_n, errors) => console.log(`   ${color("yellow", "⚠ diagnostics: " + errors.split("\n")[0])}`),
    onDenied: (name) => console.log(`   ${color("yellow", "✗ " + name + " denied")}`),
    onCompact: (n) => console.log(color("gray", `   ⟳ compacting ${n} older messages…`)),
    onSubagent: (desc) => console.log(color("blue", "🤖 subagent: ") + color("gray", desc)),
    _stop: () => spinner?.end(),
  };
}

async function readAllStdin() {
  let data = "";
  for await (const chunk of stdin) data += chunk;
  return data;
}

async function runClassic({ config, registry, mcpSummary, engine, engineConfig }) {
  const interactive = process.stdin.isTTY;
  const rl = interactive ? readline.createInterface({ input: stdin, output: stdout }) : null;

  const permissionGate = new PermissionGate(async (label, preview) => {
    if (!rl) return "n"; // non-interactive: deny unless a persisted allow already matched
    console.log(color("gray", preview));
    try {
      return await rl.question(label + ": ");
    } catch {
      return "n";
    }
  });
  await permissionGate.load();
  const holder = { engine, engineConfig, agent: new Agent({ config, permissionGate, toolRegistry: registry }) };

  printBanner({
    version: "0.1.0",
    model: config.model,
    host: config.host,
    cwd: process.cwd(),
    session: holder.agent.session.id,
    mcp: mcpSummary.length ? mcpSummary.map((s) => s.server).join(", ") : null,
  });
  console.log(color("gray", "commands: ") + color("dim", COMMANDS) + "\n");

  const runTurn = async (input) => {
    const res = await handleCommand(input, {
      config,
      registry,
      holder,
      permissionGate,
      print: (t) => console.log(t),
      // Classic already owns stdin via `rl`; hand it to the /model wizard so a
      // second readline doesn't fight for input.
      ui: rl ? { ask: (q) => rl.question(q) } : {},
    });
    if (res === "quit") return "quit";
    if (res === "handled") return "handled";
    const hooks = runTurnHooks();
    try {
      const reply = await holder.agent.send(input, hooks);
      printAnswer(reply);
    } catch (err) {
      hooks._stop();
      const msg = err instanceof LLMError ? err.message : err.stack || err.message;
      console.error(`\n${color("red", "[error] " + msg)}\n`);
    }
    return "ok";
  };

  if (!interactive) {
    // Non-interactive: process every piped line in order (reliable, scriptable).
    const lines = (await readAllStdin()).split("\n");
    for (const line of lines) {
      const input = line.trim();
      if (!input) continue;
      console.log(color("cyan", "❯ ") + input);
      if ((await runTurn(input)) === "quit") break;
    }
    return;
  }

  while (true) {
    let raw;
    try {
      raw = await rl.question(color("cyan", "❯ "));
    } catch {
      break;
    }
    if (raw === undefined) break;
    const input = raw.trim();
    if (!input) continue;
    if ((await runTurn(input)) === "quit") break;
  }
  rl.close();
}
