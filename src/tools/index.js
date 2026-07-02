import * as readTool from "./read.js";
import * as writeTool from "./write.js";
import * as editTool from "./edit.js";
import * as multiEditTool from "./multiEdit.js";
import * as bashTool from "./bash.js";
import * as grepTool from "./grep.js";
import * as globTool from "./glob.js";
import * as lsTool from "./ls.js";
import * as webFetchTool from "./webFetch.js";
import * as webSearchTool from "./webSearch.js";
import * as browserTool from "./browser.js";
import { CODEGRAPH_TOOLS } from "../codegraph/tools.js";
import { LSP_TOOLS } from "../lsp/tools.js";

// mutating: true => gated by permission system before execution.
export const TOOLS = {
  read_file: { ...readTool, mutating: false },
  write_file: { ...writeTool, mutating: true },
  edit_file: { ...editTool, mutating: true },
  multi_edit: { ...multiEditTool, mutating: true },
  bash: { ...bashTool, mutating: true },
  grep: { ...grepTool, mutating: false },
  glob: { ...globTool, mutating: false },
  ls: { ...lsTool, mutating: false },
  web_fetch: { ...webFetchTool, mutating: false },
  web_search: { ...webSearchTool, mutating: false },
  browser: { ...browserTool, mutating: false },
  // Built-in code graph (tree-sitter) navigation tools.
  ...CODEGRAPH_TOOLS,
  // LSP-backed intelligence (uses installed language servers).
  ...LSP_TOOLS,
};

export const TOOL_SCHEMAS = Object.values(TOOLS).map((t) => t.schema);

export async function executeTool(name, args) {
  const tool = TOOLS[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(args);
}

export function isMutating(name) {
  return TOOLS[name]?.mutating ?? true; // unknown tools default to gated
}

// Textual tool docs for the system prompt (model gets JSON-schema-constrained
// output, not native tool definitions, so it needs to know argument shapes as text).
export function describeTools() {
  return Object.entries(TOOLS)
    .map(([name, t]) => {
      const params = t.schema.function.parameters.properties || {};
      const required = new Set(t.schema.function.parameters.required || []);
      const paramStr = Object.entries(params)
        .map(([k, v]) => `${k}${required.has(k) ? "" : "?"}: ${v.type || "any"}`)
        .join(", ");
      return `- ${name}(${paramStr}) — ${t.schema.function.description}`;
    })
    .join("\n");
}
