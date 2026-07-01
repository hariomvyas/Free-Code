import fs from "node:fs/promises";
import path from "node:path";
import { walk } from "./walk.js";

export const schema = {
  type: "function",
  function: {
    name: "grep",
    description: "Search file contents for a regex pattern across the project.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regular expression to search for" },
        path: { type: "string", description: "Directory to search under (default: cwd)" },
        max_results: { type: "integer", description: "Max matching lines to return (default 100)" },
      },
      required: ["pattern"],
    },
  },
};

export async function run({ pattern, path: root, max_results }) {
  const cap = max_results || 100;
  const base = path.resolve(process.cwd(), root || ".");
  let re;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    throw new Error(`Invalid regex: ${err.message}`);
  }

  const results = [];
  for await (const file of walk(base)) {
    if (results.length >= cap) break;
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue; // binary or unreadable
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        results.push(`${path.relative(process.cwd(), file)}:${i + 1}: ${lines[i].trim()}`);
        if (results.length >= cap) break;
      }
    }
  }
  return { matches: results, count: results.length };
}
