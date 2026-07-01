import { spawn } from "node:child_process";

// Minimal MCP client over stdio (newline-delimited JSON-RPC 2.0).
// Speaks just enough of the protocol to discover and call tools.
export class McpClient {
  constructor(name, { command, args = [], env = {} }) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.env = env;
    this.proc = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = "";
    this.tools = [];
  }

  async start(timeoutMs = 15000) {
    // On Windows, launchers like npx/npm are .cmd files that need a shell to
    // resolve. But an explicit path (e.g. node.exe) must NOT use shell, or a
    // space in the path gets split. So: shell only for bare command names.
    const hasPathSep = this.command.includes("\\") || this.command.includes("/");
    const useShell = process.platform === "win32" && !hasPathSep;

    this.proc = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
    });

    this.proc.on("error", (err) => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`Failed to start MCP server "${this.name}": ${err.message}`));
      }
      this.pending.clear();
    });

    this.proc.stdout.setEncoding("utf8");
    this.proc.stdout.on("data", (chunk) => this._onData(chunk));
    this.proc.stderr.on("data", () => {}); // ignore server logs
    this.proc.on("exit", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`MCP server "${this.name}" exited`));
      }
      this.pending.clear();
    });

    const initP = this._request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "freecode", version: "0.1.0" },
      },
      timeoutMs
    );
    await initP;
    this._notify("notifications/initialized", {});

    const listed = await this._request("tools/list", {}, timeoutMs);
    this.tools = listed.tools || [];
    return this.tools;
  }

  _onData(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || "MCP error"));
        else resolve(msg.result);
      }
    }
  }

  _request(method, params, timeoutMs = 15000) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP "${this.name}" ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.proc.stdin.write(payload);
    });
  }

  _notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }

  async callTool(name, args) {
    const result = await this._request("tools/call", { name, arguments: args || {} });
    // MCP returns { content: [{type:'text', text:'...'}], isError? }
    if (result?.content) {
      const text = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      return { text, isError: !!result.isError };
    }
    return result;
  }

  stop() {
    try {
      this.proc?.kill();
    } catch {
      // already gone
    }
  }
}
