import fs from "node:fs/promises";
import path from "node:path";
import { LspClient, uriToRel } from "./client.js";
import { serverForFile, which } from "./servers.js";

const SEVERITY = { 1: "error", 2: "warning", 3: "info", 4: "hint" };

// Owns one LspClient per language server, started lazily on first use for a file
// of that language. Everything degrades gracefully when a server isn't installed.
export class LspManager {
  constructor(root = process.cwd()) {
    this.root = root;
    this.clients = new Map(); // server.id → LspClient
  }

  // Returns a started client for the file's language, or null when no server is
  // installed for it.
  async clientForFile(filePath) {
    const server = serverForFile(filePath);
    if (!server) return null;
    if (!this.clients.has(server.id)) {
      const found = which(server.bin);
      if (!found) return null; // not installed
      const client = new LspClient({ ...server, path: found }, this.root);
      this.clients.set(server.id, client);
      await client.start();
    }
    return this.clients.get(server.id);
  }

  async _open(filePath) {
    const client = await this.clientForFile(filePath);
    if (!client) return null;
    const text = await fs.readFile(path.resolve(this.root, filePath), "utf8");
    const uri = await client.openOrUpdate(filePath, text);
    return { client, uri, text };
  }

  // Real diagnostics for a file (compiler/type errors), or an "unavailable" note
  // naming how to install the server. Used by the post-edit loop + lsp_diagnostics.
  async diagnostics(filePath) {
    const server = serverForFile(filePath);
    if (!server) return { available: false, reason: "no language server maps to this file type" };
    if (!which(server.bin)) {
      return { available: false, server: server.id, install: server.install, reason: `${server.bin} not installed` };
    }
    const opened = await this._open(filePath);
    if (!opened) return { available: false, reason: "server unavailable" };
    const diags = await opened.client.waitDiagnostics(opened.uri);
    return {
      available: true,
      server: server.id,
      file: filePath,
      diagnostics: diags.map((d) => ({
        severity: SEVERITY[d.severity] || "info",
        line: (d.range?.start?.line ?? 0) + 1,
        character: (d.range?.start?.character ?? 0) + 1,
        message: d.message,
        source: d.source,
      })),
    };
  }

  async hover(filePath, line1, char1) {
    const opened = await this._open(filePath);
    if (!opened) return { available: false, reason: "no language server for this file" };
    const res = await opened.client.hover(opened.uri, line1 - 1, (char1 || 1) - 1);
    return { available: true, text: hoverText(res) };
  }

  async definition(filePath, line1, char1) {
    const opened = await this._open(filePath);
    if (!opened) return { available: false, reason: "no language server for this file" };
    const res = await opened.client.definition(opened.uri, line1 - 1, (char1 || 1) - 1);
    return { available: true, locations: normalizeLocations(res, this.root) };
  }

  async references(filePath, line1, char1) {
    const opened = await this._open(filePath);
    if (!opened) return { available: false, reason: "no language server for this file" };
    const res = await opened.client.references(opened.uri, line1 - 1, (char1 || 1) - 1);
    return { available: true, locations: normalizeLocations(res, this.root) };
  }

  stopAll() {
    for (const c of this.clients.values()) c.stop();
    this.clients.clear();
  }
}

// LSP definition/references return Location | Location[] | LocationLink[].
function normalizeLocations(res, root) {
  if (!res) return [];
  const arr = Array.isArray(res) ? res : [res];
  return arr.map((loc) => {
    const uri = loc.uri || loc.targetUri;
    const range = loc.range || loc.targetSelectionRange || loc.targetRange;
    return {
      file: uriToRel(uri, root),
      line: (range?.start?.line ?? 0) + 1,
      character: (range?.start?.character ?? 0) + 1,
    };
  });
}

function hoverText(res) {
  if (!res || !res.contents) return "";
  const cts = res.contents;
  if (typeof cts === "string") return cts;
  if (Array.isArray(cts)) return cts.map((c) => (typeof c === "string" ? c : c.value || "")).join("\n").trim();
  if (typeof cts === "object") return cts.value || "";
  return "";
}

// Process-wide singleton so tools + the edit loop share language servers.
let _manager = null;
export function getManager() {
  if (!_manager || _manager.root !== process.cwd()) _manager = new LspManager(process.cwd());
  return _manager;
}
