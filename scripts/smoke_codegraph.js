// Verifies the built-in code graph end-to-end WITHOUT the LLM/engine: builds the
// graph for this repo, then checks search/callers/callees/impact + incremental
// reuse. First run downloads the tree-sitter runtime + grammars (~7MB).
import { buildAndRefresh } from "../src/codegraph/tools.js";
import { search, callers, callees, impact } from "../src/codegraph/query.js";

const s1 = await buildAndRefresh({ root: process.cwd(), onLog: (m) => console.log(`  [dl] ${m}`) });
console.log(`build:   ${s1.nodes} symbols · ${s1.edges} edges · ${s1.files} files · langs=${s1.langs} (${s1.ms}ms)`);

const s2 = await buildAndRefresh({ root: process.cwd() });
console.log(`rebuild: parsed=${s2.parsed} reused=${s2.reused} (${s2.ms}ms) — incremental ${s2.reused > 0 && s2.parsed === 0 ? "OK" : "?"}`);

const found = await search("buildGraph", 3);
const cr = await callers("chat");
const ce = await callees("buildGraph");
const im = await impact("extract");

console.log(`search buildGraph: ${found.map((f) => `${f.name}@${f.file}:${f.line}`).join(", ")}`);
console.log(`callers of chat:   ${cr.callers.map((c) => c.name).join(", ") || "none"}`);
console.log(`callees buildGraph:${ce.callees.length} symbols`);
console.log(`impact of extract: ${im.impacted.map((i) => `${i.name}@d${i.depth}`).join(", ") || "none"}`);

const pass =
  s1.nodes > 0 && s1.edges > 0 && s2.reused > 0 && found.length > 0 && cr.callers.some((c) => c.name === "send");
console.log(`\nRESULT: ${pass ? "PASS" : "FAIL"}`);
