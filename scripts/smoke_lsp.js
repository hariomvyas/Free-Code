// Verifies the LSP client end-to-end against scripts/mock-lsp-server.js — no real
// language server or toolchain required. Exercises the JSON-RPC framing, the
// initialize handshake, pushed diagnostics, and hover/definition/references.
// Also checks the graceful "no server installed" path through the tool layer.
import fs from "node:fs/promises";
import { LspClient } from "../src/lsp/client.js";
import { executeTool } from "../src/tools/index.js";

let pass = 0, fail = 0;
const ok = (name, cond) => (console.log(`${cond ? "PASS" : "FAIL"}  ${name}`), cond ? pass++ : fail++);

// --- client vs mock server ---
const server = { id: "mock", bin: "node", args: ["scripts/mock-lsp-server.js"], path: process.execPath };
const client = new LspClient(server, process.cwd());
await client.start();
ok("initialize handshake", true);

const text = "function foo(a){ return bar(); }\nlet x = bar();\n";
await fs.writeFile("lsp_probe.js", text);
const uri = await client.openOrUpdate("lsp_probe.js", text);

const diags = await client.waitDiagnostics(uri);
ok("diagnostics pushed on didOpen", diags.length === 1 && /bar/.test(diags[0].message));

const hov = await client.hover(uri, 0, 9);
ok("hover returns contents", !!(hov && hov.contents));

const def = await client.definition(uri, 1, 9);
ok("definition returns a location", !!(def && def.range));

const refs = await client.references(uri, 0, 9);
ok("references returns a list", Array.isArray(refs) && refs.length === 2);

client.stop();
await fs.rm("lsp_probe.js", { force: true });

// --- graceful no-server path via the tool ---
const d = await executeTool("lsp_diagnostics", { file: "src/llm.js" });
ok("tool degrades gracefully when no server installed", d.available === false && !!d.install);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
