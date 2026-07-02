import fs from "node:fs";
import path from "node:path";

// Catalog of language servers Free Code can drive over LSP. We never auto-install
// them (that would break the offline/zero-dep promise and is platform-specific);
// instead we detect ones already on PATH and use them, and tell the user how to
// install the rest. Each server speaks LSP over stdio.
export const SERVERS = [
  {
    id: "typescript",
    langs: ["typescript", "typescriptreact", "javascript", "javascriptreact"],
    exts: [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx"],
    bin: "typescript-language-server",
    args: ["--stdio"],
    install: "npm i -g typescript-language-server typescript",
  },
  {
    id: "pyright",
    langs: ["python"],
    exts: [".py", ".pyi"],
    bin: "pyright-langserver",
    args: ["--stdio"],
    install: "npm i -g pyright",
  },
  {
    id: "gopls",
    langs: ["go"],
    exts: [".go"],
    bin: "gopls",
    args: [],
    install: "go install golang.org/x/tools/gopls@latest",
  },
  {
    id: "rust-analyzer",
    langs: ["rust"],
    exts: [".rs"],
    bin: "rust-analyzer",
    args: [],
    install: "rustup component add rust-analyzer",
  },
  {
    id: "clangd",
    langs: ["c", "cpp"],
    exts: [".c", ".h", ".cc", ".cpp", ".hpp", ".cxx"],
    bin: "clangd",
    args: [],
    install: "install clangd (LLVM)",
  },
];

// LSP languageId for a file (used in textDocument.languageId).
export function languageIdForFile(filePath) {
  const ext = extname(filePath);
  const map = {
    ".ts": "typescript", ".mts": "typescript", ".cts": "typescript",
    ".tsx": "typescriptreact",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".jsx": "javascriptreact",
    ".py": "python", ".pyi": "python",
    ".go": "go",
    ".rs": "rust",
    ".c": "c", ".h": "c",
    ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp", ".cxx": "cpp",
  };
  return map[ext] || null;
}

export function serverForFile(filePath) {
  const ext = extname(filePath);
  return SERVERS.find((s) => s.exts.includes(ext)) || null;
}

function extname(p) {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
}

// Resolve an executable on PATH (handles Windows .cmd/.exe/.bat). Returns the
// full path, or null if not found — without spawning anything.
export function which(bin) {
  const parts = (process.env.PATH || "").split(path.delimiter);
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe", ".bat"] : [""];
  for (const dir of parts) {
    if (!dir) continue;
    for (const e of exts) {
      const full = path.join(dir, bin + e);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch {}
    }
  }
  return null;
}

// Which servers from the catalog are actually installed right now.
export function detectServers() {
  return SERVERS.map((s) => ({ ...s, path: which(s.bin) })).filter((s) => s.path);
}
