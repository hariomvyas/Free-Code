import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { DEFAULT_CONFIG, pickModel } from "./config.js";
import { PermissionGate } from "./permission.js";
import { Agent } from "./agent.js";
import { Session } from "./session.js";
import { ToolRegistry } from "./toolRegistry.js";
import { LLMError, checkOllama, runningModels } from "./llm.js";
import { Spinner, printToolCall, printToolResult, printAnswer, color } from "./ui.js";

export async function main() {
  const config = { ...DEFAULT_CONFIG };

  const status = await checkOllama(config.host);
  if (!status.reachable) {
    console.error(`Free Code can't reach Ollama at ${config.host}.`);
    console.error(`Start it first: ollama serve`);
    console.error(`(or launch the Ollama desktop app), then run fcode again.`);
    process.exit(1);
  }

  // Auto-select the strongest installed coder model unless the user pinned one.
  config.model = pickModel(status.models);

  if (!status.models.includes(config.model)) {
    console.error(`Model "${config.model}" isn't pulled yet.`);
    console.error(`Get it with: ollama pull ${config.model}`);
    console.error(`(or set FREECODE_MODEL to a model you already have: ${status.models.join(", ") || "none installed"})`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });

  const permissionGate = new PermissionGate(rl);
  await permissionGate.load();

  // Start any MCP servers declared in .freecode/mcp.json and merge their tools.
  const registry = new ToolRegistry();
  const mcpSummary = await registry.loadMcpServers((line) => console.log(color("gray", `  ${line}`)));

  let agent = new Agent({ config, permissionGate, toolRegistry: registry });

  console.log(color("bold", `Free Code v0.1.0`) + color("gray", ` — model: ${config.model}  host: ${config.host}`));
  console.log(color("gray", `cwd: ${process.cwd()}`));
  console.log(color("gray", `session: ${agent.session.id}`));
  if (mcpSummary.length) {
    console.log(color("gray", `mcp servers: ${mcpSummary.map((s) => s.server).join(", ")}`));
  }
  console.log(color("gray", `commands: /model <name>  /models  /gpu  /tools  /sessions  /resume <id>  /reset  exit\n`));

  while (true) {
    let raw;
    try {
      raw = await rl.question(color("cyan", "you> "));
    } catch {
      break; // readline closed (Ctrl+D / EOF)
    }
    if (raw === undefined) break; // stdin ended
    const input = raw.trim();
    if (!input) continue;
    if (input === "exit" || input === "quit") break;
    if (input === "/sessions") {
      const sessions = await Session.list();
      if (!sessions.length) {
        console.log(color("gray", "no saved sessions yet"));
      } else {
        for (const s of sessions.slice(0, 20)) {
          console.log(
            color("cyan", s.id) +
              color("gray", `  ${s.turns} turn(s)  ${s.model || "?"}  — ${s.title}`)
          );
        }
      }
      continue;
    }
    if (input.startsWith("/resume ")) {
      const id = input.slice("/resume ".length).trim();
      try {
        const loaded = await Session.load(id);
        agent = new Agent({ config, permissionGate, session: loaded, toolRegistry: registry });
        console.log(color("gray", `(resumed ${id} — ${loaded.messages.length} messages)`));
      } catch {
        console.log(color("yellow", `couldn't load session "${id}" — check /sessions for valid ids`));
      }
      continue;
    }
    if (input === "/reset") {
      agent = new Agent({ config, permissionGate, toolRegistry: registry });
      console.log(color("gray", `(new session ${agent.session.id})`));
      continue;
    }
    if (input === "/tools") {
      console.log(color("gray", agent._describeTools()));
      continue;
    }
    if (input === "/models") {
      const s = await checkOllama(config.host);
      console.log(color("gray", `installed: ${s.models.join(", ") || "none"}`));
      continue;
    }
    if (input === "/gpu") {
      const loaded = await runningModels(config.host);
      if (!loaded.length) {
        console.log(color("gray", "no model loaded yet — send a message first, then /gpu"));
      } else {
        for (const m of loaded) {
          const pctGpu = m.size ? Math.round((m.sizeVram / m.size) * 100) : 0;
          const where = pctGpu === 0 ? color("yellow", "100% CPU (GPU not used)") : color("green", `${pctGpu}% on GPU`);
          console.log(color("gray", `${m.name}: `) + where);
        }
        if (loaded.every((m) => m.sizeVram === 0)) {
          console.log(color("yellow", "→ GPU idle. If you have an NVIDIA/AMD GPU, update its driver (see README: GPU acceleration)."));
        }
      }
      continue;
    }
    if (input.startsWith("/model ")) {
      const next = input.slice("/model ".length).trim();
      const s = await checkOllama(config.host);
      if (!s.models.includes(next)) {
        console.log(color("yellow", `model "${next}" not installed. pull it: ollama pull ${next}`));
        continue;
      }
      config.model = next;
      agent.config.model = next;
      console.log(color("gray", `(model set to ${next})`));
      continue;
    }

    let spinner = null;
    try {
      const reply = await agent.send(input, {
        onThinkStart: (step) => {
          spinner = new Spinner(`thinking (step ${step})`);
          spinner.begin();
        },
        onToken: (_piece, count) => spinner?.setTokens(count),
        onThinkEnd: () => {
          spinner?.end();
          spinner = null;
        },
        onToolCall: (name, args) => printToolCall(name, args),
        onToolResult: (name, resultText, ok) => printToolResult(name, resultText, ok),
        onDiagnostics: (_name, errors) =>
          console.log(`   ${color("yellow", "⚠ diagnostics: " + errors.split("\n")[0])}`),
        onDenied: (name) => console.log(`   ${color("yellow", "✗ " + name + " denied")}`),
      });
      printAnswer(reply);
    } catch (err) {
      spinner?.end();
      if (err instanceof LLMError) {
        console.error(`\n${color("red", "[error] " + err.message)}\n`);
      } else {
        console.error(`\n${color("red", "[error] " + (err.stack || err.message))}\n`);
      }
    }
  }

  rl.close();
}
