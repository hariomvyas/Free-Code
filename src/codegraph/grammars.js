// Catalog of the tree-sitter runtime + grammar wasm files the code graph needs.
// Everything is downloaded on first use (from jsdelivr) into ~/.freecode/grammars,
// mirroring how the llama.cpp engine is fetched — so package.json stays free of
// npm dependencies. Versions are pinned for ABI compatibility between the runtime
// and the precompiled grammars (verified: web-tree-sitter 0.22.6 loads all of the
// tree-sitter-wasms 0.1.12 grammars below).
const RUNTIME_VERSION = "0.22.6";
const GRAMMARS_VERSION = "0.1.12";

const CDN = "https://cdn.jsdelivr.net/npm";

// The Emscripten runtime: a UMD loader (require'd) + its wasm (loaded adjacently).
export const RUNTIME = {
  js: { file: "tree-sitter.js", url: `${CDN}/web-tree-sitter@${RUNTIME_VERSION}/tree-sitter.js` },
  wasm: { file: "tree-sitter.wasm", url: `${CDN}/web-tree-sitter@${RUNTIME_VERSION}/tree-sitter.wasm` },
};

// One entry per language. `id` is the tree-sitter grammar name; `exts` are the
// file extensions routed to it.
export const LANGUAGES = [
  { id: "javascript", exts: [".js", ".mjs", ".cjs", ".jsx"] },
  { id: "typescript", exts: [".ts", ".mts", ".cts"] },
  { id: "tsx", exts: [".tsx"] },
  { id: "python", exts: [".py", ".pyi"] },
  { id: "go", exts: [".go"] },
  { id: "rust", exts: [".rs"] },
];

export function grammarFile(id) {
  return `tree-sitter-${id}.wasm`;
}

export function grammarUrl(id) {
  return `${CDN}/tree-sitter-wasms@${GRAMMARS_VERSION}/out/tree-sitter-${id}.wasm`;
}

// Map a file path to a language id, or null if unsupported.
export function langForFile(filePath) {
  const dot = filePath.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filePath.slice(dot).toLowerCase();
  const lang = LANGUAGES.find((l) => l.exts.includes(ext));
  return lang ? lang.id : null;
}

export const ALL_EXTS = new Set(LANGUAGES.flatMap((l) => l.exts));
