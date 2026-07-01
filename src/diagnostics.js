import { exec } from "node:child_process";
import path from "node:path";
import fs from "node:fs/promises";

// Lightweight, dependency-free diagnostics: after a file is written/edited, run
// the best checker available for its language and return any errors. This gives
// the model the core benefit of an LSP (immediate feedback on broken code it
// wrote) without needing a full language-server install.

function run(cmd, timeoutMs = 15000) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: process.cwd(), timeout: timeoutMs }, (error, stdout, stderr) => {
      resolve({ error, out: `${stdout || ""}${stderr || ""}`.trim() });
    });
  });
}

async function has(cmd) {
  const probe = process.platform === "win32" ? `where ${cmd}` : `command -v ${cmd}`;
  const { error } = await run(probe, 5000);
  return !error;
}

// Returns { checked: bool, ok: bool, errors: string } for a file path.
export async function checkFile(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  const q = JSON.stringify(absPath);

  if ([".js", ".mjs", ".cjs"].includes(ext)) {
    const { error, out } = await run(`node --check ${q}`);
    return { checked: true, ok: !error, errors: error ? out : "" };
  }

  if (ext === ".json") {
    try {
      JSON.parse(await fs.readFile(absPath, "utf8"));
      return { checked: true, ok: true, errors: "" };
    } catch (e) {
      return { checked: true, ok: false, errors: e.message };
    }
  }

  if (ext === ".py") {
    if (await has("python")) {
      const { error, out } = await run(`python -m py_compile ${q}`);
      return { checked: true, ok: !error, errors: error ? out : "" };
    }
    return { checked: false, ok: true, errors: "" };
  }

  if ([".ts", ".tsx"].includes(ext)) {
    if (await has("tsc")) {
      const { error, out } = await run(`tsc --noEmit --skipLibCheck ${q}`, 30000);
      return { checked: true, ok: !error, errors: error ? out : "" };
    }
    return { checked: false, ok: true, errors: "" };
  }

  return { checked: false, ok: true, errors: "" };
}
