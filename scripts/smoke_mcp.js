// Verifies the MCP client + ToolRegistry: starts the mock server, discovers
// its tool, and calls it through the registry (the same path the agent uses).
import fs from "node:fs/promises";
import path from "node:path";
import { ToolRegistry } from "../src/toolRegistry.js";
import { PROJECT_DIR } from "../src/config.js";

// Write a temp mcp.json pointing at the mock server.
await fs.mkdir(PROJECT_DIR, { recursive: true });
const serverPath = path.resolve("scripts/mock-mcp-server.js");
await fs.writeFile(
  path.join(PROJECT_DIR, "mcp.json"),
  JSON.stringify({ mcpServers: { mock: { command: process.execPath, args: [serverPath] } } }, null, 2)
);

const registry = new ToolRegistry();
const summary = await registry.loadMcpServers((l) => console.log("  " + l));
console.log("summary:", JSON.stringify(summary));

console.log("\n--- describe() includes MCP tool? ---");
const desc = registry.describe();
console.log(desc.includes("mock__echo") ? "YES: mock__echo listed" : "NO");

console.log("\n--- execute mock__echo ---");
const result = await registry.execute("mock__echo", { text: "hello mcp" });
console.log("result:", JSON.stringify(result));
console.log(result.result === "echo: hello mcp" ? "PASS" : "FAIL");

console.log("\n--- isMutating(mock__echo) [gated by default] ---");
console.log(registry.isMutating("mock__echo") === true ? "PASS (gated)" : "FAIL");

registry.stopAll();
await fs.rm(path.join(PROJECT_DIR, "mcp.json"), { force: true });
process.exit(0);
