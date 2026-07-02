import fs from "node:fs/promises";
import path from "node:path";
import { PROJECT_DIR } from "../config.js";

// The code graph is stored per-project alongside sessions/logs, as plain JSON
// (no SQLite dependency). Rebuilt incrementally from file mtimes.
export const GRAPH_FILE = path.join(PROJECT_DIR, "codegraph.json");

export const GRAPH_VERSION = 1;

export function emptyGraph() {
  return { version: GRAPH_VERSION, builtAt: null, files: {}, nodes: {}, edges: [] };
}

export async function loadGraph() {
  try {
    const g = JSON.parse(await fs.readFile(GRAPH_FILE, "utf8"));
    if (g.version !== GRAPH_VERSION) return emptyGraph(); // schema changed → rebuild
    return g;
  } catch {
    return emptyGraph();
  }
}

export async function saveGraph(graph) {
  await fs.mkdir(path.dirname(GRAPH_FILE), { recursive: true });
  await fs.writeFile(GRAPH_FILE, JSON.stringify(graph), "utf8");
}
