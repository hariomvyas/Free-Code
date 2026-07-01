import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { DEFAULT_CONFIG, pickModel } from "./config.js";
import { PermissionGate } from "./permission.js";
import { Agent } from "./agent.js";
import { LLMError, checkOllama } from "./llm.js";
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

  let agent = new Agent({ config, permissionGate });

  console.log(color("bold", `Free Code v0.1.0`) + color("gray", ` — model: ${config.model}  host: ${config.host}`));
  console.log(color("gray", `cwd: ${process.cwd()}`));
  console.log(color("gray", `commands: /model <name>  /models  /reset  exit\n`));

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
    if (input === "/reset") {
      agent = new Agent({ config, permissionGate });
      console.log(color("gray", "(session reset)"));
      continue;
    }
    if (input === "/models") {
      const s = await checkOllama(config.host);
      console.log(color("gray", `installed: ${s.models.join(", ") || "none"}`));
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
