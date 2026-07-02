// Non-interactive end-to-end check: exercises the full model -> tool_call -> tool -> model loop.
import { Agent } from "../src/agent.js";
import { bootConfig } from "./_boot.js";

const autoApprove = { check: async () => true };

const { config, engine } = await bootConfig();
const agent = new Agent({ config, permissionGate: autoApprove });

const task =
  "Use write_file to create smoke_test_output.txt in the current directory with the exact content 'hello from freecode'. " +
  "Then use read_file to read it back and tell me what it contains.";

console.log(`model: ${config.model}\ntask: ${task}\n`);

const reply = await agent.send(task, {
  onToolCall: (name, args) => console.log(`  → ${name}(${JSON.stringify(args)})`),
  onDenied: (name) => console.log(`  ✗ denied: ${name}`),
});

console.log(`\nfinal reply:\n${reply}`);
engine.stop();
