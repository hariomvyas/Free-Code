import fs from "node:fs/promises";
import path from "node:path";

export const schema = {
  type: "function",
  function: {
    name: "multi_edit",
    description:
      "Apply multiple find/replace edits to a single file in one atomic operation. Edits are applied in order. Either all succeed or none are written.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        edits: {
          type: "array",
          description: "List of edits, each { old_string, new_string, replace_all? }",
          items: {
            type: "object",
            properties: {
              old_string: { type: "string" },
              new_string: { type: "string" },
              replace_all: { type: "boolean" },
            },
            required: ["old_string", "new_string"],
          },
        },
      },
      required: ["path", "edits"],
    },
  },
};

export async function run({ path: filePath, edits }) {
  const abs = path.resolve(process.cwd(), filePath);
  let content = await fs.readFile(abs, "utf8");
  if (!Array.isArray(edits) || edits.length === 0) throw new Error("edits must be a non-empty array");

  let applied = 0;
  edits.forEach((e, idx) => {
    const count = content.split(e.old_string).length - 1;
    if (count === 0) throw new Error(`edit #${idx + 1}: old_string not found`);
    if (count > 1 && !e.replace_all) throw new Error(`edit #${idx + 1}: matches ${count}x — set replace_all or make unique`);
    content = e.replace_all ? content.split(e.old_string).join(e.new_string) : content.replace(e.old_string, e.new_string);
    applied++;
  });

  await fs.writeFile(abs, content, "utf8");
  return { path: abs, editsApplied: applied };
}
