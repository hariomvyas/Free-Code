import fs from "node:fs/promises";
import path from "node:path";

export const schema = {
  type: "function",
  function: {
    name: "edit_file",
    description:
      "Replace an exact string occurrence in a file with a new string. old_string must match exactly once unless replace_all is true.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path, absolute or relative to cwd" },
        old_string: { type: "string", description: "Exact text to find" },
        new_string: { type: "string", description: "Text to replace it with" },
        replace_all: { type: "boolean", description: "Replace every occurrence (default false)" },
      },
      required: ["path", "old_string", "new_string"],
    },
  },
};

export async function run({ path: filePath, old_string, new_string, replace_all }) {
  const abs = path.resolve(process.cwd(), filePath);
  const content = await fs.readFile(abs, "utf8");

  const count = content.split(old_string).length - 1;
  if (count === 0) {
    throw new Error(`old_string not found in ${filePath}`);
  }
  if (count > 1 && !replace_all) {
    throw new Error(
      `old_string matches ${count} times in ${filePath} — make it unique or set replace_all: true`
    );
  }

  const updated = replace_all
    ? content.split(old_string).join(new_string)
    : content.replace(old_string, new_string);

  await fs.writeFile(abs, updated, "utf8");
  return { path: abs, replacements: replace_all ? count : 1 };
}
