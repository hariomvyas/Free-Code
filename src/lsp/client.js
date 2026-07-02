import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { languageIdForFile } from "./servers.js";

// A minimal LSP client: spawns one language server, speaks JSON-RPC over stdio
// with the `Content-Length` framing, drives the initialize handshake, syncs open
// documents, collects pushed diagnostics, and issues hover/definition/references
// requests. Pure Node — no npm dependency.
export class LspClient {
  constructor(server, root = process.cwd()) {
    this.server = server; // { id, bin, args, path }
    this.root = root;
    this.proc = null;
    this.seq = 0;
    this.pending = new Map(); // id → { resolve, reject }
    this.buf = Buffer.alloc(0);
    this.diagnostics = new Map(); // uri → [diagnostic]
    this.opened = new Map(); // uri → version
    this.ready = null;
    this.stderr = "";
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = this._start();
    return this.ready;
  }

  async _start() {
    this.proc = spawn(this.server.path || this.server.bin, this.server.args || [], {
      cwd: this.root,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.stdout.on("data", (d) => this._onData(d));
    this.proc.stderr.on("data", (d) => (this.stderr = (this.stderr + d).slice(-4000)));
    this.proc.on("exit", () => {
      for (const { reject } of this.pending.values()) reject(new Error("LSP server exited"));
      this.pending.clear();
    });

    const rootUri = pathToFileURL(this.root).toString();
    await this._request("initialize", {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: path.basename(this.root) }],
      capabilities: {
        textDocument: {
          synchronization: { didSave: true, dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
          hover: { contentFormat: ["plaintext", "markdown"] },
          definition: {},
          references: {},
          documentSymbol: {},
        },
        workspace: { workspaceFolders: true, configuration: true },
      },
    });
    this._notify("initialized", {});
    return this;
  }

  // ---- wire protocol -----------------------------------------------------
  _send(msg) {
    const json = JSON.stringify({ jsonrpc: "2.0", ...msg });
    const body = Buffer.from(json, "utf8");
    this.proc.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
    this.proc.stdin.write(body);
  }

  _request(method, params, timeoutMs = 15000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`LSP ${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => (clearTimeout(timer), resolve(v)),
        reject: (e) => (clearTimeout(timer), reject(e)),
      });
      this._send({ id, method, params });
    });
  }

  _notify(method, params) {
    this._send({ method, params });
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    // Parse as many complete `Content-Length`-framed messages as are buffered.
    while (true) {
      const headerEnd = this.buf.indexOf("\r\n\r\n");
      if (headerEnd < 0) return;
      const header = this.buf.slice(0, headerEnd).toString("utf8");
      const m = /Content-Length:\s*(\d+)/i.exec(header);
      if (!m) {
        this.buf = this.buf.slice(headerEnd + 4);
        continue;
      }
      const len = parseInt(m[1], 10);
      const start = headerEnd + 4;
      if (this.buf.length < start + len) return; // wait for more
      const body = this.buf.slice(start, start + len).toString("utf8");
      this.buf = this.buf.slice(start + len);
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        continue;
      }
      this._dispatch(msg);
    }
  }

  _dispatch(msg) {
    // Response to one of our requests.
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(msg.error.message || "LSP error")) : p.resolve(msg.result);
      }
      return;
    }
    // Server → client request: answer generically so the server doesn't stall.
    if (msg.id != null && msg.method) {
      let result = null;
      if (msg.method === "workspace/configuration") {
        result = (msg.params?.items || []).map(() => ({}));
      }
      this._send({ id: msg.id, result });
      return;
    }
    // Notification.
    if (msg.method === "textDocument/publishDiagnostics") {
      this.diagnostics.set(msg.params.uri, msg.params.diagnostics || []);
    }
  }

  // ---- document sync -----------------------------------------------------
  async openOrUpdate(filePath, text) {
    const uri = pathToFileURL(path.resolve(this.root, filePath)).toString();
    const languageId = languageIdForFile(filePath) || "plaintext";
    if (!this.opened.has(uri)) {
      this.opened.set(uri, 1);
      this._notify("textDocument/didOpen", {
        textDocument: { uri, languageId, version: 1, text },
      });
    } else {
      const version = this.opened.get(uri) + 1;
      this.opened.set(uri, version);
      this._notify("textDocument/didChange", {
        textDocument: { uri, version },
        contentChanges: [{ text }], // full sync
      });
    }
    return uri;
  }

  // Wait until diagnostics for `uri` arrive or a short window elapses.
  async waitDiagnostics(uri, windowMs = 2000) {
    const deadline = Date.now() + windowMs;
    // If the server already published, return promptly but still give it a beat
    // to send an updated set after a change.
    await sleep(250);
    while (Date.now() < deadline) {
      if (this.diagnostics.has(uri)) return this.diagnostics.get(uri);
      await sleep(100);
    }
    return this.diagnostics.get(uri) || [];
  }

  hover(uri, line, character) {
    return this._request("textDocument/hover", pos(uri, line, character));
  }
  definition(uri, line, character) {
    return this._request("textDocument/definition", pos(uri, line, character));
  }
  references(uri, line, character) {
    return this._request("textDocument/references", {
      ...pos(uri, line, character),
      context: { includeDeclaration: true },
    });
  }

  stop() {
    try {
      this._notify("shutdown", {});
      this._notify("exit", {});
    } catch {}
    try {
      this.proc?.kill();
    } catch {}
  }
}

function pos(uri, line, character) {
  return { textDocument: { uri }, position: { line, character } };
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Convert an LSP file:// URI back to a repo-relative path for display.
export function uriToRel(uri, root = process.cwd()) {
  try {
    return path.relative(root, fileURLToPath(uri)).split(path.sep).join("/");
  } catch {
    return uri;
  }
}
