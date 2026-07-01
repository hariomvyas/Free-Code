import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { DEFAULT_CONFIG, pickModel } from "./config.js";
import { PermissionGate } from "./permission.js";
import { Agent } from "./agent.js";
import { Session } from "./session.js";
import { ToolRegistry } from "./toolRegistry.js";
import { spawnSync } from "node:child_process";
import { LLMError, checkOllama, runningModels } from "./llm.js";
import { Spinner, printToolCall, printToolResult, printAnswer, printBanner, color } from "./ui.js";
import { Tui, c } from "./tui.js";
import { autoUpdate, entryScript } from "./update.js";

const COMMANDS = "/model  /models  /gpu  /tools  /update  /sessions  /resume <id>  /reset  exit";

// Handles slash commands + exit. Returns "quit", "handled", or "pass".
// `print(text)` writes a line to the active surface (console or TUI).
async function handleCommand(input, { config, registry, holder, permissionGate, print }) {
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
    const s = await checkOllama(config.host);
    print(color("gray", `installed: ${s.models.join(", ") || "none"}`));
    return "handled";
  }
  if (input === "/gpu") {
    const loaded = await runningModels(config.host);
    if (!loaded.length) print(color("gray", "no model loaded yet — send a message first, then /gpu"));
    else {
      for (const m of loaded) {
        const pct = m.size ? Math.round((m.sizeVram / m.size) * 100) : 0;
        print(color("gray", `${m.name}: `) + (pct === 0 ? color("yellow", "100% CPU (GPU not used)") : color("green", `${pct}% on GPU`)));
      }
      if (loaded.every((m) => m.sizeVram === 0))
        print(color("yellow", "→ GPU idle. Update your GPU driver (README: GPU acceleration)."));
    }
    return "handled";
  }
  if (input.startsWith("/model ")) {
    const next = input.slice("/model ".length).trim();
    const s = await checkOllama(config.host);
    if (!s.models.includes(next)) {
      print(color("yellow", `model "${next}" not installed. pull it: ollama pull ${next}`));
      return "handled";
    }
    config.model = next;
    holder.agent.config.model = next;
    print(color("gray", `(model set to ${next})`));
    return "handled";
  }
  return "pass";
}

async function setup() {
  const config = { ...DEFAULT_CONFIG };
  const status = await checkOllama(config.host);
  if (!status.reachable) {
    console.error(`Free Code can't reach Ollama at ${config.host}.`);
    console.error(`Start it first: ollama serve (or launch the Ollama app), then run fcode again.`);
    process.exit(1);
  }
  config.model = pickModel(status.models);
  if (!status.models.includes(config.model)) {
    console.error(`Model "${config.model}" isn't pulled yet.  Get it: ollama pull ${config.model}`);
    console.error(`(or set FREECODE_MODEL to one you have: ${status.models.join(", ") || "none installed"})`);
    process.exit(1);
  }
  const registry = new ToolRegistry();
  const mcpSummary = await registry.loadMcpServers((line) => console.log(color("gray", `  ${line}`)));
  return { config, registry, mcpSummary };
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
  const { config, registry, mcpSummary } = await setup();
  if (classic) return runClassic({ config, registry, mcpSummary });
  try {
    return await runTui({ config, registry, mcpSummary });
  } catch (err) {
    // If the TUI fails to init for any reason, fall back to the classic REPL.
    console.error(color("yellow", `TUI unavailable (${err.message}); falling back to classic mode.`));
    return runClassic({ config, registry, mcpSummary });
  }
}

// ---- Full-screen TUI mode ----
async function runTui({ config, registry, mcpSummary }) {
  const holder = {};
  let tuiRef;
  const permissionGate = new PermissionGate(async (label, preview) => {
    tuiRef.println(color("gray", preview));
    return tuiRef.ask(label);
  });
  await permissionGate.load();
  holder.agent = new Agent({ config, permissionGate, toolRegistry: registry });

  const tui = new Tui({
    title: `Free Code · ${config.model}${mcpSummary.length ? " · mcp:" + mcpSummary.map((s) => s.server).join(",") : ""}`,
    onSubmit: async (input) => {
      const res = await handleCommand(input, {
        config,
        registry,
        holder,
        permissionGate,
        print: (t) => tui.println(t),
      });
      if (res === "quit") return tui._quit();
      if (res === "handled") return;

      const reply = await holder.agent.send(input, {
        onToken: (_p, count) => tui.setTokens(count),
        onToolCall: (name, args) => tui.println(fmtToolCall(name, args)),
        onToolResult: (name, resultText, ok) => tui.println(fmtToolResult(name, resultText, ok)),
        onDiagnostics: (_n, errors) => tui.println(c("yellow", "  ⚠ " + errors.split("\n")[0])),
        onDenied: (name) => tui.println(c("yellow", "  ✗ " + name + " denied")),
        onCompact: (n) => tui.println(color("gray", `  ⟳ compacting ${n} older messages…`)),
        onSubagent: (desc) => tui.println(c("blue", "🤖 subagent: ") + desc),
      });
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

async function runClassic({ config, registry, mcpSummary }) {
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
  const holder = { agent: new Agent({ config, permissionGate, toolRegistry: registry }) };

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
    const res = await handleCommand(input, { config, registry, holder, permissionGate, print: (t) => console.log(t) });
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
