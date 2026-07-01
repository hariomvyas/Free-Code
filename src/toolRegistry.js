import fs from "node:fs/promises";
import path from "node:path";
import { TOOLS, describeTools as describeBuiltins } from "./tools/index.js";
import { McpClient } from "./mcp.js";
import { PROJECT_DIR } from "./config.js";

const MCP_CONFIG = path.join(PROJECT_DIR, "mcp.json");

// Unifies built-in tools and MCP-server tools behind one interface the Agent uses.
export class ToolRegistry {
  constructor() {
    this.clients = [];
    this.mcpTools = new Map(); // toolName -> { client, def }
  }

  // Loads .freecode/mcp.json, starts each server, and registers its tools.
  // Returns a summary array [{ server, tools:[names], error? }].
  async loadMcpServers(onLog = () => {}) {
    let cfg;
    try {
      cfg = JSON.parse(await fs.readFile(MCP_CONFIG, "utf8"));
    } catch {
      return []; // no MCP config — built-ins only
    }
    const servers = cfg.mcpServers || {};
    const summary = [];
    for (const [name, spec] of Object.entries(servers)) {
      const client = new McpClient(name, spec);
      try {
        const tools = await client.start();
        this.clients.push(client);
        for (const def of tools) {
          // Namespaced to avoid collisions with built-ins / other servers.
          const toolName = `${name}__${def.name}`;
          this.mcpTools.set(toolName, { client, def });
        }
        summary.push({ server: name, tools: tools.map((t) => t.name) });
        onLog(`mcp "${name}": ${tools.length} tool(s)`);
      } catch (err) {
        summary.push({ server: name, error: err.message });
        onLog(`mcp "${name}" failed: ${err.message}`);
      }
    }
    return summary;
  }

  describe() {
    let out = describeBuiltins();
    if (this.mcpTools.size) {
      out += "\n";
      for (const [toolName, { def }] of this.mcpTools) {
        const props = def.inputSchema?.properties || {};
        const required = new Set(def.inputSchema?.required || []);
        const paramStr = Object.entries(props)
          .map(([k, v]) => `${k}${required.has(k) ? "" : "?"}: ${v.type || "any"}`)
          .join(", ");
        out += `\n- ${toolName}(${paramStr}) — ${def.description || "MCP tool"}`;
      }
    }
    return out;
  }

  isMutating(name) {
    if (name in TOOLS) return TOOLS[name].mutating;
    // MCP tools are gated by default — we can't know their side effects.
    return true;
  }

  async execute(name, args) {
    if (name in TOOLS) return TOOLS[name].run(args || {});
    const entry = this.mcpTools.get(name);
    if (!entry) throw new Error(`Unknown tool: ${name}`);
    const res = await entry.client.callTool(entry.def.name, args);
    if (res.isError) throw new Error(res.text || "MCP tool error");
    return { result: res.text ?? res };
  }

  stopAll() {
    for (const c of this.clients) c.stop();
  }
}
