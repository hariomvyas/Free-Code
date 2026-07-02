import fs from "node:fs/promises";
import path from "node:path";
import { getParser } from "./runtime.js";
import { langForFile } from "./grammars.js";
import { extract } from "./extract.js";
import { loadGraph, saveGraph, emptyGraph } from "./store.js";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", ".freecode", ".codegraph", "dist", "build",
  "out", "coverage", ".next", ".cache", "vendor", "target", "__pycache__",
]);
const MAX_FILE_BYTES = 1_000_000; // skip very large files

// Recursively list supported source files under `root` (relative paths).
async function listSourceFiles(root) {
  const out = [];
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") && e.isDirectory() && !IGNORE_DIRS.has(e.name)) {
        // allow dotdirs generally, but still skip the known-noise ones below
      }
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (IGNORE_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile() && langForFile(e.name)) {
        out.push(full);
      }
    }
  }
  await walk(root);
  // Normalize to forward slashes so ids/paths are stable across OSes.
  return out.map((f) => path.relative(root, f).split(path.sep).join("/"));
}

function nodeId(file, name, startLine) {
  return `${file}:${name}:${startLine}`;
}

// Build (or incrementally update) the code graph for `root` (default: cwd).
// Reparses only files whose mtime/size changed; re-resolves all edges. Returns
// { nodes, edges, files, parsed, reused, langs, ms }.
export async function buildGraph({ root = process.cwd(), onLog = () => {}, force = false } = {}) {
  const t0 = Date.now();
  const prev = force ? emptyGraph() : await loadGraph();
  const graph = emptyGraph();

  const files = await listSourceFiles(root);
  const parsers = new Map(); // lang → parser (reused across files)
  let parsed = 0;
  let reused = 0;
  const langs = new Set();

  for (const rel of files) {
    const abs = path.join(root, rel);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      continue;
    }
    if (stat.size > MAX_FILE_BYTES) continue;
    const lang = langForFile(rel);
    langs.add(lang);

    const prevFile = prev.files[rel];
    if (prevFile && prevFile.mtime === stat.mtimeMs && prevFile.size === stat.size) {
      // Unchanged — carry the cached defs + refs forward.
      graph.files[rel] = prevFile;
      for (const id of prevFile.defIds) if (prev.nodes[id]) graph.nodes[id] = prev.nodes[id];
      reused++;
      continue;
    }

    // Reparse.
    let parser = parsers.get(lang);
    if (!parser) {
      parser = await getParser(lang, onLog);
      if (!parser) continue;
      parsers.set(lang, parser);
    }
    let src;
    try {
      src = await fs.readFile(abs, "utf8");
    } catch {
      continue;
    }
    const tree = parser.parse(src);
    const { defs, refs } = extract(tree, lang);
    tree.delete?.();

    const defIds = [];
    const indexToId = new Map();
    for (const d of defs) {
      const id = nodeId(rel, d.name, d.startLine);
      graph.nodes[id] = { id, name: d.name, kind: d.kind, file: rel, lang, ...d };
      defIds.push(id);
      indexToId.set(d.startIndex, id);
    }
    // Store refs with the enclosing def resolved to a node id (or null).
    const fileRefs = refs.map((r) => ({
      name: r.name,
      line: r.line,
      from: r.fromIndex != null ? indexToId.get(r.fromIndex) ?? null : null,
    }));
    graph.files[rel] = { mtime: stat.mtimeMs, size: stat.size, defIds, refs: fileRefs };
    parsed++;
  }

  resolveEdges(graph);
  graph.builtAt = new Date().toISOString();
  await saveGraph(graph);

  return {
    nodes: Object.keys(graph.nodes).length,
    edges: graph.edges.length,
    files: files.length,
    parsed,
    reused,
    langs: [...langs].filter(Boolean),
    ms: Date.now() - t0,
  };
}

// Resolve name-based references into caller→callee edges across the whole graph.
function resolveEdges(graph) {
  const nameIndex = new Map(); // name → [ids]
  for (const id in graph.nodes) {
    const n = graph.nodes[id];
    if (!nameIndex.has(n.name)) nameIndex.set(n.name, []);
    nameIndex.get(n.name).push(id);
  }
  const seen = new Set();
  const edges = [];
  for (const rel in graph.files) {
    for (const r of graph.files[rel].refs || []) {
      if (!r.from) continue; // file-scope call — no caller node
      const targets = nameIndex.get(r.name);
      if (!targets) continue;
      for (const to of targets) {
        if (to === r.from) continue;
        const key = r.from + " " + to;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from: r.from, to });
      }
    }
  }
  graph.edges = edges;
}
