// Exercises edit_file + grep + bash, and confirms a denied tool call doesn't crash the loop.
import fs from "node:fs/promises";
import { Agent } from "../src/agent.js";
import { DEFAULT_CONFIG } from "../src/config.js";

await fs.writeFile("scratch_input.txt", "line one\nTODO fix this\nline three\n", "utf8");

const denyBash = { check: async (name) => name !== "bash" };
const agent = new Agent({ config: DEFAULT_CONFIG, permissionGate: denyBash });

const task =
  "Use grep to find the line containing TODO in scratch_input.txt, then use edit_file to " +
  "replace 'TODO fix this' with 'DONE fixed' in that file, then try to run the bash command " +
  "'echo done' (it will be denied — that's expected, just report what happened), then give a final answer.";

const reply = await agent.send(task, {
  onToolCall: (name, args) => console.log(`  → ${name}(${JSON.stringify(args)})`),
  onDenied: (name) => console.log(`  ✗ denied: ${name}`),
});

console.log(`\nfinal reply:\n${reply}\n`);
console.log(`--- scratch_input.txt now ---`);
console.log(await fs.readFile("scratch_input.txt", "utf8"));
