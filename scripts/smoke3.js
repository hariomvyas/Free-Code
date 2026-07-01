// Isolated check that a denied mutating tool call doesn't crash the agent loop.
import { Agent } from "../src/agent.js";
import { DEFAULT_CONFIG } from "../src/config.js";

const denyAll = { check: async () => false };
const agent = new Agent({ config: DEFAULT_CONFIG, permissionGate: denyAll });

const reply = await agent.send(
  "Run the bash command 'echo hello' and tell me its output.",
  {
    onToolCall: (name, args) => console.log(`  → ${name}(${JSON.stringify(args)})`),
    onDenied: (name) => console.log(`  ✗ denied: ${name}`),
  }
);

console.log(`\nfinal reply:\n${reply}`);
