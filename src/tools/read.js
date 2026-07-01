import fs from "node:fs/promises";
import path from "node:path";

export const schema = {
  type: "function",
  function: {
    name: "read_file",
    description:
      "Read a text file from disk. Returns content with line numbers. Use offset/limit for large files.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute or relative to cwd" },
        offset: { type: "integer", description: "1-based line number to start at (optional)" },
        limit: { type: "integer", description: "Max number of lines to return (default 2000)" },
      },
      required: ["path"],
    },
  },
};

export async function run({ path: filePath, offset, limit }) {
  const abs = path.resolve(process.cwd(), filePath);
  const raw = await fs.readFile(abs, "utf8");
  const lines = raw.split("\n");
  const start = Math.max(1, offset || 1);
  const max = limit || 2000;
  const slice = lines.slice(start - 1, start - 1 + max);
  const numbered = slice.map((l, i) => `${start + i}\t${l}`).join("\n");
  const truncated = lines.length > start - 1 + max;
  return {
    path: abs,
    totalLines: lines.length,
    content: numbered,
    truncated,
  };
}
