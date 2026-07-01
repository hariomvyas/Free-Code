// Verifies diagnostics catch broken code and pass clean code.
import fs from "node:fs/promises";
import { checkFile } from "../src/diagnostics.js";

const good = "scratch_good.js";
const bad = "scratch_bad.js";
const badJson = "scratch_bad.json";

await fs.writeFile(good, "export const x = 1;\n");
await fs.writeFile(bad, "export const x = ;\n"); // syntax error
await fs.writeFile(badJson, '{"a": 1,}'); // trailing comma

const g = await checkFile(await abs(good));
const b = await checkFile(await abs(bad));
const j = await checkFile(await abs(badJson));

console.log("good.js  ->", JSON.stringify(g));
console.log("bad.js   ->", g.ok, "| bad ok?", b.ok, "| err:", b.errors.split("\n")[0]);
console.log("bad.json ->", j.ok, "| err:", j.errors);

console.log("\nRESULT:", g.ok === true && b.ok === false && j.ok === false ? "PASS" : "FAIL");

for (const f of [good, bad, badJson]) await fs.rm(f, { force: true });

async function abs(p) {
  return (await import("node:path")).resolve(process.cwd(), p);
}
