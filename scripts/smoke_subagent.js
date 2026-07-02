// Verifies subagent delegation: the parent's task tool spawns a child agent
// that does real work and reports back; recursion is disabled for the child.
import fs from "node:fs/promises";
import { Agent } from "../src/agent.js";
import { bootConfig } from "./_boot.js";

await fs.writeFile("subagent_probe.txt", "the secret code is BANANA42\n");

const { config, engine } = await bootConfig();
const agent = new Agent({ config, permissionGate: { check: async () => true } });

// Sanity: parent advertises task; child would not.
console.log("parent has task tool:", agent._describeTools().includes("task("));
const child = new Agent({ config, permissionGate: { check: async () => true }, allowSubagents: false });
console.log("child has task tool:", child._describeTools().includes("task("));

let sawSub = false;
const reply = await agent.send(
  "Use the task tool to delegate this: read subagent_probe.txt and report the secret code it contains. " +
    "Then tell me the code.",
  {
    onSubagent: (d) => {
      sawSub = true;
      console.log("→ subagent spawned:", d);
    },
    onToolCall: (n) => console.log("   call:", n),
  }
);

console.log("\nfinal reply:", reply.slice(0, 120));
console.log("mentions BANANA42:", reply.includes("BANANA42"));
console.log("\nRESULT:", sawSub && reply.includes("BANANA42") ? "PASS" : "PARTIAL/FAIL");

await fs.rm("subagent_probe.txt", { force: true });
engine.stop();
