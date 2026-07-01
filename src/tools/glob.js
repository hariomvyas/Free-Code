import path from "node:path";
import { walk, globToRegex } from "./walk.js";

export const schema = {
  type: "function",
  function: {
    name: "glob",
    description: "Find files by glob pattern (supports *, **, ?), e.g. 'src/**/*.js'.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Glob pattern relative to path" },
        path: { type: "string", description: "Directory to search under (default: cwd)" },
        max_results: { type: "integer", description: "Max files to return (default 200)" },
      },
      required: ["pattern"],
    },
  },
};

export async function run({ pattern, path: root, max_results }) {
  const cap = max_results || 200;
  const base = path.resolve(process.cwd(), root || ".");
  const re = globToRegex(pattern);
  const results = [];

  for await (const file of walk(base)) {
    const rel = path.relative(base, file).split(path.sep).join("/");
    if (re.test(rel)) {
      results.push(path.relative(process.cwd(), file));
      if (results.length >= cap) break;
    }
  }
  return { files: results, count: results.length };
}
