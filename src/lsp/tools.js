import { getManager } from "./manager.js";
import { detectServers } from "./servers.js";

function tool(name, description, properties, required, run) {
  return {
    mutating: false,
    run,
    schema: {
      type: "function",
      function: { name, description, parameters: { type: "object", properties, required } },
    },
  };
}

const fileProp = { type: "string", description: "Path to the source file (relative to cwd)" };
const posProps = {
  file: fileProp,
  line: { type: "integer", description: "1-based line number of the symbol" },
  character: { type: "integer", description: "1-based column of the symbol (default 1)" },
};

// LSP-backed tools. They use whatever language servers are installed on the
// machine (typescript-language-server, pyright, gopls, rust-analyzer, clangd);
// when none is installed for a file they return an "available:false" note with
// install instructions rather than failing.
export const LSP_TOOLS = {
  lsp_diagnostics: tool(
    "lsp_diagnostics",
    "Get real compiler/type diagnostics (errors & warnings with line:col) for a file from its language server. More accurate than a syntax check. Requires the language's LSP server installed.",
    { file: fileProp },
    ["file"],
    (args) => getManager().diagnostics(args.file)
  ),
  lsp_hover: tool(
    "lsp_hover",
    "Get the type signature and docs for the symbol at a position (file, line, character), via the language server.",
    posProps,
    ["file", "line"],
    (args) => getManager().hover(args.file, args.line, args.character)
  ),
  lsp_definition: tool(
    "lsp_definition",
    "Jump to the definition of the symbol at a position (file, line, character). Type-aware, unlike grep.",
    posProps,
    ["file", "line"],
    (args) => getManager().definition(args.file, args.line, args.character)
  ),
  lsp_references: tool(
    "lsp_references",
    "Find all references to the symbol at a position (file, line, character), across the project.",
    posProps,
    ["file", "line"],
    (args) => getManager().references(args.file, args.line, args.character)
  ),
};

// Human summary of which servers are installed, for the /lsp command + startup.
export function lspStatus() {
  const found = detectServers();
  return {
    installed: found.map((s) => ({ id: s.id, bin: s.bin, path: s.path })),
    count: found.length,
  };
}
