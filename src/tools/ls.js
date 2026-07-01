import fs from "node:fs/promises";
import path from "node:path";

const SKIP = new Set(["node_modules", ".git", ".freecode", "dist", "build", ".next", ".venv", "__pycache__"]);

export const schema = {
  type: "function",
  function: {
    name: "ls",
    description: "List files and directories at a path (one level, or recursive tree). Good for exploring project structure.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list (default: cwd)" },
        recursive: { type: "boolean", description: "List a recursive tree (default false)" },
        max_entries: { type: "integer", description: "Max entries to return (default 200)" },
      },
    },
  },
};

export async function run({ path: dir, recursive, max_entries }) {
  const base = path.resolve(process.cwd(), dir || ".");
  const cap = max_entries || 200;
  const entries = [];

  async function walk(d, depth) {
    if (entries.length >= cap) return;
    let items;
    try {
      items = await fs.readdir(d, { withFileTypes: true });
    } catch (err) {
      throw new Error(`cannot list ${d}: ${err.message}`);
    }
    items.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1));
    for (const it of items) {
      if (entries.length >= cap) return;
      if (SKIP.has(it.name)) continue;
      const rel = path.relative(process.cwd(), path.join(d, it.name));
      entries.push(`${"  ".repeat(depth)}${it.isDirectory() ? "📁 " : "📄 "}${rel}`);
      if (recursive && it.isDirectory()) await walk(path.join(d, it.name), depth + 1);
    }
  }

  await walk(base, 0);
  return { path: base, entries, count: entries.length, truncated: entries.length >= cap };
}
