import fs from "node:fs/promises";
import path from "node:path";
import { loadGraph } from "./store.js";

// In-process cache of the loaded graph. Invalidated after a rebuild.
let cached = null;
export async function getGraph() {
  if (!cached) cached = await loadGraph();
  return cached;
}
export function invalidate(graph = null) {
  cached = graph;
}

function slim(n) {
  return { id: n.id, name: n.name, kind: n.kind, file: n.file, line: n.startLine };
}

function idsForName(graph, name) {
  const ids = [];
  for (const id in graph.nodes) if (graph.nodes[id].name === name) ids.push(id);
  return ids;
}

// Fuzzy symbol search: exact matches first, then prefix, then substring.
export async function search(term, limit = 25) {
  const graph = await getGraph();
  const t = term.toLowerCase();
  const scored = [];
  for (const id in graph.nodes) {
    const n = graph.nodes[id];
    const name = n.name.toLowerCase();
    let score = -1;
    if (name === t) score = 0;
    else if (name.startsWith(t)) score = 1;
    else if (name.includes(t)) score = 2;
    if (score >= 0) scored.push([score, n]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1].name.length - b[1].name.length);
  return scored.slice(0, limit).map(([, n]) => slim(n));
}

// Direct callers of any def named `name`.
export async function callers(name) {
  const graph = await getGraph();
  const targets = new Set(idsForName(graph, name));
  if (!targets.size) return { found: false, name, callers: [] };
  const out = new Map();
  for (const e of graph.edges) {
    if (targets.has(e.to) && graph.nodes[e.from]) out.set(e.from, slim(graph.nodes[e.from]));
  }
  return { found: true, name, callers: [...out.values()] };
}

// Direct callees (functions called by any def named `name`).
export async function callees(name) {
  const graph = await getGraph();
  const sources = new Set(idsForName(graph, name));
  if (!sources.size) return { found: false, name, callees: [] };
  const out = new Map();
  for (const e of graph.edges) {
    if (sources.has(e.from) && graph.nodes[e.to]) out.set(e.to, slim(graph.nodes[e.to]));
  }
  return { found: true, name, callees: [...out.values()] };
}

// Transitive callers ("blast radius") of `name`, up to maxDepth hops.
export async function impact(name, maxDepth = 5) {
  const graph = await getGraph();
  const start = idsForName(graph, name);
  if (!start.length) return { found: false, name, impacted: [] };
  // Reverse adjacency: to → [from].
  const rev = new Map();
  for (const e of graph.edges) {
    if (!rev.has(e.to)) rev.set(e.to, []);
    rev.get(e.to).push(e.from);
  }
  const seen = new Set(start);
  let frontier = [...start];
  const impacted = [];
  for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
    const next = [];
    for (const id of frontier) {
      for (const from of rev.get(id) || []) {
        if (seen.has(from)) continue;
        seen.add(from);
        if (graph.nodes[from]) {
          impacted.push({ ...slim(graph.nodes[from]), depth });
          next.push(from);
        }
      }
    }
    frontier = next;
  }
  return { found: true, name, impacted };
}

// Rich context for a query: matching defs with their source, plus immediate
// callers/callees names. `root` is used to resolve file paths for reading source.
export async function explore(term, { root = process.cwd(), limit = 6, maxChars = 1600 } = {}) {
  const graph = await getGraph();
  const matches = await search(term, limit);
  const results = [];
  for (const m of matches) {
    const node = graph.nodes[m.id];
    let source = null;
    try {
      const raw = await fs.readFile(path.join(root, node.file), "utf8");
      source = raw.slice(node.startIndex, node.endIndex);
      if (source.length > maxChars) source = source.slice(0, maxChars) + "\n… (truncated)";
    } catch {}
    const cr = await callers(node.name);
    const ce = await callees(node.name);
    results.push({
      name: node.name,
      kind: node.kind,
      file: node.file,
      startLine: node.startLine,
      endLine: node.endLine,
      calledBy: cr.callers.map((c) => `${c.name} (${c.file}:${c.line})`),
      calls: ce.callees.map((c) => `${c.name} (${c.file}:${c.line})`),
      source,
    });
  }
  return { term, count: results.length, results };
}
