import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { GRAMMARS_DIR } from "../engine/paths.js";
import { downloadFile } from "../engine/download.js";
import { RUNTIME, LANGUAGES, grammarFile, grammarUrl } from "./grammars.js";

const require = createRequire(import.meta.url);

// Lazily-initialized tree-sitter runtime + a cache of loaded grammars. The
// runtime (Parser class) and each grammar wasm are downloaded once, then reused
// for the life of the process.
let ParserClass = null;
let initPromise = null;
const languageCache = new Map();

async function fileExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Ensure a wasm/js asset is present in GRAMMARS_DIR, downloading it if missing.
async function ensureAsset(file, url, onLog) {
  const dest = path.join(GRAMMARS_DIR, file);
  if (await fileExists(dest)) return dest;
  onLog?.(`downloading ${file}…`);
  await fs.mkdir(GRAMMARS_DIR, { recursive: true });
  await downloadFile(url, dest);
  return dest;
}

// Initialize the tree-sitter runtime once (download + Emscripten init). Safe to
// call repeatedly; the work happens at most once.
export function initRuntime(onLog) {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const jsPath = await ensureAsset(RUNTIME.js.file, RUNTIME.js.url, onLog);
    await ensureAsset(RUNTIME.wasm.file, RUNTIME.wasm.url, onLog);
    const Parser = require(jsPath);
    // locateFile points the Emscripten loader at the adjacent tree-sitter.wasm.
    await Parser.init({ locateFile: (f) => path.join(GRAMMARS_DIR, f) });
    ParserClass = Parser;
    return Parser;
  })();
  return initPromise;
}

// Get a parser configured for `langId`, downloading + loading its grammar the
// first time. Returns null for unsupported languages.
export async function getParser(langId, onLog) {
  if (!LANGUAGES.some((l) => l.id === langId)) return null;
  await initRuntime(onLog);
  if (!languageCache.has(langId)) {
    const wasmPath = await ensureAsset(grammarFile(langId), grammarUrl(langId), onLog);
    const Language = await ParserClass.Language.load(wasmPath);
    languageCache.set(langId, Language);
  }
  const parser = new ParserClass();
  parser.setLanguage(languageCache.get(langId));
  return parser;
}

// Prefetch the runtime + every grammar so later parsing never blocks on network.
export async function prefetchAll(onLog) {
  await initRuntime(onLog);
  for (const l of LANGUAGES) await getParser(l.id, onLog);
}
