import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { DEFAULT_CONFIG } from "./config.js";
import { PermissionGate } from "./permission.js";
import { Agent } from "./agent.js";
import { LLMError, checkOllama } from "./llm.js";

export async function main() {
  const config = { ...DEFAULT_CONFIG };

  const status = await checkOllama(config.host);
  if (!status.reachable) {
    console.error(`Free Code can't reach Ollama at ${config.host}.`);
    console.error(`Start it first: ollama serve`);
    console.error(`(or launch the Ollama desktop app), then run fcode again.`);
    process.exit(1);
  }
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

  console.log(`Free Code v0.1.0 — model: ${config.model}  host: ${config.host}`);
  console.log(`cwd: ${process.cwd()}`);
  console.log(`commands: /model <name>  /reset  exit\n`);

  while (true) {
    const input = (await rl.question("you> ")).trim();
    if (!input) continue;
    if (input === "exit" || input === "quit") break;
    if (input === "/reset") {
      agent = new Agent({ config, permissionGate });
      console.log("(session reset)");
      continue;
    }
    if (input.startsWith("/model ")) {
      config.model = input.slice("/model ".length).trim();
      console.log(`(model set to ${config.model})`);
      continue;
    }

    try {
      const reply = await agent.send(input, {
        onToolCall: (name, args) => {
          const argStr = JSON.stringify(args);
          console.log(`  → ${name}(${argStr.length > 200 ? argStr.slice(0, 200) + "…" : argStr})`);
        },
        onDenied: (name) => console.log(`  ✗ ${name} denied`),
      });
      console.log(`\nfcode> ${reply}\n`);
    } catch (err) {
      if (err instanceof LLMError) {
        console.error(`\n[error] ${err.message}\n`);
      } else {
        console.error(`\n[error] ${err.stack || err.message}\n`);
      }
    }
  }

  rl.close();
}
