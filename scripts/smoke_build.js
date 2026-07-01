// Proves the agent can BUILD a small multi-file project and run it.
// Uses an auto-approve gate. Set FREECODE_MODEL to pick the model.
import fs from "node:fs/promises";
import path from "node:path";
import { Agent } from "../src/agent.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import { Spinner, printToolCall, printToolResult, printAnswer } from "../src/ui.js";

const workdir = path.join(process.cwd(), "build_test");
await fs.rm(workdir, { recursive: true, force: true });
await fs.mkdir(workdir, { recursive: true });
process.chdir(workdir);

const autoApprove = { check: async () => true };
const agent = new Agent({ config: DEFAULT_CONFIG, permissionGate: autoApprove });

const task =
  "Build a tiny Node.js project in the current directory:\n" +
  "1. Create sum.js that exports a function add(a, b) returning a + b (use ES module syntax: export function).\n" +
  "2. Create main.js that imports add from ./sum.js and prints add(2, 3) to the console.\n" +
  "3. Create package.json with {\"type\": \"module\"}.\n" +
  "4. Run 'node main.js' with the bash tool and confirm it prints 5.\n" +
  "Do each step with the appropriate tool, then give a final answer.";

console.log(`MODEL: ${DEFAULT_CONFIG.model}\n`);

let spinner = null;
const t0 = Date.now();
const reply = await agent.send(task, {
  onThinkStart: (step) => {
    spinner = new Spinner(`thinking (step ${step})`);
    spinner.begin();
  },
  onToken: (_p, count) => spinner?.setTokens(count),
  onThinkEnd: () => {
    spinner?.end();
    spinner = null;
  },
  onToolCall: printToolCall,
  onToolResult: printToolResult,
  onDenied: (name) => console.log(`   denied: ${name}`),
});
printAnswer(reply);

console.log(`\n=== VERIFICATION (${((Date.now() - t0) / 1000).toFixed(1)}s) ===`);
for (const f of ["sum.js", "main.js", "package.json"]) {
  const content = await fs.readFile(f, "utf8").catch(() => null);
  console.log(`\n--- ${f} ${content === null ? "[MISSING]" : ""} ---`);
  if (content !== null) console.log(content.trim());
}
