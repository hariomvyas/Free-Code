import fs from "node:fs/promises";
import path from "node:path";

export const schema = {
  type: "function",
  function: {
    name: "write_file",
    description:
      "Create a new file or overwrite an existing one with the given content. Creates parent directories as needed.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute or relative to cwd" },
        content: { type: "string", description: "Full file content to write" },
      },
      required: ["path", "content"],
    },
  },
};

export async function run({ path: filePath, content }) {
  const abs = path.resolve(process.cwd(), filePath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, "utf8");
  return { path: abs, bytesWritten: Buffer.byteLength(content, "utf8") };
}
